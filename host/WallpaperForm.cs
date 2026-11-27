using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

class WallpaperForm : Form
{
    const int IconInterval = 400;              // 正常：跟住桌面图标变化
    const int IconIntervalPaused = 2000;      // 手动暂停：仍需维持 Z 序与点击穿透，但降低跨进程读取频率
    readonly WebView2 web;
    readonly System.Windows.Forms.Timer iconTimer, fgTimer;
    readonly string pageDir;
    readonly IconReader reader = new IconReader();
    readonly DesktopIconLocator iconLocator = new DesktopIconLocator();
    Rectangle screen;
    IntPtr parentHwnd, insertAfter;
    string lastIcons = "";
    int lastPause = -1;
    bool manualPause, shuttingDown;

    public bool Fatal { get; private set; }
    public bool IsWebView2Ready { get; private set; }
    public DateTime StartupTime { get; set; }
    public DateTime LastLoadPageTime { get; set; }
    private bool isFirstLoad = true;

    string page;                                        // 当前主题的页面（themes/<id>/theme.json 里的 page）
    string themeId;                                     // 当前主题 id：engine.html 的引擎注册表按它查
    public Func<string> SettingsJson;                   // 页面就绪时先发给它的设置消息
    protected override bool ShowWithoutActivation { get { return true; } }

    public WallpaperForm(string pageDir, string page, string themeId, bool manualPause)
    {
        this.pageDir = pageDir;
        this.page = page;
        this.themeId = themeId;
        this.manualPause = manualPause;
        StartupTime = DateTime.Now;
        LastLoadPageTime = DateTime.Now;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        BackColor = Color.FromArgb(26, 163, 196);
        Text = "DesklandWindow";

        web = new WebView2();
        web.Dock = DockStyle.Fill;
        web.DefaultBackgroundColor = BackColor;
        web.CreationProperties = new CoreWebView2CreationProperties();
        web.CreationProperties.UserDataFolder = Path.Combine(Log.DataDir, "WebView2");
        Controls.Add(web);

        iconTimer = new System.Windows.Forms.Timer();
        iconTimer.Interval = IconInterval;
        iconTimer.Tick += delegate { PollIcons(); };
        fgTimer = new System.Windows.Forms.Timer();
        fgTimer.Interval = 500;
        fgTimer.Tick += delegate { PollForeground(); };
    }

    public void SetManualPause(bool v)
    {
        manualPause = v;
        if (v)
        {
            fgTimer.Stop();                      // 暂停优先：前台检测这时不会改变结果，停掉省一次窗口遍历
            iconTimer.Interval = IconIntervalPaused;
        }
        else
        {
            iconTimer.Interval = IconInterval;
            fgTimer.Start();
        }
        PollForeground();                        // 立刻把新状态推给页面
        if (!v) PollIcons();                     // 恢复时马上取一次图标位置与层级
    }

    public void Reload()
    {
        if (web.CoreWebView2 == null) return;
        try { web.CoreWebView2.Reload(); }
        catch (InvalidOperationException ex) { WebDead(ex); }
        catch (COMException ex) { WebDead(ex); }
    }
    public void Post(string json)
    {
        if (web.CoreWebView2 == null) return;
        try { web.CoreWebView2.PostWebMessageAsString(json); }
        catch (InvalidOperationException ex) { WebDead(ex); }
        catch (COMException ex) { WebDead(ex); }
    }

    // WebView2 运行时后台更新 / 浏览器进程被杀后，CoreWebView2 不为 null 但已 disposed，任何调用都抛异常
    // （前面的 null 检查挡不住这种状态）。按"壁纸窗口被系统销毁"的既有路径处理：拆掉本窗口，HostContext 1 秒后自动重建
    void WebDead(Exception ex)
    {
        if (shuttingDown) return;
        Log.Write("WebView2 失效（运行时更新或进程退出），重新挂载壁纸窗口：" + ex.Message);
        Shutdown();
    }
    string PageUrl { get { return "https://" + VirtualHost.Name() + "/" + page + "?wallpaper=1&ui=2"; } }
    string EngineUrl(string id) { return "https://" + VirtualHost.Name() + "/pages/engine.html?theme=" + id + "&wallpaper=1&ui=2"; }

