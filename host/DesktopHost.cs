// Deskland · 桌面宿主（原型）
//
// 主要工作：
//   1. 把一个无边框窗口挂到桌面图标下面（壁纸层），里面用 WebView2 显示当前主题的页面（如 prototype/flat.html?wallpaper=1）
//   0. 设置窗口（prototype/settings.html）：静态缩略图预览、选主题、调参数，立即同步到壁纸并保存到 settings.json
//   2. 每 400ms 读取桌面图标的真实位置（桌面 ListView 的跨进程消息），有变化才发给页面
//   3. 前台窗口最大化 / 全屏时暂停动画；托盘图标可以暂停、重新载入、退出（退出后恢复原壁纸）
//   4. 资源管理器重建壁纸层时（例如按 Win+D），我们的窗口会被连带销毁 → 自动重新挂载
//   5. 只读观察桌面空白处左键，给壁纸页面发 {"t":"ripple","x":物理像素,"y":物理像素}；点击始终放行
//
// 用 Windows 自带的 .NET Framework 编译器编译（C# 5 语法），见 build.ps1。

using System;
using System.Diagnostics;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Win32;

static class Program
{
    public static readonly string ExitEventName = "DesklandHost_Exit" + InstallProfile.Suffix;
    public static readonly string MenuEventName = "DesklandHost_Menu" + InstallProfile.Suffix;
    public static readonly string SettingsEventName = "DesklandHost_Settings" + InstallProfile.Suffix;

    // 通知正在运行的实例（退出 / 弹出菜单）
    static void Signal(string name)
    {
        Native.AllowSetForegroundWindow(-1);            // 让运行中的实例能把菜单弹到最前面
        EventWaitHandle ev;
        if (EventWaitHandle.TryOpenExisting(name, out ev)) ev.Set();
    }

    [STAThread]
    static void Main(string[] args)
    {
        // Deskland.exe --exit ：通知正在运行的实例正常退出（恢复原壁纸）
        // Deskland.exe --menu ：让正在运行的实例在鼠标位置弹出菜单
        // Deskland.exe --settings ：让正在运行的实例打开设置窗口
        if (args.Length > 0 && args[0] == "--exit") { Signal(ExitEventName); return; }
        if (args.Length > 0 && args[0] == "--menu") { Signal(MenuEventName); return; }
        if (args.Length > 0 && args[0] == "--settings") { Signal(SettingsEventName); return; }
        if (args.Length > 0 && args[0] == "--exit-installed") { Environment.ExitCode = InstallProfile.StopInstalled(); return; }
        // Preview never migrates or shares the development edition's settings.                                 // 老名字（Habitat Wallpaper）下的数据目录、开机自启项搬过来
        bool fromAutostart = Array.IndexOf(args, "--autostart") >= 0;
        if (fromAutostart) AutoStartCheck.MarkLaunched();  // 开机自启跑起来了（不管后面是不是已经在运行）
        bool created;
        var mutex = new Mutex(true, "DesklandHost_Singleton" + InstallProfile.Suffix, out created);
        if (!created)
        {
            if (!fromAutostart) Signal(SettingsEventName); // 已经在运行：再次双击程序 = 打开设置（开机自启那次就悄悄退出）
            return;
        }
        // 按物理像素工作：桌面图标坐标、屏幕尺寸都是物理像素
        if (!Native.SetProcessDpiAwarenessContext(new IntPtr(-4))) Native.SetProcessDPIAware();
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        // 任何意外都写进日志，不弹框也不静默退出
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += delegate(object s, ThreadExceptionEventArgs e) { Log.Write("未处理的异常：" + e.Exception); };
        AppDomain.CurrentDomain.UnhandledException += delegate(object s, UnhandledExceptionEventArgs e) { Log.Write("致命异常：" + e.ExceptionObject); };
        string exeDir = AppDomain.CurrentDomain.BaseDirectory;
        string pageDir = Path.GetFullPath(Path.Combine(exeDir, @"..\..\prototype"));
        // 24H2+ 的挂法：默认做 Progman 的分层子窗口（换系统壁纸时会闪一下）；
        //   --defview：挂进图标层里、图标列表之下（实验：实测画不出来）；--legacy：挂进 WorkerW（换壁纸时会被连带销毁）
        string attach = "progman";
        bool autostart = false;                           // --autostart：开机自动启动，不弹设置窗口
        foreach (string a in args)
        {
            if (a == "--legacy") attach = "legacy";
            else if (a == "--defview") attach = "defview";
            else if (a == "--autostart") autostart = true;
            else if (!a.StartsWith("--")) pageDir = a;
        }
        WallpaperForm.AttachMode = attach;
        Application.Run(new HostContext(pageDir, !autostart));
        GC.KeepAlive(mutex);
    }
}

static class Log
{
    public static readonly string DataDir = InstallProfile.DataDir;
    public static readonly string FilePath = Path.Combine(DataDir, "host.log");

    public static void Write(string msg)
    {
        try
        {
            Directory.CreateDirectory(DataDir);
            File.AppendAllText(FilePath, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss ") + msg + "\r\n");
        }
        catch { }
    }
}

// 2026-10-10 改名（Habitat Wallpaper → Deskland）：老用户的东西照旧能用
//   - 数据目录 %LOCALAPPDATA%\HabitatWallpaper（设置、开机自启的记录、WebView2 缓存）整个搬到 %LOCALAPPDATA%\Deskland；
//     旧程序还开着、WebView2 的文件被占着搬不动时，只把设置这些小文件拷过去
//   - 用户开着开机自启：注册表 Run 项里的 HabitatWallpaper 换成指向 Deskland.exe 的 Deskland（用户原来的选择照旧，不会替没开的人打开）
static class Rename
{
    const string OldName = "HabitatWallpaper";
    public static void Migrate()
    {
        string oldDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), OldName);
        try
        {
            if (Directory.Exists(oldDir) && !Directory.Exists(Log.DataDir))
            {
                try { Directory.Move(oldDir, Log.DataDir); }
                catch
                {
                    Directory.CreateDirectory(Log.DataDir);
                    foreach (string src in Directory.GetFiles(oldDir))
                        if (!src.EndsWith(".log", StringComparison.OrdinalIgnoreCase)) File.Copy(src, Path.Combine(Log.DataDir, Path.GetFileName(src)), false);
                }
                Log.Write("改名：数据目录从 " + oldDir + " 搬到 " + Log.DataDir);
            }
        }
        catch (Exception ex) { Log.Write("改名：搬数据目录失败：" + ex.Message); }
        try
        {
            using (RegistryKey k = Registry.CurrentUser.OpenSubKey(HostContext.RunKey, true))
            {
                if (k != null && k.GetValue(OldName) != null)
                {
                    k.DeleteValue(OldName, false);
                    k.SetValue(HostContext.RunName, "\"" + Application.ExecutablePath + "\" --autostart");
                    Log.Write("改名：开机自启的启动项 " + OldName + " 换成 " + HostContext.RunName);
                }
            }
        }
        catch (Exception ex) { Log.Write("改名：换开机自启的启动项失败：" + ex.Message); }
    }
}

