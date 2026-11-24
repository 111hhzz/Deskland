using System.Text.Json;
using System.Text.RegularExpressions;
using Xunit;

namespace Deskland.Tests;

/// <summary>
/// 主题约定测试（无浏览器）：校验 themes/ 目录结构、Token 命名、theme.css / theme.json / base.css 的红线。
/// 运行：dotnet test --filter ThemeConvention
/// </summary>
public class ThemeConventionTests
{
    private static readonly string RepoRoot = Path.GetFullPath(Path.Combine(
        AppContext.BaseDirectory, "..", "..", "..", "..", ".."));
    private static readonly string SrcDir = Path.Combine(RepoRoot, "frontend", "src");
    private static readonly string PublicDir = Path.Combine(RepoRoot, "frontend", "public");
    private static readonly string ThemesDir = Path.Combine(PublicDir, "themes");
    private static readonly string ProductsPath = Path.Combine(ThemesDir, "_products.json");

    private static string[] ThemeIds => Directory.GetDirectories(ThemesDir)
        .Select(p => Path.GetFileName(p)!)
        .Where(n => n.Length > 0)
        .ToArray();

    /// <summary>参与授权表的主题目录（_ 开头的是模板/内部文件，如 _template）。</summary>
    private static string[] ThemeFolderIds => ThemeIds.Where(n => !n.StartsWith("_")).ToArray();

    /// <summary>授权表里 status==ready 的 id（顺序即授权表顺序：设置页与壁纸启动都按此展示）。</summary>
    private static string[] ReadyIds()
    {
        using var products = JsonDocument.Parse(File.ReadAllText(ProductsPath));
        var list = new List<string>();
        foreach (var t in products.RootElement.GetProperty("themes").EnumerateArray())
            if (t.GetProperty("status").GetString() == "ready") list.Add(t.GetProperty("id").GetString()!);
        return list.ToArray();
    }

    [Fact]
    public void ThemeCss_OnlyRootCustomProperties()
    {
        foreach (var id in ThemeIds)
        {
            var path = Path.Combine(ThemesDir, id, "theme.css");
            Assert.True(File.Exists(path), $"缺少 {path}");
            var css = StripComments(File.ReadAllText(path));
            var m = Regex.Match(css, @"(?s)^\s*:root\s*\{(.*)\}\s*$");
            Assert.True(m.Success, $"{id}/theme.css 只能包含一个 :root 规则，禁止写选择器");
            foreach (var decl in m.Groups[1].Value.Split(';'))
            {
                var d = decl.Trim();
                if (d.Length == 0) continue;
                Assert.True(d.StartsWith("--"), $"{id}/theme.css 含非 Token 声明：{d}");
                Assert.Contains(':', d);
            }
        }
    }

    /// <summary>
    /// base.css 只写选择器：Design Token 的默认值已迁至 DTCG（tokens/core/*.tokens.json），
    /// 由 scripts/build-tokens.mjs 编译进各主题 theme.css。因此 base.css 既不能有 :root token 块，
    /// 也不能出现任何硬编码颜色。
    /// </summary>
    [Fact]
    public void BaseCss_NoTokenBlockAndNoHardcodedColors()
    {
        var path = Path.Combine(ThemesDir, "base.css");
        Assert.True(File.Exists(path), $"缺少 {path}");
        var css = StripComments(File.ReadAllText(path));
        Assert.DoesNotMatch(@":root\s*\{", css);
        Assert.DoesNotMatch(@"#[0-9a-fA-F]{3,8}\b", css);
        Assert.DoesNotMatch(@"\brgba?\s*\(", css);
        Assert.DoesNotMatch(@"\bhsla?\s*\(", css);
        Assert.DoesNotMatch(@"\b(white|black)\b(?!\s*-)", css);   // 排除 white-space 等属性名
    }

    /// <summary>theme.css 是编译产物：必须带生成头，防止有人绕过 token 源手改。</summary>
    [Fact]
    public void ThemeCss_AreGeneratedArtifacts()
    {
        foreach (var id in ThemeFolderIds)
        {
            var path = Path.Combine(ThemesDir, id, "theme.css");
            var css = File.ReadAllText(path);
            Assert.True(css.StartsWith("/* 本文件由 scripts/build-tokens.mjs 生成", StringComparison.Ordinal),
                $"{id}/theme.css 不是生成产物（或缺少生成头），请改 tokens/themes/{id}/*.tokens.json 后跑 pnpm tokens");
        }
    }