    // 切换主题：换页面；新页面就绪后会重新收到设置和图标
    public void LoadPage(string newPage, string newId)
    {
        page = newPage;
        themeId = newId;
        LastLoadPageTime = DateTime.Now;
        if (web.CoreWebView2 == null) return;
        try
        {
            // engine.html 必须带 ?theme=<id>：热切换失败 / 未就绪的回退都是整页导航，漏了会静默落到默认 meadow
            web.CoreWebView2.Navigate(newPage == "pages/engine.html" ? EngineUrl(newId) : PageUrl);
        }
        catch (InvalidOperationException ex) { WebDead(ex); }
        catch (COMException ex) { WebDead(ex); }
    }

    // 页内热切换：统一入口 engine.html 在同一 WebGL 上下文里重建引擎（~200ms）；
    // 页面不支持（未加载 __dbg / 主题无对应引擎）时回退整页导航。
    public async void SwitchTheme(string id)
    {
        LastLoadPageTime = DateTime.Now;
        themeId = id;                                  // 热切换成功与否都先认下，回执据此丢弃旧主题的消息
        if (web.CoreWebView2 == null) { LoadPage(Themes.PageFor(pageDir, id), id); return; }
        try
        {
            string js = "(window.__dbg && window.__dbg.switchTheme) ? window.__dbg.switchTheme(" + Json.Stringify(id) + ") : false";
            string r = await web.CoreWebView2.ExecuteScriptAsync(js);
            if (r != "true")
            {
                string p = Themes.PageFor(pageDir, id);
                if (p != null) LoadPage(p, id);
            }
        }
        catch { /* 切换脚本异常：按未切换处理，页面保持原主题 */ }
    }