// 开机自启有没有被拦（比如被火绒、360 的"启动项管理"禁止了：注册表里的启动项还在，但登录时不让运行）：
// 每次带 --autostart 启动时记下时间；用户手动打开程序时，如果开着开机自启、本次登录已经过了 3 分钟，
// 却没有本次登录之后的自启记录 → 登录时那次没跑起来
static class AutoStartCheck
{
    static string LastPath { get { return Path.Combine(Log.DataDir, "autostart.last"); } }
    static string EnabledPath { get { return Path.Combine(Log.DataDir, "autostart.enabled"); } }

    static void Stamp(string path)
    {
        try { Directory.CreateDirectory(Log.DataDir); File.WriteAllText(path, DateTime.UtcNow.Ticks.ToString()); } catch { }
    }
    static DateTime ReadStamp(string path)
    {
        try { return new DateTime(long.Parse(File.ReadAllText(path).Trim()), DateTimeKind.Utc); } catch { return DateTime.MinValue; }
    }
    public static void MarkLaunched() { Stamp(LastPath); }
    public static void MarkEnabled() { Stamp(EnabledPath); }

    // 本次登录的时间（UTC）：WTSQuerySessionInformation(WTSSessionInfo) 里的 LogonTime
    public static DateTime LogonTimeUtc()
    {
        IntPtr buf; int bytes;
        if (!Native.WTSQuerySessionInformation(IntPtr.Zero, -1, 24, out buf, out bytes)) return DateTime.MinValue;
        try { return bytes >= 216 ? DateTime.FromFileTimeUtc(Marshal.ReadInt64(buf, 200)) : DateTime.MinValue; }
        catch { return DateTime.MinValue; }
        finally { Native.WTSFreeMemory(buf); }
    }

    // 正在运行的安全软件（只用来在提示里点名，方便用户去对的地方改）
    public static string SecuritySoftware()
    {
        string[,] known = { { "HipsTray", "火绒" }, { "HipsDaemon", "火绒" }, { "360Tray", "360 安全卫士" }, { "360sd", "360 杀毒" },
                            { "QQPCTray", "腾讯电脑管家" }, { "kxetray", "金山毒霸" }, { "2345SafeTray", "2345 安全卫士" } };
        for (int i = 0; i < known.GetLength(0); i++)
            if (Process.GetProcessesByName(known[i, 0]).Length > 0) return known[i, 1];
        return "";
    }

    // 没问题返回 null；被拦了返回正在运行的安全软件名（没认出来是 ""），提示文字由设置页按界面语言拼
    public static string Detect(bool autoStartOn)
    {
        if (!autoStartOn) return null;
        DateTime logon = LogonTimeUtc();
        if (logon == DateTime.MinValue || (DateTime.UtcNow - logon).TotalMinutes < 3) return null;   // 刚登录：开机启动项可能还没轮到
        if (ReadStamp(EnabledPath) > logon) return null;                                           // 这次登录之后才打开的开机自启
        if (ReadStamp(LastPath) > logon) return null;                                              // 这次登录时自启过了
        string sw = SecuritySoftware();
        Log.Write("这次登录时开机自启没有运行（登录于 " + logon.ToLocalTime().ToString("yyyy-MM-dd HH:mm") + "）" + (sw != "" ? "，正在运行的安全软件：" + sw : ""));
        return sw;
    }
}

static class Json
{
    static readonly JavaScriptSerializer S = new JavaScriptSerializer();
    public static object Parse(string s) { return S.DeserializeObject(s); }
    public static string Stringify(object o) { return S.Serialize(o); }
    public static Dictionary<string, object> Obj(params object[] kv)
    {
        var d = new Dictionary<string, object>();
        for (int i = 0; i + 1 < kv.Length; i += 2) d[(string)kv[i]] = kv[i + 1];
        return d;
    }
}

// 用户设置：当前主题 + 每个主题的参数（只存用户改过的，没改过的用主题默认值）
// 保存在 %LOCALAPPDATA%\Deskland\settings.json
static class Settings
{
    static readonly string FilePath = Path.Combine(Log.DataDir, "settings.json");
    public static string Theme = "beach";
    public static string Lang = "auto";                // 界面语言："auto"（跟随系统）或 I18n.Supported 里的一种
    public static Dictionary<string, Dictionary<string, object>> Params = new Dictionary<string, Dictionary<string, object>>();

    public static void Load()
    {
        try
        {
            if (!File.Exists(FilePath)) return;
            var root = Json.Parse(File.ReadAllText(FilePath, Encoding.UTF8)) as Dictionary<string, object>;
            if (root == null) return;
            object v;
            if (root.TryGetValue("theme", out v) && v is string) Theme = (string)v;
            if (root.TryGetValue("lang", out v) && v is string) Lang = (string)v;
            if (root.TryGetValue("params", out v) && v is Dictionary<string, object>)
                foreach (var kv in (Dictionary<string, object>)v)
                {
                    var d = kv.Value as Dictionary<string, object>;
                    if (d != null) Params[kv.Key] = d;
                }
            Log.Write("已读取设置：主题 " + Theme);
        }
        catch (Exception ex) { Log.Write("读取设置失败（将使用默认值）：" + ex.Message); }
    }

    public static void Save()
    {
        try
        {
            Directory.CreateDirectory(Log.DataDir);
            File.WriteAllText(FilePath, Json.Stringify(Json.Obj("version", 1, "theme", Theme, "lang", Lang, "params", Params)), new UTF8Encoding(false));
        }
        catch (Exception ex) { Log.Write("保存设置失败：" + ex.Message); }
    }

    public static Dictionary<string, object> For(string theme)
    {
        Dictionary<string, object> d;
        if (!Params.TryGetValue(theme, out d)) Params[theme] = d = new Dictionary<string, object>();
        return d;
    }
}

// 界面语言（2026-10-14）：文字表在 prototype/i18n/<语言>.json——ui 给设置页、host 给托盘菜单和提示框、themes 给主题名和参数（简体中文的主题文字就是 themes.json 本身）。
// 设置里的"语言"默认"跟随系统"：用 Windows 的界面语言；不支持的语言用英文
static class I18n
{
    // 增加语言时同步设置页 LANGS 与体验版导出的语言列表。
    public static readonly string[] Supported = { "zh-CN", "en" };
    public static string Code = "zh-CN", Sys = "en";     // 现在用的语言；"跟随系统"时会用的语言
    static Dictionary<string, object> cur, en, zh;

    public static string FromCulture(System.Globalization.CultureInfo c)
    {
        string n = c.Name.ToLowerInvariant(), two = c.TwoLetterISOLanguageName;
        bool zhHant = n.StartsWith("zh") && (n.Contains("hant") || n.EndsWith("-tw") || n.EndsWith("-hk") || n.EndsWith("-mo"));
        string want = n.StartsWith("zh") ? (zhHant ? "zh-TW" : "zh-CN") : two == "pt" ? "pt-BR" : two;
        if (Array.IndexOf(Supported, want) >= 0) return want;
        return n.StartsWith("zh") ? "zh-CN" : "en";       // 繁体中文还没做：先用简体
    }

    public static void Load(string pageDir, string setting)
    {
        Sys = FromCulture(System.Globalization.CultureInfo.CurrentUICulture);
        Code = Array.IndexOf(Supported, setting) >= 0 ? setting : Sys;
        zh = Read(pageDir, "zh-CN");
        en = Read(pageDir, "en");
        cur = Code == "zh-CN" ? zh : Code == "en" ? en : Read(pageDir, Code);
        Log.Write("界面语言：" + Code + "（设置：" + setting + "，系统：" + Sys + "）");
    }