    [Fact]
    public void ThemeJson_MatchesThemeCss()
    {
        foreach (var id in ThemeIds)
        {
            var jsonPath = Path.Combine(ThemesDir, id, "theme.json");
            var cssPath = Path.Combine(ThemesDir, id, "theme.css");
            Assert.True(File.Exists(jsonPath), $"缺少 {jsonPath}");
            Assert.True(File.Exists(cssPath), $"缺少 {cssPath}");

            using var json = JsonDocument.Parse(File.ReadAllText(jsonPath));
            var css = StripComments(File.ReadAllText(cssPath));
            var defined = Regex.Matches(css, @"--([a-z0-9-]+)\s*:")
                .Cast<Match>()
                .Select(x => x.Groups[1].Value)
                .ToHashSet();

            foreach (var category in json.RootElement.GetProperty("tokens").EnumerateObject())
            {
                foreach (var token in category.Value.EnumerateObject())
                {
                    var name = $"{category.Name}-{token.Name}";
                    Assert.True(defined.Contains(name),
                        $"{id}: theme.json 声明了 {name}，但 theme.css 未定义");
                }
            }
        }
    }

    [Fact]
    public void BaseCss_VarReferencesAreDefined()
    {
        var css = StripComments(File.ReadAllText(Path.Combine(ThemesDir, "base.css")));
        var defined = Regex.Matches(css, @"--([a-z0-9-]+)\s*:")
            .Cast<Match>()
            .Select(x => x.Groups[1].Value)
            .ToHashSet();
        foreach (var id in ThemeIds)
        {
            var themeCss = StripComments(File.ReadAllText(Path.Combine(ThemesDir, id, "theme.css")));
            foreach (Match m in Regex.Matches(themeCss, @"--([a-z0-9-]+)\s*:"))
                defined.Add(m.Groups[1].Value);
        }
        foreach (Match m in Regex.Matches(css, @"var\(\s*(--[a-z0-9-]+)"))
        {
            var name = m.Groups[1].Value.Substring(2);
            Assert.True(defined.Contains(name), $"base.css 引用了未定义的 Token：{name}");
        }
    }

    [Fact]
    public void ReadyThemes_HaveThemeFolderAndManifest()
    {
        foreach (var id in ReadyIds())
        {
            var dir = Path.Combine(ThemesDir, id);
            Assert.True(Directory.Exists(dir), $"缺少 themes/{id}/");
            Assert.True(File.Exists(Path.Combine(dir, "theme.css")), $"缺少 themes/{id}/theme.css");

            var manifestPath = Path.Combine(dir, "theme.json");
            Assert.True(File.Exists(manifestPath), $"缺少 themes/{id}/theme.json");
            using var manifest = JsonDocument.Parse(File.ReadAllText(manifestPath));
            Assert.Equal(id, manifest.RootElement.GetProperty("id").GetString());
            var page = manifest.RootElement.GetProperty("page").GetString()!;
            Assert.True(File.Exists(Path.Combine(SrcDir, page)), $"themes/{id}/theme.json 的 page 指向不存在的页面：{page}");
        }
    }

    /// <summary>
    /// 授权表是唯一入口：每个非下划线主题目录都必须登记，且每条登记都要有目录与 theme.json；
    /// status 只能是 ready / locked / coming。防“加了目录忘了登记”与“主题自我授权”。
    /// </summary>
    [Fact]
    public void Products_CoverEveryThemeFolder()
    {
        using var products = JsonDocument.Parse(File.ReadAllText(ProductsPath));
        var registered = new List<(string Id, string Status)>();
        foreach (var t in products.RootElement.GetProperty("themes").EnumerateArray())
        {
            var id = t.GetProperty("id").GetString()!;
            var status = t.GetProperty("status").GetString()!;
            Assert.Contains(status, new[] { "ready", "locked", "coming" });
            Assert.True(Directory.Exists(Path.Combine(ThemesDir, id)), $"授权表登记了不存在的主题：{id}");
            Assert.True(File.Exists(Path.Combine(ThemesDir, id, "theme.json")), $"授权表登记了缺 theme.json 的主题：{id}");
            registered.Add((id, status));
        }
        Assert.Empty(registered.Select(r => r.Id).GroupBy(x => x).Where(g => g.Count() > 1));
        foreach (var id in ThemeFolderIds)
            Assert.True(registered.Exists(r => r.Id == id), $"主题目录未登记进 _products.json：{id}");
    }