    protected override async void OnShown(EventArgs e)
    {
        base.OnShown(e);
        try
        {
            if (!File.Exists(Path.Combine(pageDir, page)))
            {
                Fail(I18n.T("errNoPage", "path", Path.Combine(pageDir, page)));
                return;
            }
            if (!AttachToDesktop())
            {
                Fail(I18n.T("errNoDesktop"));
                return;
            }
            // 测试模式：给壁纸窗口的浏览器进程单独开 CDP 端口（9222），与设置窗口（9223）分离。
            // 用 CoreWebView2Environment 显式创建环境，再传给 EnsureCoreWebView2Async：
            // 同进程内两个 WebView2 的环境变量会互相覆盖，必须用独立环境。
            // 同时强制 --hosting-mode=windowed，确保壁纸窗口是 Windowed 模式（子 HWND 接收鼠标）。
            CoreWebView2Environment env = null;
            if (TestProbe.Enabled)
            {
                var options = new CoreWebView2EnvironmentOptions();
                options.AdditionalBrowserArguments = "--remote-debugging-port=9222 --hosting-mode=windowed";
                env = await CoreWebView2Environment.CreateAsync(null, web.CreationProperties.UserDataFolder, options);
            }
            await web.EnsureCoreWebView2Async(env);
            if (shuttingDown || IsDisposed) return;
            var core = web.CoreWebView2;
            SystemTheme.ApplyTo(core);                 // 同步系统深浅色（主题页目前不用媒体查询，保持一致性）
            IsWebView2Ready = true;
            TestProbe.Signal("webview2_ready", new { hwnd = Handle.ToInt64() });
            core.SetVirtualHostNameToFolderMapping(VirtualHost.Name(), pageDir, CoreWebView2HostResourceAccessKind.Allow);
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreDevToolsEnabled = true;
            core.Settings.IsStatusBarEnabled = false;
            // 页面就绪（发来 "ready" 或 {t:"firstframe"}）：先发设置，再发图标和暂停状态（岸线要按设置里的离岸距离来算）
            core.WebMessageReceived += delegate (object s, CoreWebView2WebMessageReceivedEventArgs a)
            {
                string msg = null;
                try { msg = a.TryGetWebMessageAsString(); } catch { /* 消息取不出来按无消息处理 */ }
                string kind = null, theme = null;
                if (msg == "ready") kind = "ready";
                else
                {
                    try
                    {
                        var parsed = Json.Parse(msg) as Dictionary<string, object>;
                        if (parsed != null)
                        {
                            object t; if (parsed.TryGetValue("t", out t)) kind = t as string;
                            object th; if (parsed.TryGetValue("theme", out th)) theme = th as string;
                        }
                    }
                    catch { /* 消息不是 JSON：按未知类型忽略 */ }
                }
                if (kind == null) return;
                // 不回按 theme 过滤：engine.html 可以由测试 / 开发直接导航到任意主题，
                // 旧实例的残留消息已由页面侧 destroy()（卸监听 + 销毁引擎）挡掉
                if (kind == "switchfailed")
                {
                    // 页内热切换失败（引擎初始化报错等）：回退整页导航
                    Log.Write("热切换失败，回退整页导航：" + (theme ?? "?"));
                    string fp = Themes.PageFor(pageDir, theme ?? "meadow");
                    if (fp != null) LoadPage(fp, theme);
                    return;
                }
                if (kind == "ready")
                {
                    // 页面已就绪（首帧还没画）：先把设置和图标推过去
                    if (SettingsJson != null) core.PostWebMessageAsString(SettingsJson());
                    lastIcons = ""; lastPause = -1; PollIcons(); PollForeground();
                    return;
                }
                if (kind != "firstframe") return;
                TestProbe.Signal("firstframe");
                // 性能埋点：启动首帧 / 主题切换耗时
                var now = DateTime.Now;
                if (isFirstLoad)
                {
                    var delta = (now - StartupTime).TotalMilliseconds;
                    TestProbe.Signal("perf", new { path = "startup_first_frame", ms = delta });
                    isFirstLoad = false;
                }
                else
                {
                    var delta = (now - LastLoadPageTime).TotalMilliseconds;
                    TestProbe.Signal("perf", new { path = "theme_switch", ms = delta, theme });
                }
                if (SettingsJson != null) core.PostWebMessageAsString(SettingsJson());
                lastIcons = ""; lastPause = -1; PollIcons(); PollForeground();
            };
            core.Navigate(EngineUrl(string.IsNullOrEmpty(themeId) ? "meadow" : themeId));
            iconTimer.Interval = manualPause ? IconIntervalPaused : IconInterval;
            iconTimer.Start();
            if (!manualPause) fgTimer.Start();
            // 事件驱动图标刷新：监听桌面 ListView 的 LOCATIONCHANGE，去抖后触发 PollIcons
            IntPtr lv = iconLocator.TryLocate();
            if (lv != IntPtr.Zero) { iconLocator.DesktopIconsMayHaveChanged += PollIcons; iconLocator.Start(lv); }
            else Log.Write("找不到桌面图标列表：不启用图标事件监听，保留 " + IconInterval + "ms 轮询兜底");
            Log.Write("WebView2 就绪：" + core.Environment.BrowserVersionString);
        }
        catch (Exception ex)
        {
            if (shuttingDown || IsDisposed) return;       // 启动途中窗口被系统销毁：交给 HostContext 重试
            Log.Write("启动失败：" + ex);
            Fail(I18n.T("errStart", "msg", ex.Message));
        }
    }

    void Fail(string msg)
    {
        Log.Write(msg);
        MessageBox.Show(msg + "\n\n" + I18n.T("errSeeLog", "path", Log.FilePath), "Deskland+");
        Fatal = true;
        Shutdown();
    }

    // ---------------------------------------------------------------- 挂到壁纸层
    // 两种桌面结构：
    //   · Windows 11 24H2 起（"抬高的桌面"）：Progman 下依次是 图标层（SHELLDLL_DefView）→ 系统壁纸层（WorkerW）。
    //     系统壁纸层会在换壁纸（幻灯片 / 聚焦）时被销毁重建，所以我们不挂进它里面，而是做 Progman 的
    //     分层子窗口（WS_EX_LAYERED，alpha 255），排在图标层正下方、系统壁纸层之上，并持续守住这个顺序。
    //     （Progman 没有可供普通子窗口绘制的表面，所以必须是分层窗口；分层子窗口需要 app.manifest 声明支持 Win8+）
    //   · 旧版：图标层在某个顶层 WorkerW 里，它后面紧跟着负责画壁纸的顶层 WorkerW → 挂进这个 WorkerW
    public static string AttachMode = "progman";
    bool raised;
    IntPtr zAnchor;                                     // 我们要紧跟在它下面的窗口（图标列表 / 图标层）
    IntPtr winEventHook;
    Native.WinEventDelegate winEventProc;               // 保持引用，防止被 GC