    static Dictionary<string, object> Read(string pageDir, string code)
    {
        try
        {
            var root = Json.Parse(File.ReadAllText(Path.Combine(Path.Combine(pageDir, "i18n"), code + ".json"), Encoding.UTF8)) as Dictionary<string, object>;
            object h;
            return root != null && root.TryGetValue("host", out h) ? h as Dictionary<string, object> : null;
        }
        catch (Exception ex) { Log.Write("读取语言文件失败（" + code + "）：" + ex.Message); return null; }
    }

    // 取一句话：当前语言 → 英文 → 简体中文；{名字} 换成后面成对给的值
    public static string T(string key, params string[] kv)
    {
        object v = null;
        bool found = (cur != null && cur.TryGetValue(key, out v)) || (en != null && en.TryGetValue(key, out v)) || (zh != null && zh.TryGetValue(key, out v));
        string str = found ? (v as string ?? key) : key;
        for (int i = 0; i + 1 < kv.Length; i += 2) str = str.Replace("{" + kv[i] + "}", kv[i + 1]);
        return str;
    }
}

// 整个程序的生命周期：托盘图标常驻；壁纸窗口没了就重新建一个
// 打开菜单的方式：托盘图标左键 / 右键、快捷键 Ctrl+Alt+H（或 --menu）
// 打开设置的方式：双击程序（没运行就先启动再打开）、双击托盘图标、菜单 → 设置…（或 --settings）
class HostContext : ApplicationContext
{
    public const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run", RunName = "DesklandPreview";
    static readonly MethodInfo ShowTrayMenu =
        typeof(NotifyIcon).GetMethod("ShowContextMenu", BindingFlags.Instance | BindingFlags.NonPublic);

    readonly string pageDir;
    readonly NotifyIcon tray;
    readonly MenuItem pauseItem, autoStartItem, settingsItem, reloadItem, exitItem, clickThroughItem;
    readonly System.Windows.Forms.Timer watch;
    readonly EventWaitHandle exitEvent, menuEvent, settingsEvent;
    readonly HotkeyWindow hotkey = new HotkeyWindow();
    readonly Queue<DateTime> restarts = new Queue<DateTime>();
    readonly DesktopClickHook clickHook;
    WallpaperForm form, dead;
    SettingsForm settingsWin;
    DateTime nextStart = DateTime.MaxValue, saveDue = DateTime.MaxValue;
    bool manualPause, exiting;
    string autoStartSw;                                 // 开机自启没跑起来（只在手动打开时检查）：正在运行的安全软件名（没认出来是 ""）；没问题是 null
    string updateVersion, updateUrl, updateStatus = "", updateError = "";
    double updateProgress = -1;                         // -1 = 当前阶段没有可显示的百分比

    public HostContext(string pageDir, bool showSettings)
    {
        this.pageDir = pageDir;
        Log.Write("启动，页面目录：" + pageDir + (showSettings ? "" : "（开机自动启动）"));
        if (showSettings) autoStartSw = AutoStartCheck.Detect(IsAutoStart());
        Settings.Load();
        I18n.Load(pageDir, Settings.Lang);
        exitEvent = new EventWaitHandle(false, EventResetMode.AutoReset, Program.ExitEventName);
        menuEvent = new EventWaitHandle(false, EventResetMode.AutoReset, Program.MenuEventName);
        settingsEvent = new EventWaitHandle(false, EventResetMode.AutoReset, Program.SettingsEventName);

        // 快捷键 Ctrl+Alt+H：在鼠标位置弹出菜单
        bool hotkeyOk = hotkey.Register(Native.MOD_CONTROL | Native.MOD_ALT | Native.MOD_NOREPEAT, Keys.H);
        hotkey.Pressed += delegate { ShowMenu(); };
        Log.Write(hotkeyOk ? "快捷键 Ctrl+Alt+H 已注册" : "快捷键 Ctrl+Alt+H 注册失败（可能被其他程序占用）");

        pauseItem = new MenuItem(I18n.T("trayPause"), delegate
        {
            manualPause = !manualPause;
            pauseItem.Checked = manualPause;
            if (form != null) form.SetManualPause(manualPause);
        });
        autoStartItem = new MenuItem(I18n.T("trayAutostart"), delegate { SetAutoStart(!autoStartItem.Checked); });
        autoStartItem.Checked = IsAutoStart();
        clickThroughItem = new MenuItem(I18n.T("trayClickThrough"), delegate
        {
            if (form != null) form.SetClickThrough(!clickThroughItem.Checked);
            clickThroughItem.Checked = !clickThroughItem.Checked;
        });
        clickThroughItem.Checked = false;            // 默认不勾选：保持互动模式基线（WebView2 正常接收鼠标）
        if (autoStartItem.Checked && AutoStartValue() != "")
        {
            try
            {
                if (CreateAutoStartShortcut())
                {
                    DeleteRunAutoStart();
                    Log.Write("开机自动启动已迁移到当前用户启动文件夹");
                }
                else if (AutoStartValue().IndexOf("--autostart") < 0)
                    using (RegistryKey k = Registry.CurrentUser.CreateSubKey(RunKey))   // 回退项缺参数时补上
                        k.SetValue(RunName, "\"" + Application.ExecutablePath + "\" --autostart");
            }
            catch (Exception ex) { Log.Write("迁移开机自动启动失败，保留原启动项：" + ex.Message); }
        }
        settingsItem = new MenuItem(I18n.T("traySettings"), delegate { OpenSettings(); });
        settingsItem.DefaultItem = true;                // 粗体：主入口

        tray = new NotifyIcon();
        tray.Icon = AppIcon.Create();
        tray.Text = "Deskland Preview";
        tray.ContextMenu = new ContextMenu(new[] {
            settingsItem,
            pauseItem,
            reloadItem = new MenuItem(I18n.T("trayReload"), delegate { if (form != null) form.Reload(); }),
            autoStartItem,
        clickThroughItem,
            new MenuItem("-"),
            exitItem = new MenuItem(I18n.T("trayExit"), delegate { Exit(); }),
        });
        tray.MouseUp += delegate(object s, MouseEventArgs e) { if (e.Button == MouseButtons.Left) ShowMenu(); };
        tray.DoubleClick += delegate { OpenSettings(); };   // 双击托盘图标：直接打开设置
        tray.Visible = true;
        ShowWelcomeOnce(hotkeyOk);
        clickHook = new DesktopClickHook();

        watch = new System.Windows.Forms.Timer();
        watch.Interval = 500;
        watch.Tick += delegate { Watch(); };
        watch.Start();
        StartForm();
        if (showSettings) OpenSettings();                // 用户双击程序启动：直接打开设置
    }

    // 换了界面语言：托盘菜单的文字跟着换
    void ApplyTrayTexts()
    {
        settingsItem.Text = I18n.T("traySettings");
        pauseItem.Text = I18n.T("trayPause");
        reloadItem.Text = I18n.T("trayReload");
        autoStartItem.Text = I18n.T("trayAutostart");
        exitItem.Text = I18n.T("trayExit");
        clickThroughItem.Text = I18n.T("trayClickThrough");
    }

