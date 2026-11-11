using Microsoft.Playwright;
using Xunit;

namespace Deskland.Tests;

/// <summary>
/// Deskland E2E 测试：双端口 CDP 连接 + DOM 断言 + 性能埋点
/// 运行：dotnet test
/// </summary>
public class DesklandE2ETests : IAsyncLifetime
{
    private System.Diagnostics.Process? _appProcess;
    private IPlaywright _playwright = null!;
    private IBrowser _wallpaperBrowser = null!;
    private IBrowser _settingsBrowser = null!;
    private IPage _pageWallpaper = null!;
    private IPage _pageSettings = null!;

    private const int WallpaperPort = 9222;
    private const int SettingsPort = 9223;
    private static readonly string DesKlandBin = Path.GetFullPath(Path.Combine(
        AppContext.BaseDirectory, "..", "..", "..", "..", "..", "host", "bin", "Deskland.exe"));
    private static readonly string TestProfile = Path.Combine(
        AppContext.BaseDirectory, "test-profile");

    public async Task InitializeAsync()
    {
        KillProcess("Deskland");
        KillProcess("msedgewebview2");
        await Task.Delay(1000);

        var env = new Dictionary<string, string?>
        {
            ["DESKLAND_TEST"] = "1",
            ["DESKLAND_PROFILE_DIR"] = TestProfile,
        };
        _appProcess = StartProcess(DesKlandBin, "--test --settings", env);

        await WaitForCdpAsync(WallpaperPort);
        await WaitForCdpAsync(SettingsPort);

        _playwright = await Playwright.CreateAsync();
        _wallpaperBrowser = await _playwright.Chromium.ConnectOverCDPAsync($"http://localhost:{WallpaperPort}");
        _settingsBrowser = await _playwright.Chromium.ConnectOverCDPAsync($"http://localhost:{SettingsPort}");

        _pageWallpaper = _wallpaperBrowser.Contexts[0].Pages[0];
        _pageSettings = _settingsBrowser.Contexts[0].Pages[0];

        // 等待首帧（用固定延迟，避免 WaitForFunctionAsync 在 CDP 模式下卡住）
        await Task.Delay(3000);
    }

    public async Task DisposeAsync()
    {
        if (_wallpaperBrowser != null) await _wallpaperBrowser.CloseAsync();
        if (_settingsBrowser != null) await _settingsBrowser.CloseAsync();
        if (_playwright != null) _playwright.Dispose();
        KillProcess("Deskland");
        KillProcess("msedgewebview2");
    }

    [Fact]
    public async Task WallpaperPage_CanvasExists()
    {
        var canvas = _pageWallpaper.Locator("canvas");
        await Assertions.Expect(canvas).ToBeVisibleAsync(new() { Timeout = 15000 });
    }

    [Fact]
    public async Task SettingsPage_TitleIsDesklandPreview()
    {
        Assert.Equal("Deskland Preview", await _pageSettings.TitleAsync());
    }

    [Fact]
    public async Task SettingsPage_BrandVisible()
    {
        var brand = _pageSettings.Locator(".brand");
        await Assertions.Expect(brand).ToBeVisibleAsync();
        var text = await brand.TextContentAsync();
        Assert.Contains("Deskland Preview", text);
    }

    [Fact]
    public async Task SettingsPage_ThemeListRendered()
    {
        var themeList = _pageSettings.Locator("#themes");
        await Assertions.Expect(themeList).ToBeVisibleAsync();
        var count = await themeList.Locator(".theme").CountAsync();
        Assert.True(count > 0, $"主题列表为空");
    }

    [Fact]
    public async Task SettingsPage_AutostartCheckboxExists()
    {
        var autostart = _pageSettings.Locator("#autostart");
        await Assertions.Expect(autostart).ToBeVisibleAsync();
    }

    [Fact]
    public async Task SettingsPage_PreviewCardVisible()
    {
        var preview = _pageSettings.Locator(".preview-card");
        await Assertions.Expect(preview).ToBeVisibleAsync();
    }

    [Fact]
    public async Task TestProbe_EventsWritten()
    {
        var eventsPath = Path.Combine(TestProfile, $"test-events-{_appProcess!.Id}.jsonl");
        var start = DateTime.Now;
        while (DateTime.Now - start < TimeSpan.FromSeconds(10))
        {
            if (File.Exists(eventsPath)) break;
            await Task.Delay(500);
        }
        Assert.True(File.Exists(eventsPath), $"事件文件不存在: {eventsPath}");

        var content = await File.ReadAllTextAsync(eventsPath);
        var events = content.Trim().Split('\n').Select(l =>
        {
            try { return System.Text.Json.JsonDocument.Parse(l); }
            catch { return null; }
        }).Where(e => e != null).ToList();

        var eventNames = events
            .Select(e => e!.RootElement.GetProperty("event").GetString())
            .ToList();

        Assert.Contains("settings_opened", eventNames);
        Assert.Contains("webview2_ready", eventNames);
        Assert.Contains("settings_ready", eventNames);
        Assert.Contains("firstframe", eventNames);
    }

    [Fact]
    public async Task PerfReport_StartupFirstFrameRecorded()
    {
        var eventsPath = Path.Combine(TestProfile, $"test-events-{_appProcess!.Id}.jsonl");
        var start = DateTime.Now;
        while (DateTime.Now - start < TimeSpan.FromSeconds(10))
        {
            if (File.Exists(eventsPath)) break;
            await Task.Delay(500);
        }
        Assert.True(File.Exists(eventsPath), $"事件文件不存在: {eventsPath}");

        var content = await File.ReadAllTextAsync(eventsPath);
        var lines = content.Trim().Split('\n');
        var perfEvents = new List<(string path, double ms)>();

        foreach (var line in lines)
        {
            try
            {
                using var doc = System.Text.Json.JsonDocument.Parse(line);
                if (doc.RootElement.GetProperty("event").GetString() == "perf")
                {
                    var path = doc.RootElement.GetProperty("data").GetProperty("path").GetString()!;
                    var ms = doc.RootElement.GetProperty("data").GetProperty("ms").GetDouble();
                    perfEvents.Add((path, ms));
                }
            }
            catch { }
        }

        Assert.NotEmpty(perfEvents);
        Assert.Contains(perfEvents, e => e.path == "startup_first_frame");

        foreach (var e in perfEvents)
        {
            Console.WriteLine($"  {e.path}: {e.ms:F0} ms");
        }
    }

    private static async Task WaitForCdpAsync(int port, int timeoutMs = 30000)
    {
        var start = DateTime.Now;
        while (DateTime.Now - start < TimeSpan.FromMilliseconds(timeoutMs))
        {
            try
            {
                using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(1) };
                var res = await client.GetAsync($"http://localhost:{port}/json/version");
                if (res.IsSuccessStatusCode) return;
            }
            catch { }
            await Task.Delay(500);
        }
        throw new TimeoutException($"CDP port {port} not ready after {timeoutMs}ms");
    }

    private static System.Diagnostics.Process StartProcess(string fileName, string args, Dictionary<string, string?> env)
    {
        var psi = new System.Diagnostics.ProcessStartInfo
        {
            FileName = fileName,
            Arguments = args,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        foreach (var kv in env) psi.Environment[kv.Key] = kv.Value;
        return System.Diagnostics.Process.Start(psi)!;
    }

    private static void KillProcess(string name)
    {
        try
        {
            foreach (var p in System.Diagnostics.Process.GetProcessesByName(name))
            {
                p.Kill();
                p.WaitForExit(3000);
            }
        }
        catch { }
    }
}