    static IntPtr FindClassicWorker()
    {
        IntPtr host = IntPtr.Zero;
        Native.EnumWindows(delegate (IntPtr h, IntPtr l)
        {
            if (Native.FindWindowEx(h, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero) { host = h; return false; }
            return true;
        }, IntPtr.Zero);
        return host != IntPtr.Zero ? Native.FindWindowEx(IntPtr.Zero, host, "WorkerW", null) : IntPtr.Zero;
    }

    // 请资源管理器生成壁纸层（只发一次 0xD,1；再发 0xD,0 会把刚生成的壁纸层删掉），最多等 2 秒
    static void RequestWorkerW(IntPtr progman, Func<bool> ready)
    {
        IntPtr res;
        Native.SendMessageTimeout(progman, 0x052C, new IntPtr(0xD), new IntPtr(1), 0, 1000, out res);
        for (int i = 0; i < 20 && !ready(); i++) Thread.Sleep(100);
    }

    bool AttachToDesktop()
    {
        screen = Screen.PrimaryScreen.Bounds;          // 进程是 DPI 感知的 → 物理像素
        IntPtr progman = Native.FindWindow("Progman", null);
        if (progman == IntPtr.Zero) { Log.Write("找不到 Progman"); return false; }
        IntPtr defView = Native.FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null);
        string mode;
        raised = defView != IntPtr.Zero;

        if (raised)
        {
            if (Native.FindWindowEx(progman, IntPtr.Zero, "WorkerW", null) == IntPtr.Zero)
                RequestWorkerW(progman, delegate { return Native.FindWindowEx(progman, IntPtr.Zero, "WorkerW", null) != IntPtr.Zero; });
            IntPtr listView = Native.FindWindowEx(defView, IntPtr.Zero, "SysListView32", null);
            if (AttachMode == "legacy")
            {
                parentHwnd = Native.FindWindowEx(progman, IntPtr.Zero, "WorkerW", null);
                if (parentHwnd == IntPtr.Zero) { Log.Write("找不到 WorkerW"); return false; }
                insertAfter = IntPtr.Zero; raised = false; mode = "24H2+ 旧做法：WorkerW 子窗口";
            }
            else if (AttachMode == "defview" && listView != IntPtr.Zero)
            {
                // 实验：挂进图标层里、图标列表之下（换壁纸时不会被重排，但实测在 24H2 上画不出来）
                parentHwnd = defView; insertAfter = listView; zAnchor = listView;
                mode = "24H2+：图标层（DefView）的分层子窗口，位于图标列表之下";
            }
            else
            {
                parentHwnd = progman; insertAfter = defView; zAnchor = defView;
                mode = "24H2+：Progman 的分层子窗口，位于图标层之下";
            }
            if (raised)
            {
                int ex = Native.GetWindowLong(Handle, Native.GWL_EXSTYLE);
                Native.SetWindowLong(Handle, Native.GWL_EXSTYLE, ex | Native.WS_EX_LAYERED);
                Native.SetLayeredWindowAttributes(Handle, 0, 255, Native.LWA_ALPHA);
            }
        }
        else
        {
            IntPtr worker = FindClassicWorker();
            if (worker == IntPtr.Zero)
            {
                RequestWorkerW(progman, delegate { return FindClassicWorker() != IntPtr.Zero; });
                worker = FindClassicWorker();
            }
            if (worker == IntPtr.Zero) { Log.Write("找不到 WorkerW / SHELLDLL_DefView"); return false; }
            parentHwnd = worker; insertAfter = IntPtr.Zero; mode = "经典：顶层 WorkerW 子窗口";
        }

        int style = Native.GetWindowLong(Handle, Native.GWL_STYLE);
        style = (style & ~(Native.WS_POPUP | Native.WS_CAPTION | Native.WS_THICKFRAME)) | Native.WS_CHILD | Native.WS_VISIBLE;
        Native.SetWindowLong(Handle, Native.GWL_STYLE, style);
        Native.SetParent(Handle, parentHwnd);

        var pt = new Native.POINT { X = screen.X, Y = screen.Y };
        Native.ScreenToClient(parentHwnd, ref pt);
        Native.SetWindowPos(Handle, insertAfter, pt.X, pt.Y, screen.Width, screen.Height,
            Native.SWP_NOACTIVATE | Native.SWP_SHOWWINDOW | Native.SWP_FRAMECHANGED);
        EnsureZOrder();

        if (raised)
        {
            // 资源管理器新建 / 重排壁纸层时立刻修正顺序（换壁纸时它会把新的 WorkerW 插到我们上面）
            uint pid;
            Native.GetWindowThreadProcessId(progman, out pid);
            winEventProc = delegate (IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time)
            {
                if (idObject == 0 && !shuttingDown && IsHandleCreated) EnsureZOrder();
            };
            winEventHook = Native.SetWinEventHook(0x8000 /* OBJECT_CREATE */, 0x8004 /* OBJECT_REORDER */, IntPtr.Zero,
                winEventProc, pid, 0, 0 /* WINEVENT_OUTOFCONTEXT */);
        }
        Log.Write(string.Format("已挂载（{0}），屏幕 {1}", mode, screen));
        return true;
    }

