using Microsoft.Playwright;
using Xunit;

namespace Deskland.Tests;

/// <summary>
/// Deskland E2E 测试：双端口 CDP 连接 + DOM 断言 + 性能埋点
/// 运行：dotnet test
/// </summary>
[System.Runtime.Versioning.SupportedOSPlatform("windows")]
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
    // 本机状态根（测试 profile 等），默认在工作区根的 .local\Deskland，可用 DESKLAND_LOCAL 覆盖
    private static readonly string LocalRoot = Path.GetFullPath(Environment.GetEnvironmentVariable("DESKLAND_LOCAL")
        ?? Path.Combine(RepoRoot, "..", ".local", "Deskland"));
    private static readonly string DesKlandBin = Path.Combine(RepoRoot, "host", "bin", "Deskland.exe");
    private static readonly string TestProfile = Path.Combine(LocalRoot, "test-profile");
    private static readonly string BaselineDir = Path.Combine(RepoRoot, "test", "Deskland.Tests", "baselines");
    private static readonly bool UpdateBaselines =
        Environment.GetEnvironmentVariable("DESKLAND_UPDATE_BASELINES") == "1";
    private const double MaxDiffRatio = 0.02;      // 允许 2% 的像素有差异（抗锯齿/缩放抖动）
    private const int DiffThreshold = 30;          // 单像素 RGB 差值和超过此值才算不同
    private const double ThemeSwitchBudgetMs = 3000;

    public async Task InitializeAsync()
    {
        KillProcess("Deskland");
        KillWebView2ForProfile(TestProfile);
        await Task.Delay(1000);
        Directory.CreateDirectory(TestProfile);

        var env = new Dictionary<string, string?>
        {
            ["DESKLAND_TEST"] = "1",
            ["DESKLAND_PROFILE_DIR"] = TestProfile,
        };
        _appProcess = StartProcess(DesKlandBin, "--test --settings", env);
        await Task.Delay(500);
        if (_appProcess.HasExited)
            throw new InvalidOperationException($"宿主启动后立即退出（exit={_appProcess.ExitCode}）：通常是上一个实例还没被杀干净，单实例互斥生效");

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
        try
        {
            if (_wallpaperBrowser != null) await _wallpaperBrowser.CloseAsync();
            if (_settingsBrowser != null) await _settingsBrowser.CloseAsync();
        }
        finally
        {
            // 初始化失败时 _playwright 仍是 null；无论是否连上，都要把宿主收掉，
            // 否则残留的 Deskland.exe 会一直占着 9222/9223，下一轮测试就连不上
            if (_playwright != null) _playwright.Dispose();
            KillProcess("Deskland");
            KillWebView2ForProfile(TestProfile);
        }
    }

    [Fact]
    public async Task WallpaperPage_CanvasExists()
    {
        var canvas = _pageWallpaper.Locator("canvas");
        await Assertions.Expect(canvas).ToBeVisibleAsync(new() { Timeout = 15000 });
    }

    [Fact]
    public async Task SettingsPage_TitleIsDesklandPlus()
    {
        Assert.Equal("Deskland+", await _pageSettings.TitleAsync());
    }

    [Fact]
    public async Task SettingsPage_BrandVisible()
    {
        var brand = _pageSettings.Locator(".brand");
        await Assertions.Expect(brand).ToBeVisibleAsync();
        var text = await brand.TextContentAsync();
        Assert.Contains("Deskland+", text);
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
    /// 视觉基线：设置页（浅/深）+ 每个 ready 壁纸页。新增 ready 主题时在这里加一条，并重新生成基线。
    /// 壁纸页用固定 performance.now / rAF 时间冻结动画，保证截图可复现（不依赖桌面图标位置）。
    /// 生成基线：设置环境变量 DESKLAND_UPDATE_BASELINES=1 后运行本测试。
    /// </summary>
    [Fact]
    public async Task VisualBaseline_AllScreens()
    {
        Directory.CreateDirectory(BaselineDir);

        // 设置页基线对应沙滩主题；若当前主题不同（别的测试切换过并持久化），先切回沙滩
        var currentTheme = await _pageSettings.EvaluateAsync<string>(
            "document.querySelector('.theme.on') ? document.querySelector('.theme.on').dataset.id : ''");
        if (currentTheme != "beach")
        {
            await _pageSettings.Locator(".theme[data-id='beach']").ClickAsync();
            await _pageSettings.WaitForTimeoutAsync(1500);
            // 等宿主 themeChanged 回执把预览的 loading 去掉，否则截图会带转圈
            try
            {
                await _pageSettings.WaitForFunctionAsync(
                    "() => !document.getElementById('stage').classList.contains('loading')", null,
                    new PageWaitForFunctionOptions { Timeout = 10000 });
            }
            catch (TimeoutException) { }
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
            ("meadow", "themes/meadow/meadow.html"),
            ("sky", "themes/sky/sky.html"),
            ("beach", "themes/beach/beach.html"),
            ("aurora", "themes/aurora/aurora.html"),
        })
        {
            await _pageWallpaper.GotoAsync($"https://app.local/{page}?wallpaper=1");
            // 等宿主图标到达（场按图标重算完成）：分片初始化后引擎就绪更早，
            // 只等首帧会截到还没有图标场的画面
            await _pageWallpaper.WaitForFunctionAsync(
                "() => window.__desklandIcons === true",
                null,
                new PageWaitForFunctionOptions { Timeout = 20000 });
            // 测试把 performance.now 冻结了，页面只画一帧；手动走完形态过渡再画一帧，
            // 否则取到的可能是"图标还没就位"的那一帧（与图标到达形成竞态）
            await _pageWallpaper.EvaluateAsync("window.__dbg && window.__dbg.settle && window.__dbg.settle()");
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
    /// 可访问性（axe-core，WCAG 2.1 A/AA）：设置页不应有 critical/serious 违规。
    /// axe.min.js 由 frontend/package.json 的 axe-core 提供；缺失时给出安装提示。
    /// </summary>
    [Fact]
    public async Task SettingsPage_Axe_WcagA11y()
    {
        var axePath = Path.Combine(RepoRoot, "frontend", "node_modules", "axe-core", "axe.min.js");
        Assert.True(File.Exists(axePath), $"缺少 axe-core：{axePath}（在 frontend 下执行 npm install）");
        await _pageSettings.AddScriptTagAsync(new() { Path = axePath });
        var result = await _pageSettings.EvaluateAsync<System.Text.Json.JsonElement>(
            "async () => await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })");
        var blocking = new List<string>();
        foreach (var v in result.GetProperty("violations").EnumerateArray())
        {
            var impact = v.TryGetProperty("impact", out var i) ? i.GetString() : "";
            if (impact is not ("critical" or "serious")) continue;
            var id = v.GetProperty("id").GetString();
            var help = v.GetProperty("help").GetString();
            var target = "";
            if (v.TryGetProperty("nodes", out var nodes) && nodes.GetArrayLength() > 0
                && nodes[0].TryGetProperty("target", out var t))
            {
                target = t.ValueKind == System.Text.Json.JsonValueKind.Array && t.GetArrayLength() > 0
                    ? t[0].GetString() ?? ""
                    : t.GetString() ?? "";
            }
            blocking.Add($"{impact} {id}: {help} @ {target}");
        }
        Assert.True(blocking.Count == 0,
            "axe 发现 critical/serious 可访问性问题：\n" + string.Join("\n", blocking));
        // 完整报告落盘，供分析与回归对比（本机状态目录，不入库）
        var reportPath = Path.Combine(LocalRoot, "axe-report.json");
        File.WriteAllText(reportPath, result.GetRawText());
        Console.WriteLine($"axe 报告已写入：{reportPath}");
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
            ("themes/meadow/meadow.html", "#a6c46e", "--scene-ground-mid", "0.62 0.75 0.42"),
            ("themes/sky/sky.html", "#6fb3ea", "--scene-sky-day-top", "0.27 0.56 0.88"),
            ("themes/beach/beach.html", "#1aa3c4", "--scene-sea-0", "0.74 0.93 0.87"),
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
            // JS 侧确实把 Token 解析进了 SCENE（否则只会走 fallback，无法证明配置驱动）
            if (page == "themes/meadow/meadow.html")
            {
                Assert.Equal("0.62 0.75 0.42", await _pageWallpaper.EvaluateAsync<string>("window.__dbg.SCENE.groundMid.join(' ')"));
                Assert.Equal("0.56 0.66 0.52", await _pageWallpaper.EvaluateAsync<string>("window.__dbg.SCENE.shadow.join(' ')"));
                Assert.Equal("-0.6 -0.8", await _pageWallpaper.EvaluateAsync<string>("window.__dbg.SCENE.lightDir.join(' ')"));
            }
            else if (page == "themes/sky/sky.html")
            {
                Assert.Equal("0.27 0.56 0.88", await _pageWallpaper.EvaluateAsync<string>("window.__dbg.SCENE.skyDayTop.join(' ')"));
                Assert.Equal("0.78 0.84 0.92", await _pageWallpaper.EvaluateAsync<string>("window.__dbg.SCENE.cloudShadow.join(' ')"));
            }
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
    /// 应用模式（非 wallpaper）冒烟测试：导航到不带查询参数的 meadow.html，页面走浏览器模式，
    /// 渲染演示桌面 / 任务栏 / 面板，并验证基础交互（选中、拖拽、布局切换、滑块、开关、换云、新建、快捷键）。
    /// 视觉基线只覆盖 wallpaper 模式（图标/面板被 body.wall 隐藏），应用层逻辑靠本测试兜底。
    /// </summary>
    [Fact]
    public async Task AppMode_SmokeTest()
    {
        await _pageWallpaper.GotoAsync("https://app.local/themes/meadow/meadow.html");
        await _pageWallpaper.WaitForSelectorAsync("#desktop .icon", new() { Timeout = 15000 });
        await Task.Delay(800);                                  // 等布局 / 面板 / stats 稳定

        // —— DOM 存在性 ——
        Assert.True(await _pageWallpaper.Locator("#desktop .icon").CountAsync() >= 20, "演示桌面应有图标");
        Assert.Equal(5, await _pageWallpaper.Locator("#taskbar .app").CountAsync());
        Assert.True(await _pageWallpaper.Locator("#taskbar").IsVisibleAsync());
        Assert.True(await _pageWallpaper.Locator("#panel").IsVisibleAsync());
        Assert.Equal(3, await _pageWallpaper.Locator("#sliders input[type=range]").CountAsync());
        Assert.Equal(4, await _pageWallpaper.Locator(".seg button").CountAsync());
        Assert.Equal(3, await _pageWallpaper.Locator(".toggles input[type=checkbox]").CountAsync());
        Assert.Equal(1, await _pageWallpaper.Locator("#btnAdd").CountAsync());
        Assert.Equal(1, await _pageWallpaper.Locator("#btnSeed").CountAsync());
        Assert.Contains("动画中", await _pageWallpaper.Locator("#stats").InnerTextAsync());
        Assert.Matches(@"^\d{2}:\d{2}", await _pageWallpaper.Locator("#clock").InnerTextAsync());

        // —— 交互 1：点击图标选中 ——
        var icon = _pageWallpaper.Locator("#desktop .icon").First;
        await icon.ClickAsync();
        Assert.True(await icon.EvaluateAsync<bool>("el => el.classList.contains('sel')"));

        // —— 交互 2：拖动图标改变位置 ——
        var box = await icon.BoundingBoxAsync() ?? throw new InvalidOperationException("icon has no bounding box");
        var before = await icon.EvaluateAsync<string>("el => el.style.left + ',' + el.style.top");
        await _pageWallpaper.Mouse.MoveAsync(box.X + box.Width / 2, box.Y + box.Height / 2);
        await _pageWallpaper.Mouse.DownAsync();
        await _pageWallpaper.Mouse.MoveAsync(box.X + box.Width / 2 + 220, box.Y + box.Height / 2 + 120, new() { Steps = 10 });
        await _pageWallpaper.Mouse.UpAsync();
        await Task.Delay(500);
        Assert.NotEqual(before, await icon.EvaluateAsync<string>("el => el.style.left + ',' + el.style.top"));

        // —— 交互 3：面板折叠 / 展开 ——
        await _pageWallpaper.Locator("#collapse").ClickAsync();
        Assert.True(await _pageWallpaper.EvaluateAsync<bool>("document.getElementById('panel').classList.contains('collapsed')"));
        await _pageWallpaper.Locator("#collapse").ClickAsync();
        Assert.False(await _pageWallpaper.EvaluateAsync<bool>("document.getElementById('panel').classList.contains('collapsed')"));

        // —— 交互 4：切换桌面布局 ——
        var countBefore = await _pageWallpaper.Locator("#desktop .icon").CountAsync();
        await _pageWallpaper.Locator(".seg button[data-v='arranged']").ClickAsync();
        await Task.Delay(600);
        Assert.NotEqual(countBefore, await _pageWallpaper.Locator("#desktop .icon").CountAsync());
        Assert.True(await _pageWallpaper.Locator(".seg button[data-v='arranged']").EvaluateAsync<bool>("el => el.classList.contains('on')"));

        // —— 交互 5：滑块改参数 ——
        await _pageWallpaper.Locator("#sliders input[type=range]").First.EvaluateAsync(
            "el => { el.value = '150'; el.dispatchEvent(new Event('input', { bubbles: true })); }");
        Assert.Equal(150d, await _pageWallpaper.EvaluateAsync<double>("window.__dbg.P.sigma"));

        // —— 交互 6：开关改参数 ——
        await _pageWallpaper.Locator(".toggles input[data-key='debug']").CheckAsync();
        Assert.True(await _pageWallpaper.EvaluateAsync<bool>("window.__dbg.P.debug"));

        // —— 交互 7：换一种云（reseed）——
        var seedBefore = await _pageWallpaper.EvaluateAsync<double>("window.__dbg.seed");
        await _pageWallpaper.Locator("#btnSeed").ClickAsync();
        await Task.Delay(300);
        Assert.NotEqual(seedBefore, await _pageWallpaper.EvaluateAsync<double>("window.__dbg.seed"));

        // —— 交互 8：新建文件 ——
        var n = await _pageWallpaper.Locator("#desktop .icon").CountAsync();
        await _pageWallpaper.Locator("#btnAdd").ClickAsync();
        await Task.Delay(300);
        Assert.Equal(n + 1, await _pageWallpaper.Locator("#desktop .icon").CountAsync());

        // —— 交互 9：H 键隐藏 / 显示面板 ——
        await _pageWallpaper.Keyboard.PressAsync("h");
        Assert.True(await _pageWallpaper.EvaluateAsync<bool>("document.getElementById('panel').classList.contains('hidden')"));
        await _pageWallpaper.Keyboard.PressAsync("h");
        Assert.False(await _pageWallpaper.EvaluateAsync<bool>("document.getElementById('panel').classList.contains('hidden')"));
    }

    /// <summary>
    /// 壁纸模式下的宿主绑定：DeskApp.setupHostMessages 应加 wall 类、
    /// 挂好共享状态，并接收宿主 icons 消息初始化 icons。
    /// （视觉基线只验证画面，宿主消息链路靠本测试兜底。）
    /// </summary>
    [Fact]
    public async Task WallpaperMode_HostBindings()
    {
        await _pageWallpaper.GotoAsync("https://app.local/themes/meadow/meadow.html?wallpaper=1");
        await Task.Delay(2000);
        Assert.True(await _pageWallpaper.EvaluateAsync<bool>("document.body.classList.contains('wall')"),
            "wallpaper 模式应加 wall 类");
        Assert.True(await _pageWallpaper.EvaluateAsync<bool>("Array.isArray(window.icons)"),
            "宿主 icons 消息应已初始化 icons");
        Assert.True(await _pageWallpaper.EvaluateAsync<bool>(
            "typeof window.P === 'object' && typeof window.P.sigma === 'number'"),
            "共享参数应挂到 window（boy/cat 脚本依赖）");
        Assert.True(await _pageWallpaper.EvaluateAsync<bool>("typeof window.gl === 'object' && typeof window.cv === 'object'"),
            "渲染上下文应挂到 window（boy/cat 脚本依赖）");
    }

    /// <summary>
    /// 引擎骨架结构测试（静态源码校验）。
    /// Vite 迁移后 engine/*.js 不再作为独立文件发布（被打包进 assets/*.js），
    /// 运行时无法再 import 源模块，改为直接校验源码的导出 / 继承 / 钩子 / 事件 API。
    /// 运行时行为由 ReadyThemes_WallpaperSmoke（引擎启动）与视觉基线（Token 上色）覆盖。
    /// </summary>
    [Fact]
    public async Task EngineSkeleton_Structure()
    {
        var baseSrc = await File.ReadAllTextAsync(Path.Combine(RepoRoot, "frontend", "src", "engine", "BaseEngine.js"));
        var sceneSrc = await File.ReadAllTextAsync(Path.Combine(RepoRoot, "frontend", "src", "engine", "SceneEngine.js"));

        Assert.Contains("export class BaseEngine", baseSrc);
        Assert.Contains("export class SceneEngine extends BaseEngine", sceneSrc);

        var hooks = new[] { "buildShaders", "buildResources", "update", "render", "dispose", "resize",
                            "sceneToken", "sceneTime", "on", "off", "emit", "start", "stop", "destroy" };
        foreach (var h in hooks)
            Assert.True(baseSrc.Contains(h) || sceneSrc.Contains(h), $"引擎缺少钩子/方法：{h}");

        Assert.Contains("defaultParams", baseSrc);
    }

    /// <summary>
    /// 每个 ready 主题都能经 engine.html 启动：注册表命中、首帧到达、无着色器编译错误。
    /// 视觉基线只覆盖 meadow / sky / beach，这条冒烟把其余主题（如 aurora）也纳入。
    /// </summary>
    [Fact]
    public async Task ReadyThemes_WallpaperSmoke()
    {
        var ids = ReadyThemeIds();
        Assert.True(ids.Count >= 3, $"ready 主题过少：{ids.Count}");
        // 捕获 console.error 与未处理 rejection：着色器编译失败走的是 console.error + throw
        await _pageWallpaper.AddInitScriptAsync(
            "window.__errors = [];" +
            "(function () { var o = console.error.bind(console); console.error = function () {" +
            "  window.__errors.push(Array.prototype.map.call(arguments, String).join(' ')); o.apply(null, arguments); }; })();" +
            "window.addEventListener('unhandledrejection', function (e) { window.__errors.push('rejection: ' + e.reason); });");

        foreach (var id in ids)
        {
            await _pageWallpaper.GotoAsync($"https://app.local/pages/engine.html?theme={id}&wallpaper=1");
            try
            {
                await _pageWallpaper.WaitForFunctionAsync(
                    "() => window.__desklandIcons === true", null,
                    new PageWaitForFunctionOptions { Timeout = 20000 });
            }
            catch (TimeoutException)
            {
                Assert.Fail($"{id} 等不到 __desklandIcons；errors={string.Join(" | ", await _pageWallpaper.EvaluateAsync<string[]>("window.__errors || []"))}");
            }
            Assert.Equal(id, await CurrentThemeAsync());
            var errs = await _pageWallpaper.EvaluateAsync<string[]>("window.__errors || []");
            Assert.True(errs.Length == 0, $"{id} 页面报错：{string.Join(" | ", errs)}");
            var hasParams = await _pageWallpaper.EvaluateAsync<bool>(
                "() => { const P = window.__dbg && window.__dbg.P(); return !!P && typeof P.sigma === 'number'; }");
            Assert.True(hasParams, $"{id} 引擎参数未就绪");
        }
    }

    /// <summary>
    /// 切换主题：只应多一条 theme_switch 埋点，且回执主题与目标一致（旧实现会把 ready 也当首帧，重复打点）。
    /// </summary>
    [Fact]
    public async Task ThemeSwitch_SingleReceipt()
    {
        var original = await CurrentThemeAsync();
        var target = ReadyThemeIds().FirstOrDefault(id => id != original);
        Assert.True(target != null, "没有可切换的 ready 主题");
        var eventsPath = Path.Combine(TestProfile, $"test-events-{_appProcess!.Id}.jsonl");
        await WaitEventsFileAsync(eventsPath);
        var before = ReadPerfEvents(eventsPath).Count(e => e.path == "theme_switch");
        // 热切换不换文档，所以直接在当前页面上装错误捕获（否则要等下次导航才生效）
        await _pageWallpaper.EvaluateAsync(
            "(function () { window.__errors = [];" +
            "var o = console.error.bind(console); console.error = function () {" +
            "  window.__errors.push(Array.prototype.map.call(arguments, String).join(' ')); o.apply(null, arguments); };" +
            "window.addEventListener('unhandledrejection', function (e) { window.__errors.push('rejection: ' + e.reason); }); return true; })()");

        await _pageSettings.Locator($".theme[data-id='{target}']").ClickAsync();
        var deadline = DateTime.Now + TimeSpan.FromSeconds(20);
        while (DateTime.Now < deadline)
        {
            if (await CurrentThemeAsync() == target) break;
            await Task.Delay(200);
        }
        Assert.Equal(target, await CurrentThemeAsync());
        var perfDeadline = DateTime.Now + TimeSpan.FromSeconds(20);
        while (DateTime.Now < perfDeadline)
        {
            if (ReadPerfEvents(eventsPath).Count(e => e.path == "theme_switch") > before) break;
            await Task.Delay(200);
        }
        var switches = ReadPerfEvents(eventsPath).Where(e => e.path == "theme_switch").ToList();
        var pageErrors = await _pageWallpaper.EvaluateAsync<string[]>("window.__errors || []");
        var bootError = await _pageWallpaper.EvaluateAsync<string>("window.__bootError || ''");
        Assert.True(switches.Count == before + 1,
            $"theme_switch 应只多一条，实际多了 {switches.Count - before} 条；URL={_pageWallpaper.Url}；bootError={bootError}；errors={string.Join(" | ", pageErrors)}");

        if (!string.IsNullOrEmpty(original))
        {
            await _pageSettings.Locator($".theme[data-id='{original}']").ClickAsync();
            await Task.Delay(1500);
        }
    }

    /// <summary>
    /// 切换主题后重启应用，应仍停留在该主题：设置持久化 + 启动按 theme id 拉起对应引擎。
    /// </summary>
    [Fact]
    public async Task Theme_PersistsAcrossRestart()
    {
        var original = await CurrentThemeAsync();
        var target = ReadyThemeIds().FirstOrDefault(id => id != original);
        Assert.True(target != null, "没有可切换的 ready 主题");

        await _pageSettings.Locator($".theme[data-id='{target}']").ClickAsync();
        var deadline = DateTime.Now + TimeSpan.FromSeconds(20);
        while (DateTime.Now < deadline)
        {
            if (await CurrentThemeAsync() == target) break;
            await Task.Delay(200);
        }
        Assert.Equal(target, await CurrentThemeAsync());

        // 宿主保存是防抖的：等文件内容真的变成 target，而不是只等文件存在
        var settingsPath = Path.Combine(TestProfile, "settings.json");
        string? savedTheme = null;
        var start = DateTime.Now;
        while (DateTime.Now - start < TimeSpan.FromSeconds(8))
        {
            try
            {
                using var doc = System.Text.Json.JsonDocument.Parse(await File.ReadAllTextAsync(settingsPath));
                savedTheme = doc.RootElement.GetProperty("theme").GetString();
                if (savedTheme == target) break;
            }
            catch { }
            await Task.Delay(300);
        }
        Assert.Equal(target, savedTheme);

        await RestartAppAsync();
        Assert.Equal(target, await CurrentThemeAsync());

        if (!string.IsNullOrEmpty(original))
        {
            await _pageSettings.Locator($".theme[data-id='{original}']").ClickAsync();
            await Task.Delay(1500);
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

    private static List<string> ReadyThemeIds()
    {
        using var doc = System.Text.Json.JsonDocument.Parse(
            File.ReadAllText(Path.Combine(RepoRoot, "frontend", "public", "themes.json")));
        var list = new List<string>();
        foreach (var t in doc.RootElement.GetProperty("themes").EnumerateArray())
            if (t.GetProperty("status").GetString() == "ready") list.Add(t.GetProperty("id").GetString()!);
        return list;
    }

    private async Task<string> CurrentThemeAsync(int timeoutMs = 20000)
    {
        var start = DateTime.Now;
        while (DateTime.Now - start < TimeSpan.FromMilliseconds(timeoutMs))
        {
            try
            {
                var v = await _pageWallpaper.EvaluateAsync<string>("window.__dbg && window.__dbg.theme");
                if (!string.IsNullOrEmpty(v)) return v;
            }
            catch (Microsoft.Playwright.PlaywrightException) { }   // 正在导航：重试
            await Task.Delay(200);
        }
        return "";
    }

    // 重启宿主并重建 CDP 连接（设置持久化后验证启动路径用）
    private async Task RestartAppAsync()
    {
        try { if (_wallpaperBrowser != null) await _wallpaperBrowser.CloseAsync(); } catch { }
        try { if (_settingsBrowser != null) await _settingsBrowser.CloseAsync(); } catch { }
        KillProcess("Deskland");
        KillWebView2ForProfile(TestProfile);
        await Task.Delay(1500);
        var env = new Dictionary<string, string?>
        {
            ["DESKLAND_TEST"] = "1",
            ["DESKLAND_PROFILE_DIR"] = TestProfile,
        };
        _appProcess = StartProcess(DesKlandBin, "--test --settings", env);
        await WaitForCdpAsync(WallpaperPort);
        await WaitForCdpAsync(SettingsPort);
        _wallpaperBrowser = await _playwright.Chromium.ConnectOverCDPAsync($"http://localhost:{WallpaperPort}");
        _settingsBrowser = await _playwright.Chromium.ConnectOverCDPAsync($"http://localhost:{SettingsPort}");
        _pageWallpaper = _wallpaperBrowser.Contexts[0].Pages[0];
        _pageSettings = _settingsBrowser.Contexts[0].Pages[0];
        await Task.Delay(2500);
    }

    private static async Task WaitForCdpAsync(int port, int timeoutMs = 30000)
    {
        var start = DateTime.Now;
        while (DateTime.Now - start < TimeSpan.FromMilliseconds(timeoutMs))
        {
            try
            {
                using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(1) };
                var res = await client.GetAsync($"http://127.0.0.1:{port}/json/version");
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
        // 反复杀到进程真正消失：单实例互斥下，旧进程还活着会让新进程启动后立刻退出
        for (int round = 0; round < 10; round++)
        {
            System.Diagnostics.Process[] procs;
            try { procs = System.Diagnostics.Process.GetProcessesByName(name); }
            catch { return; }
            if (procs.Length == 0) return;
            foreach (var p in procs)
            {
                try { p.Kill(); } catch { }
                try { p.WaitForExit(500); } catch { }
            }
        }
    }

    // 只杀命令行 --user-data-dir 指向本测试 profile 的 WebView2 进程。
    // msedgewebview2.exe 是通用进程名，按名全杀会误伤其他应用
    // （如 GUI.for.Clash 的 WebView2），导致其崩溃。
    private static void KillWebView2ForProfile(string profileDir)
    {
        var marker = profileDir.TrimEnd('\\') + "\\";
        foreach (var p in System.Diagnostics.Process.GetProcessesByName("msedgewebview2"))
        {
            try
            {
                var cmd = GetProcessCommandLine(p.Id);
                if (cmd != null && cmd.IndexOf(marker, StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    p.Kill();
                    p.WaitForExit(3000);
                }
            }
            catch { }
        }
    }

    private static string? GetProcessCommandLine(int processId)
    {
        try
        {
            using var searcher = new System.Management.ManagementObjectSearcher(
                "SELECT CommandLine FROM Win32_Process WHERE ProcessId = " + processId);
            foreach (System.Management.ManagementObject obj in searcher.Get())
                return obj["CommandLine"]?.ToString();
        }
        catch { }
        return null;
    }
}