    /// <summary>
    /// 授权字段只能来自 _products.json：主题 JSON 自带 status/product 会被宿主忽略，不该出现
    /// （否则会诱使作者以为改主题文件就能解锁）。
    /// </summary>
    [Fact]
    public void ThemeJson_DoesNotCarryAuthorization()
    {
        foreach (var id in ThemeFolderIds)
        {
            using var m = JsonDocument.Parse(File.ReadAllText(Path.Combine(ThemesDir, id, "theme.json")));
            Assert.False(m.RootElement.TryGetProperty("status", out _), $"themes/{id}/theme.json 不该自带 status（授权由 _products.json 决定）");
            Assert.False(m.RootElement.TryGetProperty("product", out _), $"themes/{id}/theme.json 不该自带 product（授权由 _products.json 决定）");
        }
    }

    /// <summary>page 必须留在自己的主题目录下：主题自包含，不能跨目录引用别人的页面。</summary>
    [Fact]
    public void ReadyThemes_PageStaysInsideOwnFolder()
    {
        foreach (var id in ReadyIds())
        {
            using var m = JsonDocument.Parse(File.ReadAllText(Path.Combine(ThemesDir, id, "theme.json")));
            var page = m.RootElement.GetProperty("page").GetString()!;
            Assert.True(page.StartsWith("themes/" + id + "/"), $"themes/{id}/theme.json 的 page 跑到别的目录了：{page}");
        }
    }

    /// <summary>
    /// engine.html 的引擎注册表必须覆盖每个 ready 主题：
    /// 注册表漏项会让热切换静默回退到默认引擎（aurora 曾因此重启后变回草地）。
    /// </summary>
    [Fact]
    public void ReadyThemes_EngineRegistryCoversAll()
    {
        // 注册表已抽到 engine/main.tsx（Vite 入口），engine.html 只是容器
        var engineHtml = File.ReadAllText(Path.Combine(SrcDir, "engine", "main.tsx"));
        foreach (var id in ReadyIds())
        {
            Assert.Contains(id + ":", engineHtml);
            Assert.True(File.Exists(Path.Combine(ThemesDir, id, "theme.css")), $"缺少 themes/{id}/theme.css");
        }
    }

    /// <summary>
    /// Token SSOT 双向校验：
    ///  1) 引擎调色板里每个 sceneToken('--scene-x') 都必须在生成的 SCENE_UNIFORMS 中有 token→uniform 映射；
    ///  2) SCENE_UNIFORMS 的每个 uniform 都必须真的被引擎以 U.&lt;name&gt; 使用（防止登记了却没人用的死映射）。
    /// 源为 frontend/tokens/**/*.tokens.json，映射由 scripts/build-tokens.mjs 编译进 src/engine/tokens.ts。
    /// </summary>
    [Fact]
    public void Tokens_EngineUniformMappingConsistent()
    {
        var tokensTs = File.ReadAllText(Path.Combine(SrcDir, "engine", "tokens.ts"));
        var block = tokensTs.Split("SCENE_UNIFORMS = {", StringSplitOptions.RemoveEmptyEntries)[1];
        block = block.Split(new[] { "} as const" }, StringSplitOptions.None)[0];
        var map = Regex.Matches(block, @"""(--scene-[a-z0-9-]+)"":\s*""(u[A-Z][A-Za-z0-9]*)""")
            .Cast<Match>()
            .Select(m => (Token: m.Groups[1].Value, Uniform: m.Groups[2].Value))
            .ToList();
        Assert.NotEmpty(map);

        var engineFiles = Directory.GetFiles(SrcDir, "*.ts", SearchOption.AllDirectories);
        var engineSrc = string.Join("\n", engineFiles.Select(File.ReadAllText));

        var used = Regex.Matches(engineSrc, @"U\.(u[A-Z][A-Za-z0-9]*)")
            .Cast<Match>().Select(m => m.Groups[1].Value).ToHashSet();
        var unused = map.Where(x => !used.Contains(x.Uniform)).Select(x => x.Token + " → " + x.Uniform).ToArray();
        Assert.True(unused.Length == 0, "SCENE_UNIFORMS 里这些映射没有被引擎使用：\n" + string.Join("\n", unused));

        var keys = map.Select(x => x.Token).ToHashSet();
        var paletteTokens = Regex.Matches(engineSrc, @"sceneToken\('(--scene-[a-z0-9-]+)'\)")
            .Cast<Match>().Select(m => m.Groups[1].Value).Distinct();
        var missing = paletteTokens.Where(t => !keys.Contains(t)).ToArray();
        Assert.True(missing.Length == 0, "引擎读取的 scene token 未在 SCENE_UNIFORMS 登记：\n" + string.Join("\n", missing));
    }

