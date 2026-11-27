using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
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
    // 视觉基线的固定 seed：引擎构造时 seed 随机，只有设置里带 seed 画面才确定
    private const int FixedSeed = 123456;

    public async Task InitializeAsync()
    {
        KillProcess("Deskland");
        KillWebView2ForProfile(TestProfile);
        await Task.Delay(1000);
        Directory.CreateDirectory(TestProfile);
        // 每个用例都从干净且确定的设置开始：引擎初始 seed 是随机的（SceneEngine 构造），
        // 只有 params 带 seed 才确定。不固定的话壁纸页画面每次不同，视觉基线必然 flaky。
        try
        {
            var seedParams = new JsonObject();
            foreach (var id in ReadyThemeIds()) seedParams[id] = new JsonObject { ["seed"] = FixedSeed };
            var json = new JsonObject
            {
                ["version"] = 1,
                ["theme"] = "beach",
                ["lang"] = "auto",
                ["themeMode"] = "auto",
                ["clickThrough"] = true,
                ["params"] = seedParams,
            };
            File.WriteAllText(Path.Combine(TestProfile, "settings.json"), json.ToJsonString());
        }
        catch { }

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

    /// <summary>
    /// 搜索过滤：输入不匹配的关键字后，卡片必须被 hidden 隐藏（数量归零）。
    /// 防回归：.theme{display:flex} 曾覆盖 UA 的 [hidden]，导致过滤完全失效。
    /// </summary>
    [Fact]
    public async Task SettingsPage_SearchFiltersThemes()
    {
        var list = _pageSettings.Locator("#themes");
        var total = await list.Locator(".theme").CountAsync();
        Assert.True(total > 1, "主题数不足，无法验证过滤");

        await _pageSettings.FillAsync("#themeSearch", "zzzz-not-a-theme");
        Assert.Equal(0, await list.Locator(".theme:visible").CountAsync());

        await _pageSettings.FillAsync("#themeSearch", "");
        Assert.Equal(total, await list.Locator(".theme:visible").CountAsync());
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

    /// <summary>
    /// orb「循环更换形态」开关（bool 参数）：设置卡片关闭 → 持久化 + 下发到壁纸引擎。
    /// 覆盖 bool 参数全链路：Controls 渲染开关 → set 消息 → settings.json → 引擎 params（displayKeys 声明过的键才会被接受）。
    /// </summary>
    [Fact]
    public async Task SettingsPage_OrbAutoCycleToggle_PersistsAndApplies()
    {
        await _pageSettings.Locator("#themes .theme[data-id='orb']").ClickAsync();
        Assert.True(await WaitJsBoolAsync("() => !!window.__dbg && window.__dbg.theme === 'orb'"),
            "壁纸未切到 orb");

        var toggle = _pageSettings.Locator("#p-autoCycle input[type=checkbox]");
        await Assertions.Expect(toggle).ToBeVisibleAsync();
        Assert.True(await toggle.IsCheckedAsync(), "默认应开启循环更换");
        // 自定义开关的滑块 span 覆盖在 input 上，Playwright 点击会被拦截；走 DOM click
        await toggle.EvaluateAsync("el => el.click()");
        Assert.False(await toggle.IsCheckedAsync());
        Assert.Equal("关", (await _pageSettings.Locator("#v-autoCycle").InnerTextAsync()).Trim());

        // 持久化：settings.json params.orb.autoCycle == false（宿主 SaveSoon 有防抖，轮询等待）
        var path = Path.Combine(TestProfile, "settings.json");
        System.Text.Json.Nodes.JsonValue? autoCycle = null;
        var deadline = DateTime.Now + TimeSpan.FromSeconds(8);
        while (DateTime.Now < deadline)
        {
            var probe = System.Text.Json.Nodes.JsonObject.Parse(await File.ReadAllTextAsync(path))!;
            autoCycle = probe["params"]?["orb"]?["autoCycle"] as System.Text.Json.Nodes.JsonValue;
            if (autoCycle is not null) break;
            await Task.Delay(200);
        }
        Assert.NotNull(autoCycle);
        Assert.False(autoCycle!.GetValue<bool>(), "autoCycle 未持久化");

        // 下发：宿主把 set 应用到当前壁纸引擎
        Assert.True(await WaitJsBoolAsync("() => !!window.__dbg.P && window.__dbg.P().autoCycle === false", 8000),
            "autoCycle 未下发到 orb 引擎");
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
    // 视觉基线依赖真实 GPU / DPI / 字体渲染，CI（无 GPU、软件渲染）上必然与本机像素不同，
    // 因此单独打标：L1 用 Category!=visual 排除，L2 用 Category=visual 只跑本项，且 L2 永不作硬门禁。
    [Trait("Category", "visual")]
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
            // 渲染路径里仍有 Math.random（云的呼吸等），序列必须可重置，
            // 否则"settle 前跑了几帧"会让每次截图取到不同的云形状
            "(function () { var s = 123456789; window.__resetRand = function () { s = 123456789; };" +
            "Math.random = function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();");

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
            ("orb", "themes/orb/orb.html"),
        })
        {
            await _pageWallpaper.GotoAsync($"https://deskland.test/{page}?wallpaper=1");
            // 等宿主图标到达（场按图标重算完成）：分片初始化后引擎就绪更早，
            // 只等首帧会截到还没有图标场的画面
            await _pageWallpaper.WaitForFunctionAsync(
                "() => window.__desklandIcons === true",
                null,
                new PageWaitForFunctionOptions { Timeout = 20000 });
            // 云团形状绕着桌面图标走，而真实桌面图标布局随机器 / 会话变化——这是基线反复漂移的根因。
            // 改用内置的确定性布局（mineCells 固定格子）重摆图标，截图与桌面状态无关。
            await _pageWallpaper.EvaluateAsync("window.__dbg && window.__dbg.applyLayout && window.__dbg.applyLayout('mine')");
            // 测试把 performance.now 冻结了，页面只画一帧；手动走完形态过渡再画一帧，
            // 否则取到的可能是"图标还没就位"的那一帧（与图标到达形成竞态）。
            // 截图前把随机序列归位，保证这一帧与之前跑了几帧无关。
            await _pageWallpaper.EvaluateAsync("window.__resetRand && window.__resetRand()");
            await _pageWallpaper.EvaluateAsync("window.__dbg && window.__dbg.settle && window.__dbg.settle()");
            // ripple 的入场淡入（模块顶部启动）在截图时可能未结束，body 还处于半透明；
            // 等它把注入的 style / class 摘掉、opacity 回到 1 再截图，否则整图被淡入权重污染。
            await _pageWallpaper.WaitForTimeoutAsync(600);
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
            await _pageWallpaper.GotoAsync($"https://deskland.test/{page}?wallpaper=1");
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
        await _pageWallpaper.GotoAsync("https://deskland.test/themes/meadow/meadow.html");
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
    /// 壁纸模式下的宿主绑定：DeskApp.setupHostMessages 应加 wall 类，
    /// 并接收宿主 icons 消息初始化引擎 icons（__desklandIcons 信号）。
    /// P4 第 3 步起 legacy 模块走 LegacyHost 显式注入，window 上不再有 P/gl/cv 桥接。
    /// （视觉基线只验证画面，宿主消息链路靠本测试兜底。）
    /// </summary>
    [Fact]
    public async Task WallpaperMode_HostBindings()
    {
        await _pageWallpaper.GotoAsync("https://deskland.test/themes/meadow/meadow.html?wallpaper=1");
        await Task.Delay(2000);
        Assert.True(await _pageWallpaper.EvaluateAsync<bool>("document.body.classList.contains('wall')"),
            "wallpaper 模式应加 wall 类");
        Assert.True(await _pageWallpaper.EvaluateAsync<bool>("window.__desklandIcons === true"),
            "宿主 icons 消息应已初始化引擎 icons");
        Assert.True(await _pageWallpaper.EvaluateAsync<bool>(
            "!!window.__dbg && !!window.__dbg.P && typeof window.__dbg.P.sigma === 'number'"),
            "引擎参数应经 __dbg 暴露（替代原 window.P 桥接）");
        Assert.True(await _pageWallpaper.EvaluateAsync<bool>(
            "typeof window.P === 'undefined' && typeof window.gl === 'undefined' && typeof window.cv === 'undefined'"),
            "P4 第 3 步后 window 不应再有 legacy 桥接字段");
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
        var baseSrc = await File.ReadAllTextAsync(Path.Combine(RepoRoot, "frontend", "src", "engine", "BaseEngine.ts"));
        var sceneSrc = await File.ReadAllTextAsync(Path.Combine(RepoRoot, "frontend", "src", "engine", "SceneEngine.ts"));

        Assert.Contains("export class BaseEngine", baseSrc);
        Assert.Contains("export class SceneEngine extends BaseEngine", sceneSrc);

        var hooks = new[] { "buildShaders", "buildResources", "update", "render", "dispose", "resize",
                            "sceneToken", "sceneTime", "on", "off", "emit", "start", "stop", "destroy" };
        foreach (var h in hooks)
            Assert.True(baseSrc.Contains(h) || sceneSrc.Contains(h), $"引擎缺少钩子/方法：{h}");

        Assert.Contains("defaultParams", baseSrc);

        // 场景引擎：每个 ready 主题都要有对应的 scenes/<Class>.ts，且
        //   1) 声明了非空片元着色器（static FS + 着色器入口 void main）；
        //   2) theme.json 开放的每个参数都在 defaultParams 里给了默认值。
        // 这两条挡住两类静默故障：主题加了却忘接入引擎、设置页加了开关却没有默认值。
        var srcDir = Path.Combine(RepoRoot, "frontend", "src");
        var scenesDir = Path.Combine(srcDir, "scenes");
        var themesDir = Path.Combine(RepoRoot, "frontend", "public", "themes");
        var mainSrc = await File.ReadAllTextAsync(Path.Combine(srcDir, "engine", "main.tsx"));
        var registry = Regex.Matches(mainSrc, @"(?m)^\s*(\w+):\s*\(\)\s*=>\s*(\w+),")
            .Cast<Match>()
            .ToDictionary(m => m.Groups[1].Value, m => m.Groups[2].Value);

        foreach (var id in ReadyThemeIds())
        {
            Assert.True(registry.ContainsKey(id), $"引擎注册表缺少 ready 主题：{id}");
            var cls = registry[id];
            var scenePath = Path.Combine(scenesDir, cls + ".ts");
            Assert.True(File.Exists(scenePath), $"缺少场景引擎源码：{scenePath}");
            var engineSrc = await File.ReadAllTextAsync(scenePath);

            Assert.Contains("static override FS", engineSrc, StringComparison.Ordinal);
            // 片元着色器入口允许落在同目录的着色器资产文件里（如 FlatEngine → flatShade.ts）：
            // 引擎自身含 void main，或文件名包含类名主干（去 Engine 后缀）的场景文件含 void main 均可
            var stem = Regex.Replace(cls, "Engine$", "").ToLowerInvariant();
            var hasMain = engineSrc.Contains("void main") || Directory.EnumerateFiles(scenesDir, "*.ts")
                .Any(f => Path.GetFileName(f).ToLowerInvariant().Contains(stem) &&
                          File.ReadAllText(f).Contains("void main"));
            Assert.True(hasMain, $"{cls} 缺少片元着色器入口 void main");

            // 参数数据面单一真相 = theme.json.groups → scripts/build-params.mjs 生成的 paramDefs.ts；
            // 引擎只经 paramDefaults / paramSliders / paramDisplays 引用它（见 engine/paramSchema.ts）。
            // 这里挡两类静默故障：主题加了却忘接入引擎、theme.json 加了参数却没进生成物（params:check 同步门禁）。
            var defaults = Regex.Match(engineSrc, @"defaultParams\(\)");
            Assert.True(defaults.Success, $"{cls} 缺少 defaultParams");
            Assert.Contains($"paramDefaults('{id}')", engineSrc, StringComparison.Ordinal);
            var paramDefsSrc = await File.ReadAllTextAsync(Path.Combine(srcDir, "engine", "paramDefs.ts"));
            using var manifest = System.Text.Json.JsonDocument.Parse(
                File.ReadAllText(Path.Combine(themesDir, id, "theme.json")));
            foreach (var group in manifest.RootElement.GetProperty("groups").EnumerateArray())
                foreach (var param in group.GetProperty("params").EnumerateArray())
                {
                    var key = param.GetProperty("key").GetString()!;
                    Assert.Contains("\"" + key + "\":", paramDefsSrc, StringComparison.Ordinal);
                }
        }

        // P4 第 3 步：legacy 已整体 TS 化进 src/，public 下不再有经典 .js 脚本；
        // 装配统一走 legacyInstall，动态插 script 的老路（EXTRAS / loadScript）与 window 桥接都已删除。
        var frontendRoot = Path.Combine(RepoRoot, "frontend");
        Assert.Empty(Directory.EnumerateFiles(srcDir, "*.js", SearchOption.AllDirectories));
        Assert.Empty(Directory.EnumerateFiles(Path.Combine(frontendRoot, "public"), "*.js", SearchOption.AllDirectories));
        var installSrc = await File.ReadAllTextAsync(Path.Combine(srcDir, "engine", "legacyInstall.ts"));
        Assert.Contains("installLegacyFor", installSrc, StringComparison.Ordinal);
        Assert.Contains("installLegacy", await File.ReadAllTextAsync(Path.Combine(scenesDir, "MeadowEngine.ts")), StringComparison.Ordinal);
        Assert.Contains("installLegacy", await File.ReadAllTextAsync(Path.Combine(scenesDir, "FlatEngine.ts")), StringComparison.Ordinal);
        Assert.DoesNotContain("EXTRAS", mainSrc, StringComparison.Ordinal);
        Assert.DoesNotContain("loadScript", mainSrc, StringComparison.Ordinal);
        var globalDts = await File.ReadAllTextAsync(Path.Combine(srcDir, "global.d.ts"));
        Assert.DoesNotContain("prepareMeadowBoy", globalDts, StringComparison.Ordinal);
        Assert.DoesNotContain("BEACH_PALM", globalDts, StringComparison.Ordinal);
        Assert.DoesNotContain("mountToWindow", globalDts, StringComparison.Ordinal);

        // legacy 场景必须在引擎 destroy 时释放自己的 GL 句柄：热切换复用同一 WebGL 上下文，
        // 只增不减会持续累积纹理 / FBO。
        var legacyFiles = Directory.EnumerateFiles(Path.Combine(srcDir, "themes"), "*.ts", SearchOption.AllDirectories)
            .Where(p => p.Contains("legacy", StringComparison.Ordinal)).ToList();
        Assert.NotEmpty(legacyFiles);
        foreach (var f in legacyFiles)
            Assert.Contains("dispose(): void", await File.ReadAllTextAsync(f), StringComparison.Ordinal);
        var meadowEngineSrc = await File.ReadAllTextAsync(Path.Combine(scenesDir, "MeadowEngine.ts"));
        Assert.Contains("_boy?.dispose()", meadowEngineSrc, StringComparison.Ordinal);
        Assert.Contains("_catScene?.dispose()", meadowEngineSrc, StringComparison.Ordinal);
        Assert.Contains("_palms?.dispose()", await File.ReadAllTextAsync(Path.Combine(scenesDir, "FlatEngine.ts")), StringComparison.Ordinal);

        // 每个 ready 主题页都恰好 import 一次 ripple（ES 模块缓存保证只装一次），
        // 且不再用 <script src> 插经典脚本；meadow / beach 还须经 legacyInstall 装配 legacy。
        foreach (var id in ReadyThemeIds())
        {
            var page = await File.ReadAllTextAsync(Path.Combine(srcDir, "themes", id, id + ".html"));
            Assert.Single(Regex.Matches(page, Regex.Escape("import '../../lib/ripple.js';")));
            Assert.DoesNotContain("<script src=\"/lib/ripple.js\">", page, StringComparison.Ordinal);
            if (id is "meadow" or "beach")
                Assert.Contains("installLegacyFor('" + id + "'", page, StringComparison.Ordinal);
        }

        // C1：云机制（圆纹理 + 天上的云）已从 SceneEngine 剥离到 CloudSceneEngine；
        // 天空系主题继承 CloudSceneEngine（meadow 经 ActorSceneEngine 间接继承），
        // 无云的海滩直接继承 SceneEngine（不再背负死代码）。
        var cloudSrc = await File.ReadAllTextAsync(Path.Combine(srcDir, "engine", "CloudSceneEngine.ts"));
        Assert.Contains("export class CloudSceneEngine extends SceneEngine", cloudSrc, StringComparison.Ordinal);
        foreach (var api in new[] { "makeSkyCloud", "stepSkyClouds", "uploadCircles", "buildMassCircles", "skyClouds" })
        {
            Assert.Contains(api, cloudSrc, StringComparison.Ordinal);
            Assert.DoesNotContain(api, sceneSrc, StringComparison.Ordinal);
        }
        // 云钩子必须被 CloudSceneEngine 全部覆盖（漏覆盖会静默无云）；SceneEngine 里不留云实现细节
        foreach (var hook in new[] { "override uploadClouds", "override bindCloudUniforms", "override resetClouds", "override settleClouds", "override disposeClouds" })
            Assert.Contains(hook, cloudSrc, StringComparison.Ordinal);
        foreach (var api in new[] { "circTex", "massList", "flowT", "CELL_G", "SETTLE_DT" })
            Assert.DoesNotContain(api, sceneSrc, StringComparison.Ordinal);
        foreach (var cls in new[] { "SkyEngine", "AuroraEngine" })
            Assert.Contains("extends CloudSceneEngine",
                await File.ReadAllTextAsync(Path.Combine(scenesDir, cls + ".ts")), StringComparison.Ordinal);
        var flatSrc = await File.ReadAllTextAsync(Path.Combine(scenesDir, "FlatEngine.ts"));
        Assert.Contains("extends SceneEngine", flatSrc, StringComparison.Ordinal);
        Assert.DoesNotContain("CloudSceneEngine", flatSrc, StringComparison.Ordinal);

        // 人物 / 小猫（meadow 专用）已从 SceneEngine 剥离到 ActorSceneEngine（继承 CloudSceneEngine）
        var actorSrc = await File.ReadAllTextAsync(Path.Combine(srcDir, "engine", "ActorSceneEngine.ts"));
        Assert.Contains("export class ActorSceneEngine extends CloudSceneEngine", actorSrc, StringComparison.Ordinal);
        foreach (var api in new[] { "actorPR", "catPR", "actorTex", "catTex" })
        {
            Assert.Contains(api, actorSrc, StringComparison.Ordinal);
            Assert.DoesNotContain(api, sceneSrc, StringComparison.Ordinal);
        }
        // 调用点必须挂在 SceneEngine 骨架上（否则人物绑定根本不会发生）
        foreach (var call in new[] { "this.bindActorUniforms(U, withCat)", "this.disposeActor()" })
            Assert.Contains(call, sceneSrc, StringComparison.Ordinal);
        // 其他主题不得覆写人物钩子 / 引用人物字段（防未来误覆盖静默生效）
        foreach (var src in new[] { "SkyEngine.ts", "AuroraEngine.ts", "FlatEngine.ts" })
        {
            var s = await File.ReadAllTextAsync(Path.Combine(scenesDir, src));
            Assert.DoesNotContain("override bindActorUniforms", s, StringComparison.Ordinal);
            Assert.DoesNotContain("actorPR", s, StringComparison.Ordinal);
        }
        Assert.Contains("extends ActorSceneEngine",
            await File.ReadAllTextAsync(Path.Combine(scenesDir, "MeadowEngine.ts")), StringComparison.Ordinal);

        // 着色器层红线：人物 / 小猫的 ifdef 段与 GLSL_MEADOW_EXTRA 只允许 meadow 有（其他主题曾复制回来过）
        foreach (var src in new[] { "SkyEngine.ts", "AuroraEngine.ts", "FlatEngine.ts", "flatShade.ts" })
        {
            var s = await File.ReadAllTextAsync(Path.Combine(scenesDir, src));
            Assert.DoesNotContain("#ifdef MEADOW_", s, StringComparison.Ordinal);
            Assert.DoesNotContain("uActor", s, StringComparison.Ordinal);
            Assert.DoesNotContain("uCat", s, StringComparison.Ordinal);
            Assert.DoesNotContain("GLSL_MEADOW_EXTRA", s, StringComparison.Ordinal);
            Assert.DoesNotContain("segSD", s, StringComparison.Ordinal);
        }
        var meadowSrc = await File.ReadAllTextAsync(Path.Combine(scenesDir, "MeadowEngine.ts"));
        Assert.Contains("withDefines", meadowSrc, StringComparison.Ordinal);
        Assert.Contains("GLSL_MEADOW_EXTRA", meadowSrc, StringComparison.Ordinal);

        // 死 uniform / 死参数：FlatEngine 曾声明并绑定 uWaves，但着色器主体从不使用，
        // 参数 waves 也随之无人消费；两者都应清零（否则会误以为海滩有“浪的层数”可调）
        Assert.DoesNotContain("uWaves", flatSrc, StringComparison.Ordinal);
        Assert.DoesNotContain("waves:", flatSrc, StringComparison.Ordinal);
        Assert.DoesNotContain("numParam(P, 'waves')", flatSrc, StringComparison.Ordinal);
        // segD（点到线段距离）唯一事实来源在 common.ts：FlatEngine 曾自带一份等价的 segSD，
        // 且必须仍被桨的绘制使用（删了调用会让桨杆消失）。着色器资产已拆到 flatShade.ts，检查随之迁移。
        Assert.DoesNotContain("segSD", flatSrc, StringComparison.Ordinal);
        var flatShadeSrc = await File.ReadAllTextAsync(Path.Combine(scenesDir, "flatShade.ts"));
        Assert.DoesNotContain("segSD", flatShadeSrc, StringComparison.Ordinal);
        Assert.Contains("segD(", flatShadeSrc, StringComparison.Ordinal);
        Assert.Contains("GLSL_SEG", flatShadeSrc, StringComparison.Ordinal);
        var commonSrc = await File.ReadAllTextAsync(Path.Combine(srcDir, "engine", "glsl", "common.ts"));
        Assert.Single(Regex.Matches(commonSrc, Regex.Escape("float segD(")));
        Assert.Contains("export const GLSL_SEG", commonSrc, StringComparison.Ordinal);
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
            await _pageWallpaper.GotoAsync($"https://deskland.test/pages/engine.html?theme={id}&wallpaper=1");
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
    /// 手动刷新主题：往 prototype/themes/ 投一个已登记的新主题，点「刷新主题」后设置页应出现它的卡片；
    /// 没登记进 _products.json 的目录保持被忽略。运行期改动的是构建产物，结束一定还原。
    /// </summary>
    [Fact]
    public async Task ThemeRefresh_PicksUpNewRegisteredFolder()
    {
        var themesDir = Path.Combine(RepoRoot, "host", "bin", "prototype", "themes");
        var productsPath = Path.Combine(themesDir, "_products.json");
        var backup = File.ReadAllText(productsPath);
        var id = "e2etmp";
        var registered = Path.Combine(themesDir, id);
        var unregistered = Path.Combine(themesDir, "e2eignored");
        try
        {
            Directory.CreateDirectory(registered);
            File.WriteAllText(Path.Combine(registered, "theme.json"),
                "{\"id\":\"e2etmp\",\"name\":\"E2E 临时\",\"page\":\"themes/e2etmp/e2etmp.html\",\"thumb\":\"#334455\",\"groups\":[]}");
            File.WriteAllText(Path.Combine(registered, "e2etmp.html"), "<!DOCTYPE html><title>e2e</title>");
            Directory.CreateDirectory(unregistered);   // 故意不登记：应被扫描忽略

            var node = JsonNode.Parse(backup)!;
            node["themes"]!.AsArray().Add(new JsonObject { ["id"] = id, ["status"] = "ready", ["product"] = "free" });
            File.WriteAllText(productsPath, node.ToJsonString());

            await _pageSettings.WaitForSelectorAsync("#refreshThemes",
                new PageWaitForSelectorOptions { Timeout = 20000 });
            await _pageSettings.Locator("#refreshThemes").ClickAsync();
            await _pageSettings.WaitForSelectorAsync(
                $".theme[data-id='{id}']",
                new PageWaitForSelectorOptions { Timeout = 15000 });
            Assert.Equal(0, await _pageSettings.Locator(".theme[data-id='e2eignored']").CountAsync());
            // 宿主回执后刷新按钮要恢复可用，不能一直转
            await _pageSettings.WaitForFunctionAsync(
                "!document.querySelector('#refreshThemes').disabled",
                null, new PageWaitForFunctionOptions { Timeout = 15000 });
        }
        finally
        {
            if (Directory.Exists(registered)) Directory.Delete(registered, true);
            if (Directory.Exists(unregistered)) Directory.Delete(unregistered, true);
            File.WriteAllText(productsPath, backup);
        }
    }

    /// <summary>
    /// 用户导入图片主题全链路：往 test-profile/user-themes/&lt;id&gt;/ 投放 theme.json + 素材（模拟导入产物），
    /// 点「刷新主题」后设置页应出现该条目；点击切换到它应热切换成功、背景层图片真的加载
    /// （经 pageDir/u/<id>/ 镜像可达）、token 覆盖注入 :root、运行时参数声明装配完成。结束还原。
    /// </summary>
    [Fact]
    public async Task MediaTheme_UserThemeHotSwitchAndRender()
    {
        var original = await CurrentThemeAsync();
        var id = "img-e2e";
        var dir = Path.Combine(TestProfile, "user-themes", id);
        // 1x1 真实 PNG（可解码；宿主导入的 magic bytes 校验走单测，此处验证渲染链路）
        var png = Convert.FromBase64String(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==");
        try
        {
            Directory.CreateDirectory(dir);
            File.WriteAllBytes(Path.Combine(dir, "a.png"), png);
            File.WriteAllText(Path.Combine(dir, "theme.json"),
                "{\"id\":\"" + id + "\",\"name\":\"E2E 导入图\",\"desc\":\"e2e\",\"page\":\"pages/engine.html\"," +
                "\"engine\":\"image\",\"mediaSrc\":\"/u/" + id + "/a.png\"," +
                "\"thumb\":\"url(/u/" + id + "/a.png) center / cover no-repeat, linear-gradient(135deg,#223,#445)\"," +
                "\"tokens\":{\"--color-surface\":\"#ffeeee\"}," +
                "\"groups\":[{\"name\":\"媒体\",\"params\":[" +
                "{\"key\":\"fit\",\"label\":\"填充方式\",\"options\":[\"cover\",\"contain\"],\"default\":0}," +
                "{\"key\":\"veil\",\"label\":\"暗色遮罩\",\"min\":0,\"max\":0.8,\"step\":0.01,\"default\":0}]}]}");

            await _pageSettings.WaitForSelectorAsync("#refreshThemes",
                new PageWaitForSelectorOptions { Timeout = 20000 });
            await _pageSettings.Locator("#refreshThemes").ClickAsync();
            await _pageSettings.WaitForSelectorAsync(
                $".theme[data-id='{id}']",
                new PageWaitForSelectorOptions { Timeout = 15000 });

            // /u/<id>/ 镜像就绪（Themes.List 内 SyncMirrors；硬链接到用户主题主拷贝）
            var fetchState = await _pageSettings.EvaluateAsync<string>(
                "fetch('/u/" + id + "/theme.json').then(r => 'status=' + r.status).catch(e => 'err=' + String(e))");
            Assert.True(fetchState.Contains("status=200"), $"清单资源不可达：{fetchState}");

            await _pageSettings.Locator($".theme[data-id='{id}']").ClickAsync();
            var deadline = DateTime.Now + TimeSpan.FromSeconds(20);
            while (DateTime.Now < deadline)
            {
                if (await CurrentThemeAsync() == id) break;
                await Task.Delay(200);
            }
            var diagTheme = await CurrentThemeAsync(1000);
            Assert.True(diagTheme == id, $"切换未生效：theme={diagTheme} url={_pageWallpaper.Url}");

            // 背景层图片经 /u/<id>/ 联接真实加载（naturalWidth>0）；运行时参数装配完成
            try
            {
                await _pageWallpaper.WaitForSelectorAsync(".media-layer img",
                    new PageWaitForSelectorOptions { Timeout = 6000 });
            }
            catch (Exception)
            {
                var st = "?";
                try
                {
                    st = await _pageWallpaper.EvaluateAsync<string>(
                        "() => JSON.stringify({ theme: window.__dbg && window.__dbg.theme, ready: !!window.__desklandReady," +
                        " P: window.__dbg && window.__dbg.P ? Object.keys(window.__dbg.P()) : null," +
                        " layers: document.querySelectorAll('.media-layer').length, url: location.href })");
                }
                catch { }
                Assert.Fail($"媒体层未出现：{st}");
            }
            var imgOk = await _pageWallpaper.EvaluateAsync<bool>(
                "() => { const i = document.querySelector('.media-layer img'); return !!i && i.naturalWidth > 0; }");
            Assert.True(imgOk, "媒体图片未加载（/u/<id>/ 不可达或 src 错误）");
            var hasParams = await _pageWallpaper.EvaluateAsync<bool>(
                "() => { const P = window.__dbg && window.__dbg.P(); return !!P && typeof P.fit === 'number' && typeof P.veil === 'number'; }");
            Assert.True(hasParams, "运行时参数声明（registerRuntimeDefs）未装配");

            // token 覆盖注入 :root（registerUserTheme）
            var surface = await _pageWallpaper.EvaluateAsync<string>(
                "() => getComputedStyle(document.documentElement).getPropertyValue('--color-surface').trim()");
            Assert.Contains("ffeeee", surface);

            await _pageSettings.Locator($".theme[data-id='{original}']").ClickAsync();
            await Task.Delay(1500);
        }
        finally
        {
            if (Directory.Exists(dir)) Directory.Delete(dir, true);
            await _pageSettings.WaitForSelectorAsync("#refreshThemes",
                new PageWaitForSelectorOptions { Timeout = 20000 });
            await _pageSettings.Locator("#refreshThemes").ClickAsync();
            await _pageSettings.WaitForFunctionAsync(
                "!document.querySelector('#refreshThemes').disabled",
                null, new PageWaitForFunctionOptions { Timeout = 15000 });
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
            File.ReadAllText(Path.Combine(RepoRoot, "frontend", "public", "themes", "_products.json")));
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

    // ---------- 鼠标穿透（WS_EX_TRANSPARENT）----------

    const int GWL_EXSTYLE = -20;
    const uint WS_EX_TRANSPARENT = 0x00000020;

    [DllImport("user32.dll", SetLastError = true)]
    static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll", SetLastError = true)]
    static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    static IntPtr FindWallpaperWindow(int pid, string profileDir)
    {
        // 测试事件文件里可能有多个 webview2_ready（多个窗口各自就绪时都会写）：
        // 壁纸窗口应处于穿透状态、设置窗口不该穿透，所以返回第一个含 WS_EX_TRANSPARENT 的 HWND；
        // 若都没有，返回最后一个 HWND，让断言报出真实的 GWL_EXSTYLE。
        var events = Path.Combine(profileDir, "test-events-" + pid + ".jsonl");
        IntPtr last = IntPtr.Zero;
        if (File.Exists(events))
            foreach (var line in File.ReadAllLines(events))
            {
                if (!line.Contains("webview2_ready")) continue;
                var m = Regex.Match(line, "\"hwnd\":\\s*(\\d+)");
                if (!m.Success) continue;
                var h = new IntPtr(long.Parse(m.Groups[1].Value));
                last = h;
                if (((uint)GetWindowLong(h, GWL_EXSTYLE) & WS_EX_TRANSPARENT) != 0) return h;
            }
        if (last != IntPtr.Zero) return last;
        // 回退：按标题枚举顶层窗口
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate (IntPtr h, IntPtr l)
        {
            var sb = new StringBuilder(256);
            GetWindowText(h, sb, 256);
            if (sb.ToString() == "DesklandWindow") { found = h; return false; }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    // fixture 的 settings.json 预设了 clickThrough=true：宿主启动后应把 WS_EX_TRANSPARENT 设到壁纸窗口
    // （资源管理器重建窗口时也会走同一条恢复路径）
    [Fact]
    public void WallpaperWindow_ClickThroughRestoredFromSettings()
    {
        IntPtr hwnd = IntPtr.Zero;
        for (int i = 0; i < 20 && hwnd == IntPtr.Zero; i++)
        {
            hwnd = FindWallpaperWindow(_appProcess!.Id, TestProfile);
            if (hwnd == IntPtr.Zero) Thread.Sleep(200);
        }
        Assert.NotEqual(IntPtr.Zero, hwnd);
        uint ex = (uint)GetWindowLong(hwnd, GWL_EXSTYLE);
        Assert.True((ex & WS_EX_TRANSPARENT) != 0,
            "壁纸窗口应处于穿透状态（settings.json 的 clickThrough=true），GWL_EXSTYLE=0x" + ex.ToString("X8"));
    }

    // ---------- 壁纸窗口结构：挂在桌面层，且不覆盖图标层（指针交互由全局钩子注入，见 ADR 0002）----------

    const uint GW_HWNDNEXT = 2;                     // 同一父窗口下 z 序更低的下一个兄弟
    const uint GA_ROOT = 2, SPI_GETWORKAREA = 0x0030;

    [StructLayout(LayoutKind.Sequential)] struct WinPoint { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] struct WinRect { public int Left, Top, Right, Bottom; }

    [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr hWnd);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(WinPoint point);
    [DllImport("user32.dll")] static extern bool SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr hWndParent, EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool IsChild(IntPtr hWndParent, IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hWnd);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hWnd, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string lpClassName, string? lpWindowName);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr hwndParent, IntPtr hwndChildAfter, string? lpszClass, string? lpszWindow);
    [DllImport("user32.dll")] static extern bool SystemParametersInfo(uint uiAction, uint uiParam, out WinRect pvParam, uint fWinIni);

    /// <summary>找 SHELLDLL_DefView 及其宿主：24H2 挂在 Progman 下，经典结构挂在一个顶层 WorkerW 下。</summary>
    static IntPtr FindDesktopRoot(out IntPtr defView)
    {
        defView = IntPtr.Zero;
        IntPtr progman = FindWindow("Progman", null);
        IntPtr dv = FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null);
        if (dv != IntPtr.Zero) { defView = dv; return progman; }
        IntPtr root = IntPtr.Zero, found = IntPtr.Zero;
        EnumWindows(delegate (IntPtr h, IntPtr l)
        {
            IntPtr d = FindWindowEx(h, IntPtr.Zero, "SHELLDLL_DefView", null);
            if (d != IntPtr.Zero) { root = h; found = d; return false; }
            return true;
        }, IntPtr.Zero);
        defView = found;
        return root;
    }

    static bool InSubtree(IntPtr root, IntPtr hit)
    {
        return hit != IntPtr.Zero && (hit == root || IsChild(root, hit));
    }

    static string RootClass(IntPtr h)
    {
        IntPtr root = GetAncestor(h, GA_ROOT);
        var sb = new StringBuilder(64);
        GetClassName(root, sb, 64);
        return sb.ToString();
    }

    // 先撤掉整棵子树的 WS_EX_TRANSPARENT（fixture 预设了 clickThrough=true，窗口处于命中透传），
    // 测完即恢复原样式；否则 WindowFromPoint 会穿过壁纸落到下层，观察不到真实命中。
    static Dictionary<IntPtr, int> SaveAndClearTransparent(IntPtr root)
    {
        var map = new Dictionary<IntPtr, int>();
        int rootEx = GetWindowLong(root, GWL_EXSTYLE);
        map[root] = rootEx;
        if (((uint)rootEx & WS_EX_TRANSPARENT) != 0) SetWindowLong(root, GWL_EXSTYLE, rootEx & ~(int)WS_EX_TRANSPARENT);

        void SetTree(IntPtr parent)
        {
            EnumChildWindows(parent, delegate (IntPtr h, IntPtr l)
            {
                if (!map.ContainsKey(h))
                {
                    int ex = GetWindowLong(h, GWL_EXSTYLE);
                    map[h] = ex;
                    if (((uint)ex & WS_EX_TRANSPARENT) != 0) SetWindowLong(h, GWL_EXSTYLE, ex & ~(int)WS_EX_TRANSPARENT);
                }
                SetTree(h);
                return true;
            }, IntPtr.Zero);
        }
        SetTree(root);
        return map;
    }

    static void RestoreTransparent(Dictionary<IntPtr, int> map)
    {
        foreach (var kv in map)
            if (IsWindow(kv.Key)) SetWindowLong(kv.Key, GWL_EXSTYLE, kv.Value);
    }

    [Fact]
    public void WallpaperWindow_MountedInDesktopLayer_NotAboveIconLayer()
    {
        IntPtr hwnd = IntPtr.Zero;
        for (int i = 0; i < 30 && hwnd == IntPtr.Zero; i++)
        {
            hwnd = FindWallpaperWindow(_appProcess!.Id, TestProfile);
            if (hwnd == IntPtr.Zero) Thread.Sleep(200);
        }
        Assert.NotEqual(IntPtr.Zero, hwnd);

        // a) 挂载关系（ADR 0001）：挂进桌面层，且不得压住图标层。
        //    经典结构（Win10）：Progman 下无 DefView，图标层在某个顶层 WorkerW 里；挂进它之后的
        //    「画壁纸 WorkerW」，z 序低于图标层——输入先被图标层截获，指针交互靠全局钩子注入（ADR 0002）。
        //    抬高的桌面（Win11 24H2+）：Progman 的分层子窗口，紧邻图标层（DefView）之下。
        IntPtr defView;
        IntPtr desktopRoot = FindDesktopRoot(out defView);
        Assert.NotEqual(IntPtr.Zero, defView);
        string root = RootClass(hwnd);
        Assert.True(root == "Progman" || root == "WorkerW", $"壁纸窗口应挂在桌面层，实际 root={root}");

        bool raised = FindWindowEx(FindWindow("Progman", null), IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero;
        if (raised)
        {
            Assert.Equal(desktopRoot, GetParent(hwnd));
            // GW_HWNDNEXT = 同一父窗口下 z 序更低的下一个兄弟；相等即紧贴图标层之下
            Assert.Equal(defView, GetWindow(hwnd, GW_HWNDNEXT));
        }
        else
        {
            IntPtr parent = GetParent(hwnd);
            var pc = new StringBuilder(64);
            GetClassName(parent, pc, 64);
            Assert.Equal("WorkerW", pc.ToString());            // 画壁纸的 WorkerW，不是图标层宿主
            Assert.NotEqual(desktopRoot, parent);
        }

        // b) 命中可达性按结构区分：抬高的桌面窗口紧邻图标层之下，空白点命中壁纸子树；
        //    经典结构窗口在图标层之下，空白点落到桌面 / 图标层（壁纸不挡图标，也不接输入——输入靠钩子）。
        //    观察前先撤掉穿透，测完恢复；候选点取工作区右侧（避开任务栏与设置窗口）。
        var saved = SaveAndClearTransparent(hwnd);
        try
        {
            WinRect wa;
            SystemParametersInfo(SPI_GETWORKAREA, 0, out wa, 0);
            int h = wa.Bottom - wa.Top;
            var candidates = new[]
            {
                new WinPoint { X = wa.Right - 40, Y = wa.Bottom - 40 },
                new WinPoint { X = wa.Right - 200, Y = wa.Bottom - 24 },
                new WinPoint { X = wa.Right - 60, Y = wa.Top + h / 4 },
            };
            int subtreeHits = 0, missed = 0;
            foreach (var p in candidates)
            {
                IntPtr hit = WindowFromPoint(p);
                if (InSubtree(hwnd, hit)) { subtreeHits++; continue; }
                string c = RootClass(hit);
                if (c == "Progman" || c == "WorkerW" || c == "SHELLDLL_DefView" || c == "SysListView32")
                    missed++;                                // 壁纸没接住：仍落到桌面/图标层
            }
            if (raised)
                Assert.True(subtreeHits > 0,
                    $"抬高的桌面：候选空白点无一命中壁纸窗口子树（命中 {subtreeHits}，落到桌面 {missed}）");
            else
                Assert.True(subtreeHits == 0 && missed > 0,
                    $"经典结构：空白点不应命中壁纸（否则会挡住图标），命中 {subtreeHits}，落到桌面 {missed}");
        }
        finally { RestoreTransparent(saved); }
    }

    // ---------- 指针注入链路（ADR 0002）----------
    // 壁纸窗口 z 序低于图标层时收不到真实命中，指针事件由宿主全局鼠标钩子补发（host/Hooks.cs）。
    // 用例一验证页面侧：ptr 消息 → 合成 PointerEvent → orb 引擎指针场响应；
    // 用例二验证宿主侧：真实鼠标输入触发钩子注入，且穿透开关开启时不再注入。

    [Fact]
    public async Task Wallpaper_PointerInjection_DrivesOrbPointer()
    {
        await GotoOrbAsync();
        var before = await PtrSnapshotAsync();
        Assert.False(before.GetProperty("active").GetBoolean(), "注入前指针场不应激活");

        // 屏幕中心（球心）：injectPointer 收的是物理像素，页面内按 devicePixelRatio 换算回 CSS
        await _pageWallpaper.EvaluateAsync(
            "() => { const k = window.devicePixelRatio || 1;" +
            " window.__dbg.injectPointer(window.innerWidth / 2 * k, (window.innerHeight - 56) / 2 * k, 'move'); }");
        await Task.Delay(400); // inside / energy 是指数趋近，等几帧到位
        var moved = await PtrSnapshotAsync();
        Assert.True(moved.GetProperty("active").GetBoolean(), "注入 pointermove 后指针场应激活");
        Assert.True(moved.GetProperty("inside").GetDouble() > 0.5,
            $"球心处 inside 应接近 1，实际 {moved.GetProperty("inside").GetDouble()}");

        await _pageWallpaper.EvaluateAsync("() => window.__dbg.injectPointer(100, 100, 'down')");
        await Task.Delay(250);
        var down = await PtrSnapshotAsync();
        Assert.True(down.GetProperty("down").GetBoolean(), "注入 pointerdown 后 downFlag 应置位");
        Assert.True(down.GetProperty("energy").GetDouble() > 0.8, "按下时 energy 应趋近 1");

        await _pageWallpaper.EvaluateAsync("() => window.__dbg.injectPointer(100, 100, 'up')");
        await Task.Delay(250);
        var up = await PtrSnapshotAsync();
        Assert.False(up.GetProperty("down").GetBoolean(), "注入 pointerup 后 downFlag 应复位");
    }

    [Fact]
    public async Task Wallpaper_GlobalHook_InjectsOnlyWhenClickThroughOff()
    {
        WriteSetting("clickThrough", false);
        await RestartAppAsync();
        await GotoOrbAsync();

        int cx = GetSystemMetrics(SM_CXSCREEN), cy = GetSystemMetrics(SM_CYSCREEN);
        SendMouseMoveTo(cx / 2, cy / 2);
        await Task.Delay(80);
        SendMouseMoveTo(cx / 2 + 12, cy / 2);
        Assert.True(await WaitPtrProbeAsync(), "穿透关闭时全局钩子未注入指针（探针无 ptr 事件）");
        Assert.True((await PtrSnapshotAsync()).GetProperty("active").GetBoolean(),
            "钩子注入后引擎指针场应激活");

        // 穿透开启：同一输入不再驱动壁纸（点击与指针都归桌面 / 图标层）
        WriteSetting("clickThrough", true);
        await RestartAppAsync();
        await GotoOrbAsync();
        var before = await PtrProbeCountAsync();
        SendMouseMoveTo(cx / 2, cy / 2);
        await Task.Delay(80);
        SendMouseMoveTo(cx / 2 - 12, cy / 2);
        await Task.Delay(800);
        var after = await PtrProbeCountAsync();
        Assert.True(before == after, $"穿透开启时仍注入了指针（{before} → {after}）");
    }

    // CDP 的 Input.dispatchMouseEvent 只注入浏览器窗口，不经过全局输入队列，WH_MOUSE_LL 观察不到；
    // SendInput 的事件会进入系统输入队列，等价于真实鼠标移动（测试会短暂挪动真实指针几像素）。
    const int SM_CXSCREEN = 0, SM_CYSCREEN = 1;
    const uint INPUT_MOUSE = 0, MOUSEEVENTF_MOVE = 0x0001, MOUSEEVENTF_ABSOLUTE = 0x8000;

    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public MOUSEINPUT mi; }
    [StructLayout(LayoutKind.Sequential)]
    struct MOUSEINPUT
    {
        public int dx, dy;
        public uint mouseData, dwFlags, time;
        public IntPtr dwExtraInfo;
    }

    [DllImport("user32.dll")] static extern int GetSystemMetrics(int n);
    [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] inputs, int size);

    /// <summary>把指针绝对移动到屏幕物理坐标 (x, y)（按主监视器虚拟屏幕尺寸换算）。</summary>
    static void SendMouseMoveTo(int x, int y)
    {
        int cx = GetSystemMetrics(SM_CXSCREEN), cy = GetSystemMetrics(SM_CYSCREEN);
        var input = new INPUT
        {
            type = INPUT_MOUSE,
            mi = new MOUSEINPUT
            {
                dx = (int)((long)x * 65535 / (cx - 1)),
                dy = (int)((long)y * 65535 / (cy - 1)),
                dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE,
            },
        };
        if (SendInput(1, new[] { input }, Marshal.SizeOf<INPUT>()) != 1)
            throw new InvalidOperationException("SendInput 失败");
    }

    private async Task<System.Text.Json.JsonElement> PtrSnapshotAsync()
    {
        return await _pageWallpaper.EvaluateAsync<System.Text.Json.JsonElement>("() => window.__dbg.ptr()");
    }

    private async Task GotoOrbAsync()
    {
        await _pageWallpaper.GotoAsync("https://deskland.test/pages/engine.html?theme=orb&wallpaper=1&ui=2");
        var ok = await WaitJsBoolAsync(
            "() => window.__desklandReady === true && !!window.__dbg && window.__dbg.theme === 'orb'");
        Assert.True(ok, "orb 引擎未就绪");
    }

    private async Task<bool> WaitJsBoolAsync(string expression, int timeoutMs = 15000)
    {
        var start = DateTime.Now;
        while (DateTime.Now - start < TimeSpan.FromMilliseconds(timeoutMs))
        {
            try
            {
                if (await _pageWallpaper.EvaluateAsync<bool>(expression)) return true;
            }
            catch (Microsoft.Playwright.PlaywrightException) { }   // 正在导航：重试
            await Task.Delay(200);
        }
        return false;
    }

    private void WriteSetting(string key, System.Text.Json.Nodes.JsonNode value)
    {
        var path = Path.Combine(TestProfile, "settings.json");
        var json = System.Text.Json.Nodes.JsonObject.Parse(File.ReadAllText(path))!;
        json[key] = value;
        File.WriteAllText(path, json.ToJsonString());
    }

    private string EventsPathFor(System.Diagnostics.Process p) =>
        Path.Combine(TestProfile, $"test-events-{p.Id}.jsonl");

    private async Task<bool> WaitPtrProbeAsync(int timeoutMs = 8000)
    {
        var path = EventsPathFor(_appProcess!);
        var start = DateTime.Now;
        while (DateTime.Now - start < TimeSpan.FromMilliseconds(timeoutMs))
        {
            if (File.Exists(path))
            {
                var lines = await File.ReadAllLinesAsync(path);
                if (lines.Any(l => l.Contains("\"event\":\"ptr\""))) return true;
            }
            await Task.Delay(150);
        }
        return false;
    }

    private async Task<int> PtrProbeCountAsync()
    {
        var path = EventsPathFor(_appProcess!);
        if (!File.Exists(path)) return 0;
        var lines = await File.ReadAllLinesAsync(path);
        return lines.Count(l => l.Contains("\"event\":\"ptr\""));
    }

    // 持久化的源码红线：默认关闭、Load 读 bool、Save 写入、StartForm 应用
    [Fact]
    public void HostSettings_ClickThroughPersisted()
    {
        // 宿主已按职责拆成多文件（Program/Settings/HostContext…），这里合并读取整个 host 目录，避免与文件名耦合
        var hostDir = Path.Combine(RepoRoot, "host");
        var hostSrc = string.Join("\n", Directory.GetFiles(hostDir, "*.cs").Select(File.ReadAllText));
        Assert.Contains("public static bool ClickThrough = false;", hostSrc);
        Assert.Contains("root.TryGetValue(\"clickThrough\", out v) && v is bool", hostSrc);
        Assert.Contains("\"clickThrough\", ClickThrough", hostSrc);
        Assert.Contains("form.SetClickThrough(Settings.ClickThrough);", hostSrc);
    }
}
