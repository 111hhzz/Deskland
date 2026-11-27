using Xunit;

namespace Deskland.Tests;

/// <summary>
/// 主题清单组装（host/ThemeScan.cs，纯逻辑）的单测：授权表驱动、缺项跳过、字段白名单。
/// 运行：dotnet test --filter ThemeScan
/// </summary>
public class ThemeScanTests
{
    static Dictionary<string, object> Product(string id, string status = "ready", string product = "free") =>
        new Dictionary<string, object> { { "id", id }, { "status", status }, { "product", product } };

    static Dictionary<string, object> Manifest(string id, string name = "主题", string page = "themes/a/a.html",
        string thumb = "url(/thumbs/a.webp)", object groups = null!) =>
        new Dictionary<string, object>
        {
            { "id", id }, { "name", name }, { "desc", "说明" }, { "page", page }, { "thumb", thumb },
            { "groups", groups ?? new List<object>() },
        };

    static List<Dictionary<string, object>> Build(
        List<Dictionary<string, object>> products,
        Dictionary<string, Dictionary<string, object>> manifests,
        params string[] existingPages) =>
        ThemeScan.Build(products, manifests, page => existingPages.Contains(page), delegate (string msg) { });

    [Fact]
    public void Build_KeepsProductOrder()
    {
        var products = new List<Dictionary<string, object>> { Product("b"), Product("a") };
        var manifests = new Dictionary<string, Dictionary<string, object>>
        {
            { "b", Manifest("b") }, { "a", Manifest("a") },
        };
        var list = Build(products, manifests, "themes/a/a.html", "themes/b/b.html");
        Assert.Equal(new[] { "b", "a" }, list.ConvertAll(t => (string)t["id"]));
    }

    [Fact]
    public void Build_SkipsMissingManifest()
    {
        var products = new List<Dictionary<string, object>> { Product("a"), Product("ghost") };
        var manifests = new Dictionary<string, Dictionary<string, object>> { { "a", Manifest("a") } };
        var list = Build(products, manifests, "themes/a/a.html");
        var ids = list.ConvertAll(t => (string)t["id"]);
        Assert.Equal(new[] { "a" }, ids);
    }

    [Fact]
    public void Build_SkipsPageThatDoesNotExist()
    {
        var products = new List<Dictionary<string, object>> { Product("a"), Product("b") };
        var manifests = new Dictionary<string, Dictionary<string, object>>
        {
            { "a", Manifest("a") }, { "b", Manifest("b", page: "themes/b/missing.html") },
        };
        var list = Build(products, manifests, "themes/a/a.html");
        Assert.Equal(new[] { "a" }, list.ConvertAll(t => (string)t["id"]));
    }

    [Fact]
    public void Build_SkipsManifestMissingRequiredFields()
    {
        var noThumb = Manifest("a");
        noThumb.Remove("thumb");
        var noName = Manifest("b");
        noName.Remove("name");
        var products = new List<Dictionary<string, object>> { Product("a"), Product("b") };
        var manifests = new Dictionary<string, Dictionary<string, object>> { { "a", noThumb }, { "b", noName } };
        Assert.Empty(Build(products, manifests, "themes/a/a.html", "themes/b/b.html"));
    }

    [Fact]
    public void Build_KeepsAuthorizationFromProductTable()
    {
        var products = new List<Dictionary<string, object>> { Product("a", "locked", "pro") };
        var manifests = new Dictionary<string, Dictionary<string, object>> { { "a", Manifest("a") } };
        var t = Build(products, manifests, "themes/a/a.html")[0];
        Assert.Equal("locked", t["status"]);
        Assert.Equal("pro", t["product"]);
    }

    [Fact]
    public void Build_StatusDefaultsToLockedWhenProductTableOmitsIt()
    {
        var products = new List<Dictionary<string, object>> { new Dictionary<string, object> { { "id", "a" } } };
        var manifests = new Dictionary<string, Dictionary<string, object>> { { "a", Manifest("a") } };
        Assert.Equal("locked", Build(products, manifests, "themes/a/a.html")[0]["status"]);
    }

