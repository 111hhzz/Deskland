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
    private static readonly string RepoRoot = Path.GetFullPath(Path.Combine(
        AppContext.BaseDirectory, "..", "..", "..", "..", ".."));
    private static readonly string DesKlandBin = Path.Combine(RepoRoot, "host", "bin", "Deskland.exe");
    private static readonly string TestProfile = Path.Combine(
        AppContext.BaseDirectory, "test-profile");
    private static readonly string BaselineDir = Path.Combine(RepoRoot, "test", "Deskland.Tests", "baselines");
    private static readonly bool UpdateBaselines =
        Environment.GetEnvironmentVariable("DESKLAND_UPDATE_BASELINES") == "1";
    private const double MaxDiffRatio = 0.02;      // 允许 2% 的像素有差异（抗锯齿/缩放抖动）
    private const int DiffThreshold = 30;          // 单像素 RGB 差值和超过此值才算不同
    private const double ThemeSwitchBudgetMs = 3000;

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

    [Fact]
    public async Task PerfReport_ThemeSwitchUnderThreshold()
    {
        var eventsPath = Path.Combine(TestProfile, $"test-events-{_appProcess!.Id}.jsonl");
        await WaitEventsFileAsync(eventsPath);

        var before = ReadPerfEvents(eventsPath).Count(e => e.path == "theme_switch");
        var originalTheme = await _pageSettings.EvaluateAsync<string>(
            "document.querySelector('.theme.on') ? document.querySelector('.theme.on').dataset.id : ''");

        // 点击一个非当前、未锁定的 ready 主题卡片，触发宿主 LoadPage
        var card = _pageSettings.Locator(".theme:not(.on):not(.locked):not(:disabled)").First;
        await card.ClickAsync();

        var deadline = DateTime.Now + TimeSpan.FromSeconds(20);
        while (DateTime.Now < deadline)
        {
            if (ReadPerfEvents(eventsPath).Count(e => e.path == "theme_switch") > before) break;
            await Task.Delay(200);
        }

        var switches = ReadPerfEvents(eventsPath).Where(e => e.path == "theme_switch").ToList();
        Assert.True(switches.Count > before, "点击主题后未产生 theme_switch 事件");
        var last = switches.Last().ms;
        Console.WriteLine($"  theme_switch: {last:F0} ms（阈值 {ThemeSwitchBudgetMs} ms）");
        Assert.True(last < ThemeSwitchBudgetMs,
            $"theme_switch 耗时 {last:F0}ms，超过阈值 {ThemeSwitchBudgetMs}ms（引入主题 CSS 后不应显著变慢）");

        // 恢复原主题，避免影响其他测试（主题选择会持久化）
        if (!string.IsNullOrEmpty(originalTheme))
        {
            await _pageSettings.Locator($".theme[data-id='{originalTheme}']").ClickAsync();
            await _pageSettings.WaitForTimeoutAsync(1500);
        }
    }

    /// <summary>
    /// 视觉基线：设置页（浅/深）+ 三个壁纸页，共 5 张。
    /// 壁纸页用固定 performance.now / rAF 时间冻结动画，保证截图可复现（不依赖桌面图标位置）。
    /// 生成基线：设置环境变量 DESKLAND_UPDATE_BASELINES=1 后运行本测试。
    /// </summary>
    [Fact]
    public async Task VisualBaseline_FiveScreens()
    {
        Directory.CreateDirectory(BaselineDir);

        // 设置页基线对应沙滩主题；若当前主题不同（别的测试切换过并持久化），先切回沙滩
        var currentTheme = await _pageSettings.EvaluateAsync<string>(
            "document.querySelector('.theme.on') ? document.querySelector('.theme.on').dataset.id : ''");
        if (currentTheme != "beach")
        {
            await _pageSettings.Locator(".theme[data-id='beach']").ClickAsync();
            await _pageSettings.WaitForTimeoutAsync(1500);
        }
        // 把鼠标移到角落，避免前一个测试的点击让卡片停在 hover 态
        await _pageSettings.Mouse.MoveAsync(0, 0);
        await _pageSettings.WaitForTimeoutAsync(200);

        // 1) 设置页：浅色 / 深色（静态 DOM，可整图比对）
        // 预览图是 data URL + decoding=async，等它 decode 完再截图，避免半解码状态
        await _pageSettings.EvaluateAsync(
            "async () => { const i = document.querySelector('#preview'); if (i && i.decode) await i.decode(); }");
        await _pageSettings.EmulateMediaAsync(new() { ColorScheme = ColorScheme.Light });
        await Task.Delay(500);
        Console.WriteLine("  [light] prefers-dark=" + await _pageSettings.EvaluateAsync<bool>("matchMedia('(prefers-color-scheme: dark)').matches"));
        var settingsLight = await _pageSettings.ScreenshotAsync();
        await _pageSettings.EmulateMediaAsync(new() { ColorScheme = ColorScheme.Dark });
        await Task.Delay(500);
        Console.WriteLine("  [dark] prefers-dark=" + await _pageSettings.EvaluateAsync<bool>("matchMedia('(prefers-color-scheme: dark)').matches"));
        var settingsDark = await _pageSettings.ScreenshotAsync();
        await _pageSettings.EmulateMediaAsync(new() { ColorScheme = ColorScheme.Light });

        // 2) 壁纸页：冻结动画时间，避免 WebGL 逐帧差异
        await _pageWallpaper.AddInitScriptAsync(
            "Object.defineProperty(window.performance, 'now', { value: function () { return 1000; } });" +
            "window.requestAnimationFrame = function (cb) { return setTimeout(function () { cb(1000); }, 0); };" +
            "(function () { var s = 123456789; Math.random = function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();");

        var shots = new List<(string name, byte[] png)>
        {
            ("settings-light", settingsLight),
            ("settings-dark", settingsDark),
        };
        foreach (var (id, page) in new (string id, string page)[]
        {
            ("meadow", "meadow.html"),
            ("sky", "sky.html"),
            ("beach", "flat.html"),
        })
        {
            await _pageWallpaper.GotoAsync($"https://app.local/{page}?wallpaper=1");
            await Task.Delay(2000);        // 等首帧、淡入与形态过渡
            shots.Add(($"wallpaper-{id}", await _pageWallpaper.ScreenshotAsync()));
        }

        var failures = new List<string>();
        foreach (var (name, png) in shots)
        {
            var path = Path.Combine(BaselineDir, name + ".png");
            if (UpdateBaselines)
            {
                await File.WriteAllBytesAsync(path, png);
                Console.WriteLine($"  generated {name}.png");
                continue;
            }
            Assert.True(File.Exists(path),
                $"缺少视觉基线：{path}（设置 DESKLAND_UPDATE_BASELINES=1 可重新生成）");
            var expected = await File.ReadAllBytesAsync(path);
            var ratio = await ImageDiffRatioAsync(png, expected);
            Console.WriteLine($"  {name}: diff {ratio:P2}");
            if (ratio > MaxDiffRatio)
            {
                await File.WriteAllBytesAsync(Path.Combine(BaselineDir, "actual-" + name + ".png"), png);
                failures.Add($"{name} 与基线差异过大：{ratio:P2}（阈值 {MaxDiffRatio:P2}）");
            }
        }
        Assert.Empty(failures);
    }

    /// <summary>
    /// 验证 base.css + theme.css 的 Token 真正作用到页面：
    /// 主题色 / 场景调色板来自 theme.css，公共组件样式来自 base.css。
    /// （壁纸模式下面板/任务栏被隐藏，视觉基线覆盖不到这些样式，故用计算样式断言。）
    /// </summary>
    [Fact]
    public async Task ThemeTokens_AppliedToPage()
    {
        var cases = new (string page, string bg, string sceneName, string sceneValue)[]
        {
            ("meadow.html", "#a6c46e", "--scene-ground-mid", "0.62 0.75 0.42"),
            ("sky.html", "#6fb3ea", "--scene-sky-day-top", "0.27 0.56 0.88"),
            ("flat.html", "#1aa3c4", "--scene-sea-0", "0.74 0.93 0.87"),
        };
        foreach (var (page, bg, sceneName, sceneValue) in cases)
        {
            await _pageWallpaper.GotoAsync($"https://app.local/{page}?wallpaper=1");
            await Task.Delay(1200);
            const string root = "getComputedStyle(document.documentElement)";
            Assert.Equal(bg,
                await _pageWallpaper.EvaluateAsync<string>($"{root}.getPropertyValue('--color-bg').trim()"));
            Assert.Equal(sceneValue,
                await _pageWallpaper.EvaluateAsync<string>($"{root}.getPropertyValue('{sceneName}').trim()"));
            // 公共 Token（base.css）
            Assert.Equal("48px",
                await _pageWallpaper.EvaluateAsync<string>($"{root}.getPropertyValue('--taskbar-size').trim()"));
            Assert.Equal("250ms",
                await _pageWallpaper.EvaluateAsync<string>($"{root}.getPropertyValue('--motion-fade').trim()"));
            // 组件计算样式
            Assert.Equal("rgba(28, 32, 38, 0.6)",
                await _pageWallpaper.EvaluateAsync<string>("getComputedStyle(document.querySelector('#taskbar')).backgroundColor"));
            Assert.Equal("12px",
                await _pageWallpaper.EvaluateAsync<string>("getComputedStyle(document.querySelector('#panel')).borderRadius"));
            Assert.Equal("rgba(20, 52, 64, 0.74)",
                await _pageWallpaper.EvaluateAsync<string>("getComputedStyle(document.querySelector('#panel')).backgroundColor"));
        }
    }

    /// <summary>
    /// 在浏览器里解码两张 PNG 并逐像素比较，返回差异像素占比（0~1）。
    /// 不引入图像处理库：用 WebView2 页面的 canvas 解码。
    /// </summary>
    private async Task<double> ImageDiffRatioAsync(byte[] actual, byte[] expected)
    {
        await _pageSettings.SetContentAsync("<html><body></body></html>");
        var result = await _pageSettings.EvaluateAsync<ImageDiff>(@"
            ([a, b, th]) => new Promise(resolve => {
              const load = src => new Promise(res => {
                const img = new Image(); img.onload = () => res(img); img.src = src;
              });
              Promise.all([load(a), load(b)]).then(([ia, ib]) => {
                if (ia.width !== ib.width || ia.height !== ib.height) {
                  resolve({ error: 'size', aw: ia.width, ah: ia.height, bw: ib.width, bh: ib.height });
                  return;
                }
                const c = document.createElement('canvas'); c.width = ia.width; c.height = ia.height;
                const ctx = c.getContext('2d');
                ctx.drawImage(ia, 0, 0);
                const da = ctx.getImageData(0, 0, c.width, c.height).data;
                ctx.clearRect(0, 0, c.width, c.height);
                ctx.drawImage(ib, 0, 0);
                const db = ctx.getImageData(0, 0, c.width, c.height).data;
                let diff = 0;
                for (let i = 0; i < da.length; i += 4) {
                  const d = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
                  if (d > th) diff++;
                }
                resolve({ diff: diff, total: da.length / 4, ratio: diff / (da.length / 4) });
              });
            })
        ", new object[] { "data:image/png;base64," + Convert.ToBase64String(actual), "data:image/png;base64," + Convert.ToBase64String(expected), DiffThreshold });

        if (result.Error == "size")
            throw new InvalidOperationException(
                $"基线尺寸不匹配：actual {result.Aw}x{result.Ah}，baseline {result.Bw}x{result.Bh}");
        return result.Ratio;
    }

    private static async Task WaitEventsFileAsync(string path)
    {
        var start = DateTime.Now;
        while (DateTime.Now - start < TimeSpan.FromSeconds(10))
        {
            if (File.Exists(path)) return;
            await Task.Delay(500);
        }
        throw new FileNotFoundException($"事件文件不存在: {path}");
    }

    private static List<(string path, double ms)> ReadPerfEvents(string eventsPath)
    {
        var list = new List<(string path, double ms)>();
        if (!File.Exists(eventsPath)) return list;
        foreach (var line in File.ReadAllLines(eventsPath))
        {
            try
            {
                using var doc = System.Text.Json.JsonDocument.Parse(line);
                if (doc.RootElement.GetProperty("event").GetString() == "perf")
                {
                    var path = doc.RootElement.GetProperty("data").GetProperty("path").GetString()!;
                    var ms = doc.RootElement.GetProperty("data").GetProperty("ms").GetDouble();
                    list.Add((path, ms));
                }
            }
            catch { }
        }
        return list;
    }

    private sealed class ImageDiff
    {
        public string? Error { get; set; }
        public long Aw { get; set; }
        public long Ah { get; set; }
        public long Bw { get; set; }
        public long Bh { get; set; }
        public long Diff { get; set; }
        public long Total { get; set; }
        public double Ratio { get; set; }
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