    // ---------------------------------------------------------------- 设置窗口
    public void OpenSettings()
    {
        if (exiting) return;
        if (settingsWin == null || settingsWin.IsDisposed)
        {
            settingsWin = new SettingsForm(pageDir, this);
            settingsWin.FormClosed += delegate { settingsWin = null; };
            Log.Write("打开设置窗口");
        }
        if (settingsWin.WindowState == FormWindowState.Minimized) settingsWin.WindowState = FormWindowState.Normal;
        settingsWin.Show();
        // 外部以 SW_HIDE 启动时，WinForms 的 Visible 状态可能已是 true，
        // 但原生窗口仍被隐藏；Activate / 再次 Show 不会修复，必须显式还原。
        // SW_RESTORE 同时处理隐藏和最小化，SW_SHOW 不会展开已最小化的窗口。
        Native.ShowWindow(settingsWin.Handle, Native.SW_RESTORE);
        settingsWin.Activate();
    }

    string SettingsMessage()
    {
        return Json.Stringify(Json.Obj("t", "settings", "v", Settings.For(Settings.Theme)));
    }

    string UpdateStateMessage()
    {
        return Json.Stringify(Json.Obj("t", "updateState", "version", updateVersion,
            "status", updateStatus, "progress", updateProgress, "error", updateError));
    }

    void PostUpdateState()
    {
        if (settingsWin != null) settingsWin.Post(UpdateStateMessage());
    }

    // 仅用于开发联调或非商店更新源；商店版始终使用 StoreContext，不接受网页传入地址。
    public void OfferUpdate(string version, string url)
    {
        Uri uri;
        if (string.IsNullOrWhiteSpace(version) || !Uri.TryCreate(url, UriKind.Absolute, out uri) || uri.Scheme != Uri.UriSchemeHttps)
            throw new ArgumentException("更新信息需要版本号和有效的 HTTPS 地址");
        updateVersion = version.Trim();
        updateUrl = uri.AbsoluteUri;
        updateStatus = "available";
        updateProgress = -1;
        updateError = "";
        PostUpdateState();
    }

    void SaveSoon() { saveDue = DateTime.Now.AddMilliseconds(600); }

    bool ThemeAllowed(string id)
    {
        return Themes.Allowed(pageDir, id, delegate(string product) { return false; });
    }

    // 设置页发来的消息：hello / set / reset / theme / autostart / lang / updateProgram
    public void OnSettingsMessage(string s)
    {
        var m = Json.Parse(s) as Dictionary<string, object>;
        if (m == null || settingsWin == null) return;
        object t;
        m.TryGetValue("t", out t);
        switch (t as string)
        {
            case "hello":
                Rectangle scr = Screen.PrimaryScreen.Bounds;
                settingsWin.Post(Json.Stringify(Json.Obj("t", "init", "theme", Settings.Theme, "params", Settings.Params,
                    "screen", Json.Obj("w", scr.Width, "h", scr.Height), "autostart", IsAutoStart(),
                    "autostartWarn", autoStartSw != null, "autostartSw", autoStartSw ?? "",
                    "lang", Settings.Lang, "langEff", I18n.Code, "langSys", I18n.Sys)));
                if (updateVersion != null) PostUpdateState();
                break;
            case "set":
            {
                string theme = m["theme"] as string, key = m["key"] as string;
                if (theme == null || key == null) return;
                Settings.For(theme)[key] = m["value"];
                if (theme == Settings.Theme && form != null)
                    form.Post(Json.Stringify(Json.Obj("t", "settings", "v", Json.Obj(key, m["value"]))));
                SaveSoon();
                break;
            }
            case "reset":
            {
                string theme = m["theme"] as string;
                if (theme == null) return;
                Settings.Params.Remove(theme);
                if (theme == Settings.Theme && form != null) form.Post("{\"t\":\"reset\"}");
                SaveSoon();
                Log.Write("恢复默认设置：" + theme);
                break;
            }
            case "theme":
            {
                string id = m["id"] as string;
                if (id == null || !ThemeAllowed(id))
                {
                    settingsWin.Post(Json.Stringify(Json.Obj("t", "themeChanged", "id", Settings.Theme)));
                    Log.Write("拒绝未授权或未知主题切换：" + (id ?? "null"));
                    return;
                }
                string page = Themes.PageFor(pageDir, id);
                if (page == null || id == Settings.Theme) return;
                Settings.Theme = id;
                SaveSoon();
                if (form != null) form.LoadPage(page);
                Log.Write("切换主题：" + id);
                break;
            }
            case "autostartWarnSeen":
                autoStartSw = null;
                break;
            case "lang":                                    // 换界面语言：存下来，托盘菜单跟着换，告诉设置页实际用哪种
            {
                object v;
                if (!m.TryGetValue("v", out v) || !(v is string)) return;
                Settings.Lang = (string)v;
                SaveSoon();
                I18n.Load(pageDir, Settings.Lang);
                ApplyTrayTexts();
                settingsWin.Post(Json.Stringify(Json.Obj("t", "lang", "v", Settings.Lang, "eff", I18n.Code, "sys", I18n.Sys)));
                break;
            }
            case "openWebsite":
                Process.Start("https://deskland.app/");
                break;
            case "updateProgram":
                if (updateUrl != null) Process.Start(updateUrl);
                break;
            case "autostart":
                SetAutoStart(m["v"] is bool && (bool)m["v"]);
                settingsWin.Post(Json.Stringify(Json.Obj("t", "autostart", "v", IsAutoStart())));
                break;
        }
    }

    // 在鼠标位置弹出托盘菜单（NotifyIcon 自带的弹出逻辑会处理前台窗口，菜单点别处能正常收起）
    void ShowMenu()
    {
        if (exiting) return;
        autoStartItem.Checked = IsAutoStart();
        if (ShowTrayMenu != null) ShowTrayMenu.Invoke(tray, null);
    }