    // 守住顺序：紧跟在 zAnchor（图标列表 / 图标层）下面；Progman 挂法还要把系统壁纸层推到最底（被打乱才修）
    int zFixes;
    void EnsureZOrder()
    {
        if (!raised || zAnchor == IntPtr.Zero || !Native.IsWindow(zAnchor) || overlay) return;
        bool fixedAny = false;
        if (Native.GetWindow(zAnchor, 2 /* GW_HWNDNEXT */) != Handle)
        {
            Native.SetWindowPos(Handle, zAnchor, 0, 0, 0, 0, Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE);
            fixedAny = true;
        }
        if (AttachMode == "progman")
        {
            for (IntPtr w = Native.FindWindowEx(parentHwnd, IntPtr.Zero, "WorkerW", null); w != IntPtr.Zero;
                 w = Native.FindWindowEx(parentHwnd, w, "WorkerW", null))
            {
                if (Native.GetWindow(w, 2) != IntPtr.Zero)   // 不在最底下 → 推到最底下
                {
                    Native.SetWindowPos(w, new IntPtr(1) /* HWND_BOTTOM */, 0, 0, 0, 0, Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE);
                    fixedAny = true;
                }
            }
        }
        if (fixedAny && ++zFixes <= 20) Log.Write("修正了桌面层级（资源管理器重排了窗口）");
    }

    // ---------------------------------------------------------------- 读取桌面图标
    void PollIcons()
    {
        EnsureZOrder();
        if (web.CoreWebView2 == null) return;
        bool visible;
        List<Native.RECT> rects = reader.Read(out visible);
        if (rects == null) return;
        var sb = new StringBuilder();
        sb.Append("{\"t\":\"icons\",\"vis\":").Append(visible ? "true" : "false").Append(",\"r\":[");
        for (int i = 0; i < rects.Count; i++)
        {
            Native.RECT r = rects[i];
            if (i > 0) sb.Append(',');
            sb.Append('[').Append(r.Left - screen.X).Append(',').Append(r.Top - screen.Y).Append(',')
              .Append(r.Right - screen.X).Append(',').Append(r.Bottom - screen.Y).Append(']');
        }
        sb.Append("]}");
        string json = sb.ToString();
        if (json == lastIcons) return;
        lastIcons = json;
        Post(json);
        Log.Write(string.Format("图标变化：{0} 个，可见={1}", rects.Count, visible));
    }

