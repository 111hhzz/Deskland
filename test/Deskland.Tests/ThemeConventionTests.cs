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
    private static readonly string PrototypeDir = Path.Combine(RepoRoot, "prototype");
    private static readonly string ThemesDir = Path.Combine(PrototypeDir, "themes");

    private static string[] ThemeIds => Directory.GetDirectories(ThemesDir)
        .Select(p => Path.GetFileName(p)!)
        .Where(n => n.Length > 0)
        .ToArray();

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
        using var themes = JsonDocument.Parse(File.ReadAllText(Path.Combine(PrototypeDir, "themes.json")));
        foreach (var t in themes.RootElement.GetProperty("themes").EnumerateArray())
        {
            if (t.GetProperty("status").GetString() != "ready") continue;
            var id = t.GetProperty("id").GetString()!;
            var dir = Path.Combine(ThemesDir, id);
            Assert.True(Directory.Exists(dir), $"缺少 themes/{id}/");
            Assert.True(File.Exists(Path.Combine(dir, "theme.css")), $"缺少 themes/{id}/theme.css");

            var manifestPath = Path.Combine(dir, "theme.json");
            Assert.True(File.Exists(manifestPath), $"缺少 themes/{id}/theme.json");
            using var manifest = JsonDocument.Parse(File.ReadAllText(manifestPath));
            Assert.Equal(id, manifest.RootElement.GetProperty("id").GetString());
            Assert.Equal(t.GetProperty("page").GetString(), manifest.RootElement.GetProperty("page").GetString());
        }
    }

    private static string StripComments(string css) =>
        Regex.Replace(css, @"/\*.*?\*/", string.Empty, RegexOptions.Singleline);
}