    // 第一次运行时弹一条系统通知：告诉用户菜单在哪
    void ShowWelcomeOnce(bool hotkeyOk)
    {
        try
        {
            string flag = Path.Combine(Log.DataDir, "welcome.shown");
            if (File.Exists(flag)) return;
            Directory.CreateDirectory(Log.DataDir);
            tray.ShowBalloonTip(10000, I18n.T("welcomeTitle"),
                I18n.T("welcomeBody", "hotkey", hotkeyOk ? I18n.T("welcomeHotkey") : ""), ToolTipIcon.Info);
            File.WriteAllText(flag, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"));
        }
        catch (Exception ex) { Log.Write("首次提示失败：" + ex.Message); }
    }

    // 开机自动启动：优先用当前用户“启动”文件夹里的快捷方式；旧 Run 项启动时迁移。
    // 不使用需要额外权限的任务计划；快捷方式创建失败时仍保留 Run 项作为回退。
    static string AutoStartShortcutPath
    {
        get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Startup), "Deskland.lnk"); }
    }

    static object OpenAutoStartShortcut()
    {
        object shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));
        try
        {
            return shell.GetType().InvokeMember("CreateShortcut", BindingFlags.InvokeMethod,
                null, shell, new object[] { AutoStartShortcutPath });
        }
        finally { Marshal.FinalReleaseComObject(shell); }
    }

    static bool AutoStartShortcutEnabled()
    {
        if (!File.Exists(AutoStartShortcutPath)) return false;
        object link = null;
        try
        {
            link = OpenAutoStartShortcut();
            string target = link.GetType().InvokeMember("TargetPath", BindingFlags.GetProperty,
                null, link, null) as string;
            string arguments = link.GetType().InvokeMember("Arguments", BindingFlags.GetProperty,
                null, link, null) as string;
            return string.Equals(target, Application.ExecutablePath, StringComparison.OrdinalIgnoreCase)
                && arguments != null && arguments.IndexOf("--autostart", StringComparison.OrdinalIgnoreCase) >= 0;
        }
        catch { return false; }
        finally { if (link != null) Marshal.FinalReleaseComObject(link); }
    }

    static bool CreateAutoStartShortcut()
    {
        object link = null;
        try
        {
            link = OpenAutoStartShortcut();
            link.GetType().InvokeMember("TargetPath", BindingFlags.SetProperty,
                null, link, new object[] { Application.ExecutablePath });
            link.GetType().InvokeMember("Arguments", BindingFlags.SetProperty,
                null, link, new object[] { "--autostart" });
            link.GetType().InvokeMember("WorkingDirectory", BindingFlags.SetProperty,
                null, link, new object[] { Path.GetDirectoryName(Application.ExecutablePath) });
            link.GetType().InvokeMember("IconLocation", BindingFlags.SetProperty,
                null, link, new object[] { Application.ExecutablePath + ",0" });
            link.GetType().InvokeMember("Description", BindingFlags.SetProperty,
                null, link, new object[] { "Deskland" });
            link.GetType().InvokeMember("Save", BindingFlags.InvokeMethod, null, link, null);
            return File.Exists(AutoStartShortcutPath);
        }
        catch (Exception ex) { Log.Write("创建启动文件夹快捷方式失败：" + ex.Message); return false; }
        finally { if (link != null) Marshal.FinalReleaseComObject(link); }
    }

    static string AutoStartValue()
    {
        if (InstallProfile.Isolated) return "";
        using (RegistryKey k = Registry.CurrentUser.OpenSubKey(RunKey))
        {
            string v = k == null ? null : k.GetValue(RunName) as string;
            return v ?? "";
        }
    }

    static void DeleteRunAutoStart()
    {
        using (RegistryKey k = Registry.CurrentUser.OpenSubKey(RunKey, true))
            if (k != null) k.DeleteValue(RunName, false);
    }

    static bool IsAutoStart()
    {
        return AutoStartShortcutEnabled()
            || AutoStartValue().IndexOf(Application.ExecutablePath, StringComparison.OrdinalIgnoreCase) >= 0;
    }

    void SetAutoStart(bool on)
    {
        if (InstallProfile.Isolated) return;
        try
        {
            if (on)
            {
                bool shortcut = CreateAutoStartShortcut();
                if (shortcut) DeleteRunAutoStart();
                else
                    using (RegistryKey k = Registry.CurrentUser.CreateSubKey(RunKey))
                        k.SetValue(RunName, "\"" + Application.ExecutablePath + "\" --autostart");
                AutoStartCheck.MarkEnabled();
                Log.Write(shortcut ? "已开启开机自动启动（当前用户启动文件夹）" : "已开启开机自动启动（传统启动项回退）");
            }
            else
            {
                DeleteRunAutoStart();
                if (File.Exists(AutoStartShortcutPath)) File.Delete(AutoStartShortcutPath);
                Log.Write(IsAutoStart() ? "关闭开机自动启动失败，启动项仍存在" : "已关闭开机自动启动");
            }
        }
        catch (Exception ex) { Log.Write("设置开机自动启动失败：" + ex.Message); }
        autoStartItem.Checked = IsAutoStart();
    }

    void StartForm()
    {
        nextStart = DateTime.MaxValue;
        if (!ThemeAllowed(Settings.Theme)) Settings.Theme = ThemeAllowed("beach") ? "beach" : "meadow";
        string page = ThemeAllowed(Settings.Theme) ? Themes.PageFor(pageDir, Settings.Theme) : null;
        if (page == null)
        {
            Log.Write("没有可加载的已授权主题，5 秒后重试");
            nextStart = DateTime.Now.AddSeconds(5);
            return;
        }
        form = new WallpaperForm(pageDir, page, manualPause);
        form.SettingsJson = SettingsMessage;
        clickHook.Wallpaper = form;
        form.HandleDestroyed += OnFormGone;
        form.Show();
    }

    void OnFormGone(object sender, EventArgs e)
    {
        var f = (WallpaperForm)sender;
        if (f != form) return;
        form = null;
        clickHook.Wallpaper = null;
        dead = f;                                        // 稍后在计时器里释放，避免在销毁回调里重入
        if (exiting) return;
        if (f.Fatal) { Exit(); return; }

        // 1 分钟内反复被销毁：不再重试，避免和资源管理器打架
        restarts.Enqueue(DateTime.Now);
        while (restarts.Count > 0 && (DateTime.Now - restarts.Peek()).TotalSeconds > 60) restarts.Dequeue();
        if (restarts.Count > 5)
        {
            Log.Write("壁纸窗口 1 分钟内被销毁超过 5 次，停止重试");
            MessageBox.Show(I18n.T("errRebuilt") + "\n\n" + I18n.T("errSeeLog", "path", Log.FilePath), "Deskland Preview");
            Exit();
            return;
        }
        Log.Write("壁纸窗口被销毁（资源管理器重建了壁纸层），1 秒后重新挂载");
        nextStart = DateTime.Now.AddSeconds(1);
    }

    void Watch()
    {
        if (dead != null) { try { dead.Dispose(); } catch { } dead = null; }
        if (exitEvent.WaitOne(0)) { Exit(); return; }
        if (menuEvent.WaitOne(0)) ShowMenu();
        if (settingsEvent.WaitOne(0)) OpenSettings();
        if (DateTime.Now >= saveDue) { saveDue = DateTime.MaxValue; Settings.Save(); }
        if (form == null && !exiting && DateTime.Now >= nextStart) StartForm();
    }

    void Exit()
    {
        if (exiting) return;
        exiting = true;
        watch.Stop();
        if (saveDue != DateTime.MaxValue) Settings.Save();
        if (settingsWin != null) { try { settingsWin.Close(); } catch { } }
        hotkey.Dispose();
        clickHook.Stop();
        tray.Visible = false;
        if (form != null) form.Shutdown();
        Log.Write("退出");
        ExitThread();
    }
}

// 接收全局快捷键的隐藏窗口（只收消息，不显示）
class HotkeyWindow : NativeWindow, IDisposable
{
    public event EventHandler Pressed;
    bool registered;

    public HotkeyWindow()
    {
        var cp = new CreateParams();
        cp.Parent = new IntPtr(-3);                     // HWND_MESSAGE：纯消息窗口
        CreateHandle(cp);
    }

    public bool Register(uint modifiers, Keys key)
    {
        registered = Native.RegisterHotKey(Handle, 1, modifiers, (uint)key);
        return registered;
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == 0x0312 /* WM_HOTKEY */ && Pressed != null) Pressed(this, EventArgs.Empty);
        base.WndProc(ref m);
    }

    public void Dispose()
    {
        if (registered) Native.UnregisterHotKey(Handle, 1);
        registered = false;
        if (Handle != IntPtr.Zero) DestroyHandle();
    }
}

// 只读观察主屏桌面左键：放行所有点击，仅把桌面根窗口的点击位置发给当前壁纸页面。
class DesktopClickHook
{
    readonly Native.LowLevelMouseProc proc;
    IntPtr hook;
    WallpaperForm wallpaper;

    public WallpaperForm Wallpaper { set { wallpaper = value; } }