    /// <summary>
    /// theme.json 的 tokens 是编译器回写的「生效视图」，必须与 token 源（core + 本主题覆盖）一致：
    /// 键集合、$type、$description 逐项相等。值的一致性由 theme.css 生成物 + tokens.ts 同步门禁覆盖。
    /// </summary>
    [Fact]
    public void Tokens_ThemeJsonViewMatchesSources()
    {
        // name → (路径段, $type, $description)；路径段第 0 项即编译器用的分类
        void Collect(JsonElement node, List<string> path, Dictionary<string, (string[] Path, string Type, string Desc)> acc)
        {
            foreach (var p in node.EnumerateObject())
            {
                if (p.Name.StartsWith("$")) continue;
                var next = new List<string>(path) { p.Name };
                if (p.Value.ValueKind == JsonValueKind.Object && p.Value.TryGetProperty("$value", out _))
                {
                    acc["--" + string.Join('-', next)] = (
                        next.ToArray(),
                        p.Value.GetProperty("$type").GetString() ?? "",
                        p.Value.GetProperty("$description").GetString() ?? "");
                }
                else if (p.Value.ValueKind == JsonValueKind.Object)
                {
                    Collect(p.Value, next, acc);
                }
            }
        }

        var core = new Dictionary<string, (string[] Path, string Type, string Desc)>();
        var coreDir = Path.Combine(RepoRoot, "frontend", "tokens", "core");
        foreach (var f in Directory.GetFiles(coreDir, "*.tokens.json"))
            Collect(JsonDocument.Parse(File.ReadAllText(f)).RootElement, [], core);

        foreach (var id in ThemeFolderIds)
        {
            var merged = new Dictionary<string, (string[] Path, string Type, string Desc)>(core);
            var themeDir = Path.Combine(RepoRoot, "frontend", "tokens", "themes", id);
            foreach (var f in Directory.GetFiles(themeDir, "*.tokens.json", SearchOption.AllDirectories))
                Collect(JsonDocument.Parse(File.ReadAllText(f)).RootElement, [], merged);

            var view = JsonDocument.Parse(File.ReadAllText(Path.Combine(ThemesDir, id, "theme.json"))).RootElement.GetProperty("tokens");

            // 与 renderTokensJson 对齐：分组 = 路径第 0 段，键 = 其余段用 '-' 连接
            var expected = merged.Values.ToDictionary(
                v => v.Path[0] + "-" + string.Join('-', v.Path.Skip(1)),
                v => (v.Type, v.Desc));
            var actual = view.EnumerateObject()
                .SelectMany(g => g.Value.EnumerateObject().Select(e => (Key: g.Name + "-" + e.Name, e.Value)))
                .ToDictionary(x => x.Key, x => (Type: x.Value.GetProperty("type").GetString() ?? "", Desc: x.Value.GetProperty("description").GetString() ?? ""));

            Assert.Equal(expected.Keys.OrderBy(k => k), actual.Keys.OrderBy(k => k));
            foreach (var key in expected.Keys)
            {
                Assert.True(actual.ContainsKey(key), $"{id}: theme.json.tokens 缺少 {key}");
                Assert.Equal(expected[key].Type, actual[key].Type);
                Assert.Equal(expected[key].Desc, actual[key].Desc);
            }
        }
    }

    private static string StripComments(string css) =>
        Regex.Replace(css, @"/\*.*?\*/", string.Empty, RegexOptions.Singleline);
}
