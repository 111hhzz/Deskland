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

    [Fact]
    public void BaseCss_NoHardcodedColorsOutsideRoot()
    {
        var path = Path.Combine(ThemesDir, "base.css");
        Assert.True(File.Exists(path), $"缺少 {path}");
        var css = StripComments(File.ReadAllText(path));
        var root = Regex.Match(css, @"(?s):root\s*\{(.*?)\}");
        Assert.True(root.Success, "base.css 缺少 :root Token 默认值");
        var outside = css.Substring(0, root.Index) + css.Substring(root.Index + root.Length);
        Assert.DoesNotMatch(@"#[0-9a-fA-F]{3,8}\b", outside);
        Assert.DoesNotMatch(@"\brgba?\s*\(", outside);
        Assert.DoesNotMatch(@"\bhsla?\s*\(", outside);
        Assert.DoesNotMatch(@"\b(white|black)\b(?!\s*-)", outside);   // 排除 white-space 等属性名
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

    private static string StripComments(string css) =>
        Regex.Replace(css, @"/\*.*?\*/", string.Empty, RegexOptions.Singleline);
}