    public DesktopClickHook()
    {
        proc = OnMouse;
        hook = Native.SetWindowsHookEx(Native.WH_MOUSE_LL, proc, Native.GetModuleHandle(null), 0);
        if (hook == IntPtr.Zero) Log.Write("桌面点击钩子注册失败（WH_MOUSE_LL）");
    }

    public void Stop()
    {
        if (hook == IntPtr.Zero) return;
        Native.UnhookWindowsHookEx(hook);
        hook = IntPtr.Zero;
    }

    IntPtr OnMouse(int nCode, IntPtr wParam, IntPtr lParam)
    {
        // 先交给后续钩子，观察逻辑出错也不会拦截用户的点击。
        IntPtr next = Native.CallNextHookEx(hook, nCode, wParam, lParam);
        try
        {
            if (nCode < 0 || wParam != (IntPtr)Native.WM_LBUTTONDOWN || wallpaper == null) return next;
            var data = (Native.MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(Native.MSLLHOOKSTRUCT));
            Rectangle scr = Screen.PrimaryScreen.Bounds;
            if (!scr.Contains(data.pt.X, data.pt.Y)) return next;
            IntPtr root = Native.GetAncestor(Native.WindowFromPoint(data.pt), Native.GA_ROOT);
            if (root == IntPtr.Zero) return next;
            var cls = new StringBuilder(64);
            Native.GetClassName(root, cls, 64);
            string c = cls.ToString();
            if (c != "Progman" && c != "WorkerW") return next;
            wallpaper.Post(Json.Stringify(Json.Obj("t", "ripple", "x", data.pt.X - scr.X, "y", data.pt.Y - scr.Y)));
        }
        catch { }
        return next;
    }
}

// 托盘和设置窗口共用 Deskland 图标；构建脚本会把图标复制到程序目录。
static class AppIcon
{
    public static Icon Create()
    {
        return new Icon(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "DesklandPreview.ico"));
    }

    static GraphicsPath RoundRect(Rectangle r, int radius)
    {
        int d = radius * 2;
        var p = new GraphicsPath();
        p.AddArc(r.X, r.Y, d, d, 180, 90);
        p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        p.CloseFigure();
        return p;
    }
}

// 设置窗口：普通的桌面窗口，里面用 WebView2 显示 prototype/settings.html
class SettingsForm : Form
{
    readonly WebView2 web;
    readonly HostContext host;
    readonly string pageDir;

    public SettingsForm(string pageDir, HostContext host)
    {
        this.pageDir = pageDir;
        this.host = host;
        Text = "Deskland Preview";
        AccessibleName = "Deskland Preview";
        ShowIcon = true;
        Icon = AppIcon.Create();
        StartPosition = FormStartPosition.CenterScreen;
        float s = Native.GetDpiForSystem() / 96f;       // 进程按物理像素工作，窗口尺寸要自己按缩放比例算
        ClientSize = new Size((int)(1120 * s), (int)(800 * s));     // 左边主题排三列，右边上面预览、下面参数
        MinimumSize = new Size((int)(940 * s), (int)(680 * s));
        BackColor = GetCurrentThemeBackgroundColor();   // 跟随系统深浅色，加载/拖动期间避免白色拖影

        web = new WebView2();
        web.Dock = DockStyle.Fill;
        web.DefaultBackgroundColor = BackColor;
        web.CreationProperties = new CoreWebView2CreationProperties();
        web.CreationProperties.UserDataFolder = Path.Combine(Log.DataDir, "WebView2");
        Controls.Add(web);

    }

    // 设置窗口底色跟随系统深浅色（与标题栏一致）：浅 #ffffff / 深 #171717。
    // 页面加载期 body 还是 visibility:hidden，WebView2 会透出这个底色；用它做同色底可消除白闪/拖影。
    Color GetCurrentThemeBackgroundColor()
    {
        bool light = true;
        try
        {
            object v = Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "AppsUseLightTheme", 1);
            light = v == null || Convert.ToInt32(v) != 0;
        }
        catch { }
        return light ? Color.White : Color.FromArgb(23, 23, 23);
    }

    // 标题栏（系统原生那条）刷成和页面底色一样：settings.html 跟随系统深浅色（浅 #ffffff / 深 #171717），
    // 标题栏也按系统深浅色取同一个颜色。DWMWA_CAPTION_COLOR / 深色模式要 Win11，旧系统调用失败就保持系统原样
    void ThemeTitleBar()
    {
        Color bg = GetCurrentThemeBackgroundColor();
        BackColor = bg;                    // 窗体底色与页面/标题栏同色，拖动重绘间隙不露白
        web.DefaultBackgroundColor = bg;   // WebView2 控制器底色同色，加载期不闪白
        bool light = bg == Color.White;
        int dark = light ? 0 : 1;
        int color = light ? 0x00FFFFFF : 0x00171717;      // COLORREF 是 0x00BBGGRR
        Native.DwmSetWindowAttribute(Handle, 20, ref dark, 4);    // DWMWA_USE_IMMERSIVE_DARK_MODE：标题文字、按钮跟着深浅色
        Native.DwmSetWindowAttribute(Handle, 35, ref color, 4);   // DWMWA_CAPTION_COLOR
    }
    protected override void OnHandleCreated(EventArgs e) { base.OnHandleCreated(e); ThemeTitleBar(); }
    protected override void WndProc(ref Message m)
    {
        if (m.Msg == 0x001A /* WM_SETTINGCHANGE */) ThemeTitleBar();   // 系统切深浅色时标题栏跟着换
        base.WndProc(ref m);
    }

    protected override async void OnShown(EventArgs e)
    {
        base.OnShown(e);
        try
        {
            await web.EnsureCoreWebView2Async(null);
            if (IsDisposed) return;
            var core = web.CoreWebView2;
            try { core.MemoryUsageTargetLevel = CoreWebView2MemoryUsageTargetLevel.Low; }
            catch (Exception ex) { Log.Write("设置窗口内存级别调整失败：" + ex.Message); }
            core.SetVirtualHostNameToFolderMapping("app.local", pageDir, CoreWebView2HostResourceAccessKind.Allow);
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.WebMessageReceived += delegate(object s, CoreWebView2WebMessageReceivedEventArgs a)
            {
                try { host.OnSettingsMessage(a.TryGetWebMessageAsString()); }
                catch (Exception ex) { Log.Write("处理设置消息失败：" + ex.Message); }
            };
            string settingsUrl = "https://app.local/settings.html?v=" + Uri.EscapeDataString(Application.ProductVersion) + "&ui=2";
            Log.Write("设置页面：" + settingsUrl);
            core.Navigate(settingsUrl);
        }
        catch (Exception ex)
        {
            Log.Write("设置窗口启动失败：" + ex);
            MessageBox.Show(I18n.T("errSettings", "msg", ex.Message), "Deskland Preview");
            Close();
        }
    }

    public void Post(string json)
    {
        // 设置窗口是临时窗口：它的 WebView2 失效就先不发（关掉重开即恢复），别把异常抛回壁纸的轮询
        try { if (!IsDisposed && web.CoreWebView2 != null) web.CoreWebView2.PostWebMessageAsString(json); }
        catch { }
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        try { web.Dispose(); } catch { }
        base.OnFormClosed(e);
    }
}

class WallpaperForm : Form
{
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

