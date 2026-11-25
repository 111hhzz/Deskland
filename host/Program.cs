// Deskland · 桌面宿主（原型）
//
// 主要工作：
//   1. 把一个无边框窗口挂到桌面图标下面（壁纸层），里面用 WebView2 显示当前主题的页面（如 prototype/themes/beach/beach.html?wallpaper=1）
//   0. 设置窗口（prototype/pages/settings.html）：静态缩略图预览、选主题、调参数，立即同步到壁纸并保存到 settings.json
//   2. 每 400ms 读取桌面图标的真实位置（桌面 ListView 的跨进程消息），有变化才发给页面
//   3. 前台窗口最大化 / 全屏时暂停动画；托盘图标可以暂停、重新载入、退出（退出后恢复原壁纸）
//   4. 资源管理器重建壁纸层时（例如按 Win+D），我们的窗口会被连带销毁 → 自动重新挂载
//   5. 只读观察桌面空白处左键，给壁纸页面发 {"t":"ripple","x":物理像素,"y":物理像素}；点击始终放行
//
// 用 Windows 自带的 .NET Framework 编译器编译（SDK-style / net48 / C# 12），见 build.ps1。

using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Windows.Forms;

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
        Application.ThreadException += delegate (object s, ThreadExceptionEventArgs e) { Log.Write("未处理的异常：" + e.Exception); };
        AppDomain.CurrentDomain.UnhandledException += delegate (object s, UnhandledExceptionEventArgs e) { Log.Write("致命异常：" + e.ExceptionObject); };
        string exeDir = AppDomain.CurrentDomain.BaseDirectory;
        string pageDir = Path.GetFullPath(Path.Combine(exeDir, "prototype"));
        // 24H2+ 的挂法：默认做 Progman 的分层子窗口（换系统壁纸时会闪一下）；
        //   --defview：挂进图标层里、图标列表之下（实验：实测画不出来）；--legacy：挂进 WorkerW（换壁纸时会被连带销毁）
        string attach = "progman";
        bool autostart = false;                           // --autostart：开机自动启动，不弹设置窗口
        bool testMode = Environment.GetEnvironmentVariable("DESKLAND_TEST") == "1";  // 测试模式：双端口 CDP + 事件日志
        foreach (string a in args)
        {
            if (a == "--legacy") attach = "legacy";
            else if (a == "--defview") attach = "defview";
            else if (a == "--autostart") autostart = true;
            else if (a == "--test") testMode = true;
            else if (!a.StartsWith("--")) pageDir = a;
        }
        TestProbe.Enabled = testMode;
        WallpaperForm.AttachMode = attach;
        var startupTime = System.Diagnostics.Stopwatch.StartNew();
        Application.Run(new HostContext(pageDir, !autostart));
        GC.KeepAlive(mutex);
    }
}

// Deskland+ has its own data and instance identity; isolated profiles support installation QA.
static class InstallProfile
{
    public static readonly string Override = Environment.GetEnvironmentVariable("DESKLAND_PROFILE_DIR");
    public static readonly bool Isolated = !string.IsNullOrEmpty(Override);
    public static readonly string DataDir = Isolated ? Path.GetFullPath(Override) : Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DesklandPlus");
    public static readonly string Suffix = MakeSuffix();
    static string MakeSuffix()
    {
        if (!Isolated) return "_Plus";
        using (var hash = System.Security.Cryptography.SHA256.Create())
            return "_Plus_" + BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(DataDir.ToUpperInvariant()))).Replace("-", "").Substring(0, 24);
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
                    EventWaitHandle ev = null;
                    string[] exitNames = new string[] { Program.ExitEventName, "DesklandHost_Exit_Preview" };
                    foreach (string name in exitNames)
                    {
                        if (EventWaitHandle.TryOpenExisting(name, out ev)) break;
                        ev = null;
                    }
                    if (ev == null) return 1;
                    using (ev) ev.Set();
                    if (!process.WaitForExit(10000)) return 1;
                }
                catch (InvalidOperationException) { /* 进程模块读不到（已退出）：按未结束处理 */ }
                catch { return 1; }
            }
        }
        return 0;
    }
}