    [Fact]
    public void Build_AdaptiveOnlyWhenTrue()
    {
        var products = new List<Dictionary<string, object>> { Product("a"), Product("b") };
        var on = Manifest("a"); on["adaptive"] = true;
        var off = Manifest("b"); off["adaptive"] = false;
        var manifests = new Dictionary<string, Dictionary<string, object>> { { "a", on }, { "b", off } };
        var list = Build(products, manifests, "themes/a/a.html", "themes/b/b.html");
        Assert.True((bool)list[0]["adaptive"]);
        Assert.False(list[1].ContainsKey("adaptive"));
    }

    [Fact]
    public void Build_WhitelistsParamFieldsAndDropsTokens()
    {
        var param = new Dictionary<string, object>
        {
            { "key", "sigma" }, { "label", "云团大小" }, { "hint", "说明" },
            { "min", 40 }, { "max", 200 }, { "step", 1 }, { "default", 72 },
            { "unit", "px" }, { "format", "percent" },
            { "options", new List<object> { "隐藏", "显示" } },
            { "soon", new List<object> { "grain", "warp" } }, { "junk", "不该出现" },
        };
        var group = new Dictionary<string, object> { { "name", "云" }, { "params", new List<object> { param } } };
        var groups = new List<object> { group };
        var m = Manifest("a");
        m["groups"] = groups;
        m["tokens"] = new Dictionary<string, object> { { "color", new Dictionary<string, object> { { "bg", 1 } } } };
        var products = new List<Dictionary<string, object>> { Product("a") };
        var list = Build(products, new Dictionary<string, Dictionary<string, object>> { { "a", m } }, "themes/a/a.html");

        var g = (List<Dictionary<string, object>>)list[0]["groups"];
        var p = (Dictionary<string, object>)((List<Dictionary<string, object>>)g[0]["params"])[0];
        Assert.Equal("sigma", p["key"]);
        Assert.Equal("云团大小", p["label"]);
        Assert.Equal(72d, p["default"]);
        Assert.Equal(new List<string> { "grain", "warp" }, (List<string>)p["soon"]);
        Assert.Equal(new List<string> { "隐藏", "显示" }, (List<string>)p["options"]);
        Assert.False(p.ContainsKey("junk"), "白名单外的参数字段不应外发");
        Assert.False(list[0].ContainsKey("tokens"), "tokens 是主题内部约定，不应外发");
    }

    [Fact]
    public void Build_NonBooleanFlagsAreIgnored()
    {
        // 外部主题写 adaptive/soon 可能是 "yes"/"no" 这类字符串：不能抛异常，按 false 处理
        var m = Manifest("a");
        m["adaptive"] = "yes";
        var groups = new List<object>
        {
            new Dictionary<string, object>
            {
                { "name", "云" },
                { "params", new List<object> { new Dictionary<string, object> { { "key", "sigma" }, { "soon", "yes" } } } },
            },
        };
        m["groups"] = groups;
        var products = new List<Dictionary<string, object>> { Product("a") };
        var list = Build(products, new Dictionary<string, Dictionary<string, object>> { { "a", m } }, "themes/a/a.html");
        Assert.Single(list);
        Assert.False(list[0].ContainsKey("adaptive"), "非布尔值不应当作开启");
        var g = (List<Dictionary<string, object>>)list[0]["groups"];
        var p = (Dictionary<string, object>)((List<Dictionary<string, object>>)g[0]["params"])[0];
        Assert.False(p.ContainsKey("soon"), "非布尔值不应当作开启");
    }

    [Fact]
    public void Build_IsolatesBrokenManifestFromOthers()
    {
        var products = new List<Dictionary<string, object>> { Product("bad"), Product("good") };
        var manifests = new Dictionary<string, Dictionary<string, object>>
        {
            { "bad", Manifest("bad", page: "themes/bad/bad.html") },
            { "good", Manifest("good", page: "themes/good/good.html") },
        };
        var logs = new List<string>();
        var list = ThemeScan.Build(products, manifests,
            page => { if (page.Contains("bad")) throw new InvalidOperationException("boom"); return true; },
            msg => logs.Add(msg));
        Assert.Equal(new[] { "good" }, list.ConvertAll(t => (string)t["id"]));
        Assert.Contains(logs, x => x.Contains("bad"));
    }