    string page;                                        // 当前主题的页面（themes.json 里的 page）
    public Func<string> SettingsJson;                   // 页面就绪时先发给它的设置消息
    protected override bool ShowWithoutActivation { get { return true; } }

    public WallpaperForm(string pageDir, string page, bool manualPause)
    {
        this.pageDir = pageDir;
        this.page = page;
        this.manualPause = manualPause;
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
        iconTimer.Interval = 400;
        iconTimer.Tick += delegate { PollIcons(); };
        fgTimer = new System.Windows.Forms.Timer();
        fgTimer.Interval = 500;
        fgTimer.Tick += delegate { PollForeground(); };
    }

    public void SetManualPause(bool v) { manualPause = v; PollForeground(); }

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
    string PageUrl { get { return "https://app.local/" + page + "?wallpaper=1&ui=2"; } }

    // 切换主题：换页面；新页面就绪后会重新收到设置和图标
    public void LoadPage(string newPage)
    {
        page = newPage;
        if (web.CoreWebView2 == null) return;
        try { web.CoreWebView2.Navigate(PageUrl); }
        catch (InvalidOperationException ex) { WebDead(ex); }
        catch (COMException ex) { WebDead(ex); }
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
            await web.EnsureCoreWebView2Async(null);
            if (shuttingDown || IsDisposed) return;
            var core = web.CoreWebView2;
            core.SetVirtualHostNameToFolderMapping("app.local", pageDir, CoreWebView2HostResourceAccessKind.Allow);
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreDevToolsEnabled = true;
            core.Settings.IsStatusBarEnabled = false;
            // 页面就绪（发来 "ready"）：先发设置，再发图标和暂停状态（岸线要按设置里的离岸距离来算）
            core.WebMessageReceived += delegate(object s, CoreWebView2WebMessageReceivedEventArgs a)
            {
                string msg = null;
                try { msg = a.TryGetWebMessageAsString(); } catch { }
                if (msg != "ready") return;
                if (SettingsJson != null) core.PostWebMessageAsString(SettingsJson());
                lastIcons = ""; lastPause = -1; PollIcons(); PollForeground();
            };
            core.Navigate(PageUrl);
            iconTimer.Start();
            fgTimer.Start();
            // 事件驱动图标刷新：监听桌面 ListView 的 LOCATIONCHANGE，去抖后触发 PollIcons
            IntPtr lv = iconLocator.TryLocate();
            if (lv != IntPtr.Zero) { iconLocator.DesktopIconsMayHaveChanged += PollIcons; iconLocator.Start(lv); }
            else Log.Write("找不到桌面图标列表：不启用图标事件监听，保留 400ms 轮询兜底");
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
        MessageBox.Show(msg + "\n\n" + I18n.T("errSeeLog", "path", Log.FilePath), "Deskland Preview");
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
        Native.EnumWindows(delegate(IntPtr h, IntPtr l)
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
            winEventProc = delegate(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time)
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
        if (!raised || zAnchor == IntPtr.Zero || !Native.IsWindow(zAnchor)) return;
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
            Native.EnumChildWindows(Handle, delegate(IntPtr h, IntPtr l)
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
        try { web.Dispose(); } catch { }
        if (IsHandleCreated) { Native.SetParent(Handle, IntPtr.Zero); Hide(); }
        // 不改动壁纸设置（幻灯片 / 聚焦壁纸也不受影响），只让资源管理器重画
        if (parent != IntPtr.Zero && Native.IsWindow(parent))
            Native.RedrawWindow(parent, IntPtr.Zero, IntPtr.Zero, 0x1 | 0x4 | 0x80 | 0x100);
        Close();
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

// 通过桌面 ListView 的跨进程消息读取图标矩形（图标 + 文字，物理像素，屏幕坐标）
class IconReader : IDisposable
{
    IntPtr listView, proc, mem;

    public static IntPtr FindListView()
    {
        IntPtr defView = IntPtr.Zero;
        IntPtr progman = Native.FindWindow("Progman", null);
        if (progman != IntPtr.Zero) defView = Native.FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null);
        if (defView == IntPtr.Zero)
        {
            Native.EnumWindows(delegate(IntPtr h, IntPtr l)
            {
                IntPtr d = Native.FindWindowEx(h, IntPtr.Zero, "SHELLDLL_DefView", null);
                if (d != IntPtr.Zero) { defView = d; return false; }
                return true;
            }, IntPtr.Zero);
        }
        return defView == IntPtr.Zero ? IntPtr.Zero : Native.FindWindowEx(defView, IntPtr.Zero, "SysListView32", null);
    }

    bool Open()
    {
        Close();
        listView = FindListView();
        if (listView == IntPtr.Zero) return false;
        uint pid;
        Native.GetWindowThreadProcessId(listView, out pid);
        proc = Native.OpenProcess(0x0008 | 0x0010 | 0x0020, false, pid);   // VM_OPERATION | VM_READ | VM_WRITE
        if (proc == IntPtr.Zero) return false;
        mem = Native.VirtualAllocEx(proc, IntPtr.Zero, new IntPtr(64), 0x1000 | 0x2000, 0x04);
        return mem != IntPtr.Zero;
    }

    public List<Native.RECT> Read(out bool visible)
    {
        visible = false;
        if (listView == IntPtr.Zero || mem == IntPtr.Zero || !Native.IsWindow(listView)) { if (!Open()) return null; }
        visible = Native.IsWindowVisible(listView);
        var result = new List<Native.RECT>();
        if (!visible) return result;                   // 用户隐藏了桌面图标 → 全是海
        int count = (int)Native.SendMessage(listView, 0x1004 /* LVM_GETITEMCOUNT */, IntPtr.Zero, IntPtr.Zero);
        var origin = new Native.POINT();
        Native.ClientToScreen(listView, ref origin);
        for (int i = 0; i < count; i++)
        {
            var r = new Native.RECT();                 // Left = LVIR_BOUNDS（0）：图标 + 文字的整体范围
            IntPtr n;
            if (!Native.WriteProcessMemory(proc, mem, ref r, 16, out n)) { Close(); return null; }
            Native.SendMessage(listView, 0x100E /* LVM_GETITEMRECT */, new IntPtr(i), mem);
            if (!Native.ReadProcessMemory(proc, mem, out r, 16, out n)) { Close(); return null; }
            r.Left += origin.X; r.Right += origin.X; r.Top += origin.Y; r.Bottom += origin.Y;
            result.Add(r);
        }
        return result;
    }

    void Close()
    {
        if (mem != IntPtr.Zero && proc != IntPtr.Zero) Native.VirtualFreeEx(proc, mem, IntPtr.Zero, 0x8000);
        if (proc != IntPtr.Zero) Native.CloseHandle(proc);
        mem = proc = IntPtr.Zero;
    }

    public void Dispose() { Close(); }
}

// 桌面图标位置变化监听：单独的事件钩子监听 SysListView32 的 EVENT_OBJECT_LOCATIONCHANGE，
// 80ms 去抖后触发 DesktopIconsMayHaveChanged（订阅者再去读位置）。与 Z 顺序钩子完全独立。
class DesktopIconLocator : IDisposable
{
    IntPtr _cachedDesktopListView;
    IntPtr _iconHook;
    Native.WinEventDelegate _iconHookProc;   // 类级字段持有，避免被 GC（SetWinEventHook 在 C# 里最常见的崩溃源）
    System.Windows.Forms.Timer _debounce;
    readonly object _lock = new object();
    const int OBJID_CURSOR = -9, OBJID_CLIENT = -4;

    public event Action DesktopIconsMayHaveChanged;

    // 复用 IconReader 的查找逻辑，返回桌面图标列表句柄；失败返回 Zero
    public IntPtr TryLocate()
    {
        _cachedDesktopListView = IconReader.FindListView();
        return _cachedDesktopListView;
    }

    public void Start(IntPtr listView)
    {
        if (listView == IntPtr.Zero) return;
        _cachedDesktopListView = listView;
        _iconHookProc = IconEventProc;
        _debounce = new System.Windows.Forms.Timer();
        _debounce.Interval = 80;
        _debounce.Tick += delegate { _debounce.Stop(); RaiseChanged(); };
        _iconHook = Native.SetWinEventHook(0x800B, 0x800B, IntPtr.Zero, _iconHookProc, 0, 0, 0 /* WINEVENT_OUTOFCONTEXT */);
        if (_iconHook == IntPtr.Zero) Log.Write("图标事件钩子注册失败（EVENT_OBJECT_LOCATIONCHANGE）");
    }

    void IconEventProc(IntPtr hook, uint eventType, IntPtr hwnd, int idObject, int idChild, uint thread, uint time)
    {
        if (eventType != 0x800B) return;                        // 只关心 LOCATIONCHANGE
        if (hwnd != _cachedDesktopListView) return;             // 只关心桌面图标列表
        if (idObject == OBJID_CURSOR) return;                   // 鼠标移动会狂发，最先扔掉
        if (idObject != OBJID_CLIENT && idObject >= 0) return;  // 仅 OBJID_CLIENT(-4) 或列表项相关负值
        lock (_lock) { if (_debounce != null) { _debounce.Stop(); _debounce.Start(); } }  // 去抖
    }

    void RaiseChanged() { var h = DesktopIconsMayHaveChanged; if (h != null) h(); }

    // 可安全重复调用：钩子句柄为零时跳过 UnhookWinEvent
    public void Stop()
    {
        lock (_lock)
        {
            if (_debounce != null) { _debounce.Stop(); _debounce.Dispose(); _debounce = null; }
        }
        if (_iconHook != IntPtr.Zero) { Native.UnhookWinEvent(_iconHook); _iconHook = IntPtr.Zero; }
    }

    public void Dispose() { Stop(); }
}

static class Native
{
    public const int GWL_STYLE = -16, GWL_EXSTYLE = -20, WS_EX_LAYERED = 0x00080000, WS_EX_TRANSPARENT = 0x00000020;
    public const int WH_MOUSE_LL = 14, WM_LBUTTONDOWN = 0x0201, GA_ROOT = 2;
    public const uint LWA_ALPHA = 0x2, SWP_NOSIZE = 0x0001, SWP_NOMOVE = 0x0002;
    public const uint MOD_ALT = 0x1, MOD_CONTROL = 0x2, MOD_NOREPEAT = 0x4000;
    public const int SW_SHOW = 5, SW_RESTORE = 9;
    [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr h, int id, uint modifiers, uint vk);
    [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr h, int attr, ref int val, int size);
    [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr h, int id);
    [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int pid);
    [DllImport("user32.dll")] public static extern uint GetDpiForSystem();
    [DllImport("wtsapi32.dll", CharSet = CharSet.Unicode)] public static extern bool WTSQuerySessionInformation(IntPtr server, int session, int infoClass, out IntPtr buffer, out int bytes);
    [DllImport("wtsapi32.dll")] public static extern void WTSFreeMemory(IntPtr p);
    public delegate void WinEventDelegate(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time);
    [DllImport("user32.dll")] public static extern bool SetLayeredWindowAttributes(IntPtr h, uint key, byte alpha, uint flags);
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumWindowsProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr mod, WinEventDelegate proc, uint pid, uint tid, uint flags);
    [DllImport("user32.dll")] public static extern bool UnhookWinEvent(IntPtr hook);
    public const int WS_CHILD = 0x40000000, WS_VISIBLE = 0x10000000, WS_POPUP = unchecked((int)0x80000000);
    public const int WS_CAPTION = 0x00C00000, WS_THICKFRAME = 0x00040000;
    public const uint SWP_NOACTIVATE = 0x0010, SWP_SHOWWINDOW = 0x0040, SWP_FRAMECHANGED = 0x0020;

    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] public struct MSLLHOOKSTRUCT { public POINT pt; public uint mouseData, flags, time; public IntPtr dwExtraInfo; }
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    public delegate IntPtr LowLevelMouseProc(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] public static extern IntPtr SetParent(IntPtr child, IntPtr parent);
    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int index);
    [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr h, int index, int value);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] public static extern bool ScreenToClient(IntPtr h, ref POINT p);
    [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder sb, int max);
    [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT pt);
    [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, int flags);
    [DllImport("user32.dll")] public static extern IntPtr SetWindowsHookEx(int id, LowLevelMouseProc proc, IntPtr module, uint thread);
    [DllImport("user32.dll")] public static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] public static extern IntPtr CallNextHookEx(IntPtr hook, int nCode, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr GetModuleHandle(string module);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern bool RedrawWindow(IntPtr h, IntPtr rect, IntPtr rgn, uint flags);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attribute, out int value, int size);
    [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll")] public static extern IntPtr VirtualAllocEx(IntPtr proc, IntPtr addr, IntPtr size, uint type, uint protect);
    [DllImport("kernel32.dll")] public static extern bool VirtualFreeEx(IntPtr proc, IntPtr addr, IntPtr size, uint type);
    [DllImport("kernel32.dll")] public static extern bool WriteProcessMemory(IntPtr proc, IntPtr addr, ref RECT buf, int size, out IntPtr written);
    [DllImport("kernel32.dll")] public static extern bool ReadProcessMemory(IntPtr proc, IntPtr addr, out RECT buf, int size, out IntPtr read);
}