    // ---------------------------------------------------------------- 最大化 / 全屏时暂停
    void PollForeground()
    {
        if (web.CoreWebView2 == null) return;
        bool pause = manualPause;
        string pauseBy = "";
        IntPtr fg = Native.GetForegroundWindow();
        int cloaked = 0;
        if (!pause && fg != IntPtr.Zero && fg != Handle && Native.IsWindowVisible(fg)
            && (Native.DwmGetWindowAttribute(fg, 14 /* DWMWA_CLOAKED */, out cloaked, 4) != 0 || cloaked == 0))
        {
            var cls = new StringBuilder(64);
            Native.GetClassName(fg, cls, 64);
            string c = cls.ToString();
            if (c != "Progman" && c != "WorkerW" && c != "Shell_TrayWnd" && c != "Shell_SecondaryTrayWnd")
            {
                Native.RECT wr;
                Native.GetWindowRect(fg, out wr);
                bool covers = wr.Left <= screen.Left && wr.Top <= screen.Top && wr.Right >= screen.Right && wr.Bottom >= screen.Bottom;
                int cx = (wr.Left + wr.Right) / 2, cy = (wr.Top + wr.Bottom) / 2;
                if (screen.Contains(cx, cy) && (covers || Native.IsZoomed(fg))) { pause = true; pauseBy = c; }
            }
        }
        int p = pause ? 1 : 0;
        if (p == lastPause) return;
        lastPause = p;
        Post("{\"t\":\"pause\",\"v\":" + (pause ? "true" : "false") + "}");
        Log.Write(pause ? "暂停（有窗口最大化 / 全屏，或手动暂停）" + (pauseBy == "" ? "" : "，前台窗口类 " + pauseBy) : "继续播放");
    }

    // ---------------------------------------------------------------- 纯净模式：置顶盖住桌面
    bool overlay;
    int styleBefore, exBefore;

    /// <summary>
    /// 纯净模式：壁纸窗临时脱离 Explorer 桌面层并置顶（盖住桌面图标与系统壁纸，供截图）。
    /// 刻意不隐藏 SHELLDLL_DefView——它是父层，藏了它壁纸窗会一起消失。
    /// </summary>
    public void SetOverlay(bool on)
    {
        if (!IsHandleCreated || overlay == on) return;
        overlay = on;
        if (on)
        {
            styleBefore = Native.GetWindowLong(Handle, Native.GWL_STYLE);
            exBefore = Native.GetWindowLong(Handle, Native.GWL_EXSTYLE);
            Native.SetWindowLong(Handle, Native.GWL_STYLE, (styleBefore & ~Native.WS_CHILD) | Native.WS_POPUP | Native.WS_VISIBLE);
            // TRANSPARENT：点击穿透到下面的 Explorer 桌面层——这样「点一下桌面退出纯净模式」才点得到桌面
            Native.SetWindowLong(Handle, Native.GWL_EXSTYLE, exBefore | Native.WS_EX_TOPMOST | Native.WS_EX_TOOLWINDOW | Native.WS_EX_TRANSPARENT);
            Native.SetParent(Handle, IntPtr.Zero);
            Native.SetWindowPos(Handle, new IntPtr(-1) /* HWND_TOPMOST */, screen.X, screen.Y, screen.Width, screen.Height,
                Native.SWP_NOACTIVATE | Native.SWP_SHOWWINDOW | Native.SWP_FRAMECHANGED);
            Log.Write("纯净模式：壁纸已脱离桌面层并置顶");
        }
        else
        {
            Native.SetWindowLong(Handle, Native.GWL_EXSTYLE, exBefore);
            Native.SetWindowLong(Handle, Native.GWL_STYLE, styleBefore);
            if (parentHwnd != IntPtr.Zero && Native.IsWindow(parentHwnd))
            {
                Native.SetParent(Handle, parentHwnd);
                var pt = new Native.POINT { X = screen.X, Y = screen.Y };
                Native.ScreenToClient(parentHwnd, ref pt);
                Native.SetWindowPos(Handle, insertAfter, pt.X, pt.Y, screen.Width, screen.Height,
                    Native.SWP_NOACTIVATE | Native.SWP_SHOWWINDOW | Native.SWP_FRAMECHANGED);
            }
            else
            {
                Log.Write("纯净模式恢复：原桌面层已失效，重新挂载");
                if (!AttachToDesktop()) { Hide(); return; }
            }
            EnsureZOrder();
            Log.Write("纯净模式：壁纸已挂回桌面层");
        }
    }