    [Fact]
    public void Build_DropsParamsWithoutKey()
    {
        var groups = new List<object>
        {
            new Dictionary<string, object>
            {
                { "name", "云" },
                { "params", new List<object> { new Dictionary<string, object> { { "label", "没有 key" } } } },
            },
        };
        var m = Manifest("a");
        m["groups"] = groups;
        var products = new List<Dictionary<string, object>> { Product("a") };
        var list = Build(products, new Dictionary<string, Dictionary<string, object>> { { "a", m } }, "themes/a/a.html");
        var g = (List<Dictionary<string, object>>)list[0]["groups"];
        Assert.Empty((List<Dictionary<string, object>>)g[0]["params"]);
    }

    [Fact]
    public void Build_KeepsBoolParamTypeOnly()
    {
        // type=bool 是设置页渲染开关的依据；其它取值（拼写错误 / 数字）不应外发
        var param = new Dictionary<string, object> { { "key", "autoCycle" }, { "label", "循环更换形态" }, { "type", "bool" }, { "default", true } };
        var bad = new Dictionary<string, object> { { "key", "x" }, { "type", "switch" }, { "default", false } };
        var group = new Dictionary<string, object> { { "name", "球" }, { "params", new List<object> { param, bad } } };
        var m = Manifest("a");
        m["groups"] = new List<object> { group };
        var products = new List<Dictionary<string, object>> { Product("a") };
        var list = Build(products, new Dictionary<string, Dictionary<string, object>> { { "a", m } }, "themes/a/a.html");

        var ps = (List<Dictionary<string, object>>)((List<Dictionary<string, object>>)list[0]["groups"])[0]["params"];
        Assert.Equal("bool", ps[0]["type"]);
        Assert.True((bool)ps[0]["default"], "布尔参数默认值应保留");
        Assert.False(ps[1].ContainsKey("type"), "非 bool 的 type 值不应外发");
    }

    [Fact]
    public void ParseUserTheme_FixedUserProductAndSynthesizedPage()
    {
        // 用户主题：product 固定 user（包内声明一律不信任）、page 合成 engine.html、status ready
        var t = new Dictionary<string, object>
        {
            { "name", "我的图" },
            { "desc", "d" },
            { "thumb", "url(/u/img-ab12cd34/a.png) center/cover" },
            { "product", "pro" }, { "status", "locked" }, { "page", "themes/evil/evil.html" },
            { "groups", new List<object> { new Dictionary<string, object>
                {
                    { "name", "媒体" },
                    { "params", new List<object> { new Dictionary<string, object>
                        { { "key", "veil" }, { "label", "遮罩" }, { "min", 0 }, { "max", 0.8 }, { "step", 0.01 }, { "default", 0 } } } },
                } } },
        };
        var d = ThemeScan.ParseUserTheme("img-ab12cd34", t);
        Assert.NotNull(d);
        Assert.Equal("user", (string)d["product"]);
        Assert.Equal("ready", (string)d["status"]);
        Assert.Equal("pages/engine.html", (string)d["page"]);
        Assert.False(d.ContainsKey("tokens"));
        var ps = (List<Dictionary<string, object>>)((List<Dictionary<string, object>>)d["groups"])[0]["params"];
        Assert.Equal(0d, ps[0]["default"]);
    }

    [Fact]
    public void ParseUserTheme_MissingNameOrThumb_ReturnsNull()
    {
        Assert.Null(ThemeScan.ParseUserTheme("img-x", new Dictionary<string, object> { { "thumb", "x" } }));
        Assert.Null(ThemeScan.ParseUserTheme("img-x", new Dictionary<string, object> { { "name", "n" } }));
        Assert.Null(ThemeScan.ParseUserTheme("img-x", null!));
    }
}