// Deskland Preview has its own data and instance identity; isolated profiles support installation QA.
static class InstallProfile
{
    public static readonly string Override = Environment.GetEnvironmentVariable("DESKLAND_PROFILE_DIR");
    public static readonly bool Isolated = !string.IsNullOrEmpty(Override);
    public static readonly string DataDir = Isolated ? Path.GetFullPath(Override) : Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DesklandPreview");
    public static readonly string Suffix = MakeSuffix();
    static string MakeSuffix()
    {
        if (!Isolated) return "_Preview";
        using (var hash = System.Security.Cryptography.SHA256.Create())
            return "_Preview_" + BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(DataDir.ToUpperInvariant()))).Replace("-", "").Substring(0, 24);
    }

    // An installer may only close the instance using this exact executable path.
    public static int StopInstalled()
    {
        foreach (Process process in Process.GetProcessesByName("Deskland"))
        {
            using (process)
            {
                if (process.Id == Process.GetCurrentProcess().Id) continue;
                try
                {
                    if (!string.Equals(process.MainModule.FileName, Application.ExecutablePath, StringComparison.OrdinalIgnoreCase)) continue;
                    EventWaitHandle ev;
                    if (!EventWaitHandle.TryOpenExisting(Program.ExitEventName, out ev)) return 1;
                    using (ev) ev.Set();
                    if (!process.WaitForExit(10000)) return 1;
                }
                catch (InvalidOperationException) { }
                catch { return 1; }
            }
        }
        return 0;
    }
}