    // ---------------------------------------------------------------- 鼠标穿透开关
    /// <summary>
    /// 切换鼠标穿透。语义是"完全让出鼠标事件"：开启后壁纸窗口连同其中的 WebView2 都不再接收
    /// 任何鼠标事件，点击直接落到下层（桌面图标区由桌面消费、空白区由下层的窗口/桌面消费）。
    /// 这不是用来"修复桌面不可点"的——默认（关）就是互动基线，页面照常接收点击；开启后页面交互也一并失效。
    /// </summary>
    public void SetClickThrough(bool on)
    {
        if (!IsHandleCreated) return;
        int before = Native.GetWindowLong(Handle, Native.GWL_EXSTYLE);
        Log.Write(string.Format("穿透开关：{0}，操作前 GWL_EXSTYLE=0x{1:X8}", on ? "开" : "关", before));
        int ex = before;
        if (on)
        {
            ex |= Native.WS_EX_LAYERED;            // 1) 确保分层样式存在（经典 WorkerW 模式原本没有）
            ex |= Native.WS_EX_TRANSPARENT;        // 2) 叠加上层鼠标透明
            Native.SetWindowLong(Handle, Native.GWL_EXSTYLE, ex);
            // 3) 刷新扩展样式（FRAMEOWNED 的扩展样式变更需重设窗口位）
            Native.SetWindowPos(Handle, IntPtr.Zero, 0, 0, 0, 0,
                Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE | Native.SWP_FRAMECHANGED);
            // 只枚举、只打印直接子窗口（含 WebView2 的承载窗口），不修改任何子窗口样式
            Native.EnumChildWindows(Handle, delegate (IntPtr h, IntPtr l)
            {
                var sb = new StringBuilder(64);
                Native.GetClassName(h, sb, 64);
                int ce = Native.GetWindowLong(h, Native.GWL_EXSTYLE);
                Log.Write(string.Format("  子窗口 {0}  class={1} GWL_EXSTYLE=0x{2:X8}", h, sb, ce));
                return true;
            }, IntPtr.Zero);
        }
        else
        {
            ex &= ~Native.WS_EX_TRANSPARENT;       // 只清 TRANSPARENT，保留 LAYERED 与 alpha 等其他位
            Native.SetWindowLong(Handle, Native.GWL_EXSTYLE, ex);
        }
        int after = Native.GetWindowLong(Handle, Native.GWL_EXSTYLE);
        Log.Write(string.Format("穿透开关：{0}，操作后 GWL_EXSTYLE=0x{1:X8}", on ? "开" : "关", after));
    }

    // ---------------------------------------------------------------- 退出：拆掉窗口，让资源管理器重画原壁纸
    public void Shutdown()
    {
        if (shuttingDown) return;
        shuttingDown = true;
        iconTimer.Stop(); fgTimer.Stop();
        reader.Dispose();
        iconLocator.Stop();
        IntPtr parent = parentHwnd;
        try { web.Dispose(); } catch { /* 退出阶段 WebView2 失效无妨 */ }
        if (IsHandleCreated) { Native.SetParent(Handle, IntPtr.Zero); Hide(); }
        // 不改动壁纸设置（幻灯片 / 聚焦壁纸也不受影响），只让资源管理器重画
        if (parent != IntPtr.Zero && Native.IsWindow(parent))
            Native.RedrawWindow(parent, IntPtr.Zero, IntPtr.Zero, 0x1 | 0x4 | 0x80 | 0x100);
        Close();
        // 仅 RedrawWindow 不够：Explorer 的壁纸层不会因子窗口移除而自动重贴壁纸，
        // 会残留窗口最后一帧的表面（本机实测为壁纸窗口的 BackColor）。发送未公开的
        // Progman 消息 0x052C,0xD,1 让资源管理器重建壁纸层，从而恢复系统壁纸。
        IntPtr progman = Native.FindWindow("Progman", null);
        if (progman != IntPtr.Zero)
        {
            IntPtr res;
            Native.SendMessageTimeout(progman, 0x052C, new IntPtr(0xD), new IntPtr(1), 0, 1000, out res);
            Log.Write("已请求资源管理器重建壁纸层（0x052C）");
        }
    }

    protected override void OnHandleDestroyed(EventArgs e)
    {
        if (winEventHook != IntPtr.Zero) { Native.UnhookWinEvent(winEventHook); winEventHook = IntPtr.Zero; }
        iconTimer.Stop(); fgTimer.Stop();
        reader.Dispose();
        iconLocator.Stop();
        base.OnHandleDestroyed(e);
    }
}
