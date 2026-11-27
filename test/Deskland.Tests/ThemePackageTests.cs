using System.Collections.Generic;
using Xunit;

namespace Deskland.Tests;

/// <summary>
/// 「标准主题包」（.dlp）校验纯逻辑单测（host/ThemePackageCore.cs）：
/// entry 路径 fail-closed、量级上限、扩展名白名单、拒嵌套、manifest 规范化。
/// 运行：dotnet test --filter ThemePackage
/// </summary>
public class ThemePackageTests
{
    static KeyValuePair<string, long> E(string name, long len = 10) => new KeyValuePair<string, long>(name, len);

    [Fact]
    public void SafeEntryName_RejectsTraversalAbsoluteDriveAndAds()
    {
        Assert.True(ThemePackageCore.TrySafeEntryName("assets/a.png", out var n));
        Assert.Equal("assets/a.png", n);
        Assert.True(ThemePackageCore.TrySafeEntryName("assets\\a.png", out n)); // 内部反斜杠归一
        Assert.Equal("assets/a.png", n);

        Assert.False(ThemePackageCore.TrySafeEntryName("../evil.png", out _));
        Assert.False(ThemePackageCore.TrySafeEntryName("a/../../evil.png", out _));
        Assert.False(ThemePackageCore.TrySafeEntryName("/abs.png", out _));
        Assert.False(ThemePackageCore.TrySafeEntryName("\\abs.png", out _));   // 前导分隔符一律拒
        Assert.False(ThemePackageCore.TrySafeEntryName("C:/x.png", out _));
        Assert.False(ThemePackageCore.TrySafeEntryName("assets/stream:hidden", out _)); // ADS 冒号
    }

    [Fact]
    public void Validate_FailClosed_OnNestingExtSizeAndEntries()
    {
        Assert.Null(ThemePackageCore.Validate(new[] { E("theme.json"), E("assets/a.png") }, 100));

        Assert.Equal("nested_zip", ThemePackageCore.Validate(new[] { E("theme.json"), E("inner.zip") }, 100));
        Assert.Equal("nested_zip", ThemePackageCore.Validate(new[] { E("theme.json"), E("assets/b.dlp") }, 100));
        Assert.Equal("asset_type", ThemePackageCore.Validate(new[] { E("theme.json"), E("assets/evil.html") }, 100));
        Assert.Equal("asset_type", ThemePackageCore.Validate(new[] { E("theme.json"), E("assets/run.js") }, 100));

        var many = new List<KeyValuePair<string, long>>();
        for (int i = 0; i <= ThemePackageCore.MaxEntries; i++) many.Add(E("assets/f" + i + ".png"));
        Assert.Equal("pkg_entries", ThemePackageCore.Validate(many, 100));

        Assert.Equal("pkg_too_large", ThemePackageCore.Validate(new[] { E("theme.json") },
            ThemePackageCore.MaxPackageBytes + 1));
        Assert.Equal("pkg_total", ThemePackageCore.Validate(
            new[] { E("theme.json"), E("assets/big.png", ThemePackageCore.MaxTotalBytes + 1) }, 100));
    }

    [Fact]
    public void ValidateManifest_RequiresIdNameEngine()
    {
        var ok = new Dictionary<string, object> { { "id", "my-theme" }, { "name", "我的" }, { "engine", "image" } };
        Assert.Null(ThemePackageCore.ValidateManifest(ok));
        Assert.Equal("bad_manifest", ThemePackageCore.ValidateManifest(
            new Dictionary<string, object> { { "id", "My Theme!" }, { "name", "x" }, { "engine", "image" } }));
        Assert.Equal("bad_manifest", ThemePackageCore.ValidateManifest(
            new Dictionary<string, object> { { "id", "my-theme" }, { "name", "x" }, { "engine", "hax" } }));
    }

    [Fact]
    public void NormalizeManifest_SynthesizesPageAndRewritesResourceId()
    {
        var t = new Dictionary<string, object>
        {
            { "id", "old-id" }, { "name", "旧" }, { "desc", "d" },
            { "page", "themes/evil/evil.html" }, { "product", "pro" }, { "status", "locked" },
            { "engine", "video" },
            { "thumb", "url(/u/old-id/a.mp4) center / cover" },
            { "mediaSrc", "/u/old-id/a.mp4" },
            { "groups", new List<object>() },
        };
        var n = ThemePackageCore.NormalizeManifest(t, "new-id");
        Assert.Equal("new-id", (string)n["id"]);
        Assert.Equal("pages/engine.html", (string)n["page"]);
        Assert.False(n.ContainsKey("product"));
        Assert.False(n.ContainsKey("status"));
        Assert.Equal("url(/u/new-id/a.mp4) center / cover", (string)n["thumb"]);
        Assert.Equal("/u/new-id/a.mp4", (string)n["mediaSrc"]);
        Assert.Equal("video", (string)n["engine"]);
    }
}
