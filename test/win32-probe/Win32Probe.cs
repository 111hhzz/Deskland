// Win32 Probe：针对当前运行的 Deskland.exe 断言窗口行为
// 编译：test/win32-probe/build.ps1
// 运行：test/win32-probe/bin/Win32Probe.exe

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;

class Win32Probe
{
    // Win32 常量
    const int GWLP_USERDATA = -21;
    const int GWL_EXSTYLE = -20;
    const int GWL_STYLE = -16;
    const uint WS_EX_TRANSPARENT = 0x00000020;
    const uint WS_EX_LAYERED = 0x00080000;
    const uint WS_CHILD = 0x40000000;

    // Win32 导入
    [DllImport("user32.dll", SetLastError = true)]
    static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    static extern bool EnumChildWindows(IntPtr hWndParent, EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll", SetLastError = true)]
    static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    [DllImport("user32.dll", SetLastError = true)]
    static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll", SetLastError = true)]
    static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll", SetLastError = true)]
    static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    struct RECT { public int Left, Top, Right, Bottom; }

    // 窗口信息
    class WindowInfo
    {
        public IntPtr Hwnd;
        public string Title;
        public string ClassName;
        public List<WindowInfo> Children = new List<WindowInfo>();
    }

    // 断言结果
    static int failures = 0;
    static int passes = 0;

    static void Assert(bool condition, string name, string detail)
    {
        if (condition)
        {
            Console.ForegroundColor = ConsoleColor.Green;
            Console.WriteLine("  [PASS] " + name);
            Console.ResetColor();
            passes++;
        }
        else
        {
            Console.ForegroundColor = ConsoleColor.Red;
            Console.WriteLine("  [FAIL] " + name + (detail.Length > 0 ? " — " + detail : ""));
            Console.ResetColor();
            failures++;
        }
    }

    static void Assert(bool condition, string name)
    {
        Assert(condition, name, "");
    }

    static void Main(string[] args)
    {
        Console.OutputEncoding = Encoding.UTF8;
        Console.WriteLine("=== Deskland Win32 Probe ===");
        Console.WriteLine("Time: " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"));
        Console.WriteLine();

        // 1. 找到 Deskland.exe 进程
        var desklandProcs = Process.GetProcessesByName("Deskland");
        if (desklandProcs.Length == 0)
        {
            Console.WriteLine("Deskland.exe 未运行，请先启动。");
            Environment.Exit(1);
        }
        var proc = desklandProcs[0];
        Console.WriteLine("Deskland.exe PID=" + proc.Id + " MainWindowHandle=" + proc.MainWindowHandle);
        Console.WriteLine();

        // 2. 从测试事件文件读取壁纸窗口 HWND
        IntPtr wallpaperHwnd = IntPtr.Zero;
        var eventsPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DesklandPreview", "test-events-" + proc.Id + ".jsonl");
        if (!File.Exists(eventsPath))
        {
            // 尝试从 DESKLAND_PROFILE_DIR 找
            var profileDir = Environment.GetEnvironmentVariable("DESKLAND_PROFILE_DIR");
            if (!string.IsNullOrEmpty(profileDir))
                eventsPath = Path.Combine(profileDir, "test-events-" + proc.Id + ".jsonl");
        }
        if (File.Exists(eventsPath))
        {
            foreach (var line in File.ReadAllLines(eventsPath))
            {
                if (!line.Contains("webview2_ready")) continue;
                // 简单解析 data.hwnd
                var m = Regex.Match(line, "\"hwnd\":\\s*(\\d+)");
                if (m.Success) wallpaperHwnd = new IntPtr(long.Parse(m.Groups[1].Value));
            }
        }
        Console.WriteLine("从事件文件读取壁纸窗口 HWND=" + wallpaperHwnd);
        Console.WriteLine();

        // 3. 枚举顶层窗口，找设置窗口
        var allWindows = new List<WindowInfo>();
        EnumWindows(delegate(IntPtr hwnd, IntPtr lParam)
        {
            var info = GetWindowInfo(hwnd);
            if (info != null && (info.Title.Length > 0 || info.ClassName.StartsWith("Chrome_")))
                allWindows.Add(info);
            return true;
        }, IntPtr.Zero);

        WindowInfo settingsWin = allWindows.FirstOrDefault(w => w.Title == "Deskland Preview");
        // 用事件文件的 HWND 作为壁纸窗口；如果没读到，退化到类名匹配
        WindowInfo wallpaperWin = wallpaperHwnd != IntPtr.Zero ? GetWindowInfo(wallpaperHwnd) : null;
        if (wallpaperWin == null)
        {
            // 退化：找可见的 Chrome_WidgetWin_0（排除设置窗口的子窗口）
            if (settingsWin != null)
            {
                var settingsChildren = new List<IntPtr>();
                EnumChildWindows(settingsWin.Hwnd, delegate(IntPtr hwnd, IntPtr lParam)
                {
                    settingsChildren.Add(hwnd);
                    return true;
                }, IntPtr.Zero);
                wallpaperWin = allWindows.FirstOrDefault(w =>
                    w.ClassName == "Chrome_WidgetWin_0" && w.Hwnd != settingsWin.Hwnd && !settingsChildren.Contains(w.Hwnd));
            }
        }

        Console.WriteLine("--- 窗口枚举 ---");
        Console.WriteLine("设置窗口: " + (settingsWin != null ? "HWND=" + settingsWin.Hwnd + " Title=" + settingsWin.Title : "未找到"));
        Console.WriteLine("壁纸窗口: " + (wallpaperWin != null ? "HWND=" + wallpaperWin.Hwnd + " Class=" + wallpaperWin.ClassName : "未找到"));
        Console.WriteLine();

        // 3. 设置窗口 Visual Hosting 断言
        Console.WriteLine("--- 设置窗口 Visual Hosting 断言 ---");
        if (settingsWin != null)
        {
            var children = new List<WindowInfo>();
            EnumChildWindows(settingsWin.Hwnd, delegate(IntPtr hwnd, IntPtr lParam)
            {
                children.Add(GetWindowInfo(hwnd));
                return true;
            }, IntPtr.Zero);
            settingsWin.Children = children;

            Console.WriteLine("子窗口:");
            foreach (var c in children)
                Console.WriteLine("  HWND=" + c.Hwnd + " Class=" + c.ClassName + " Title=" + c.Title);

            var chromeWin1 = children.FirstOrDefault(c => c.ClassName == "Chrome_WidgetWin_1");
            var chromeWin0 = children.FirstOrDefault(c => c.ClassName == "Chrome_WidgetWin_0");

            Assert(chromeWin0 != null, "设置窗口有 Chrome_WidgetWin_0 子窗口");
            Assert(chromeWin1 == null, "设置窗口无 Chrome_WidgetWin_1 子窗口（Visual Hosting 生效）",
                chromeWin1 != null ? "发现 Chrome_WidgetWin_1 HWND=" + chromeWin1.Hwnd : "");
        }
        else
        {
            Assert(false, "设置窗口未找到");
        }
        Console.WriteLine();

        // 4. 壁纸窗口 Windowed 断言
        Console.WriteLine("--- 壁纸窗口 Windowed 断言 ---");
        if (wallpaperWin != null)
        {
            var children = new List<WindowInfo>();
            EnumChildWindows(wallpaperWin.Hwnd, delegate(IntPtr hwnd, IntPtr lParam)
            {
                children.Add(GetWindowInfo(hwnd));
                return true;
            }, IntPtr.Zero);
            wallpaperWin.Children = children;

            Console.WriteLine("直接子窗口:");
            foreach (var c in children)
                Console.WriteLine("  HWND=" + c.Hwnd + " Class=" + c.ClassName + " Title=" + c.Title);

            // WebView2 窗口结构：WinForms → Chrome_WidgetWin_0 → Chrome_WidgetWin_1 → Chrome_RenderWidgetHostHWND
            // 先找 Chrome_WidgetWin_0，再枚举它的子窗口
            var chromeWin0 = children.FirstOrDefault(c => c.ClassName == "Chrome_WidgetWin_0");
            var chromeWin1 = chromeWin0 != null ? FindChildByClass(chromeWin0.Hwnd, "Chrome_WidgetWin_1") : null;
            Assert(chromeWin1 != null, "壁纸窗口有 Chrome_WidgetWin_1 子窗口（Windowed 模式，鼠标穿透可用）",
                "未找到 Chrome_WidgetWin_1（chromeWin0=" + (chromeWin0 != null ? chromeWin0.Hwnd.ToString() : "null") + "）");
        }
        else
        {
            Assert(false, "壁纸窗口未找到");
        }
        Console.WriteLine();

        // 5. 进程隔离校验（只筛选 Deskland 的 WebView2 进程）
        Console.WriteLine("--- 进程隔离校验 ---");
        var wv2Procs = Process.GetProcessesByName("msedgewebview2");
        var desklandWv2Procs = new List<Process>();
        foreach (var p in wv2Procs)
        {
            try
            {
                var cmdLine = GetCommandLine(p);
                if (cmdLine.Contains("Deskland.exe"))
                    desklandWv2Procs.Add(p);
            }
            catch { }
        }
        Console.WriteLine("Deskland 的 msedgewebview2.exe 实例数: " + desklandWv2Procs.Count);
        foreach (var p in desklandWv2Procs)
        {
            try
            {
                var cmdLine = GetCommandLine(p);
                Console.WriteLine("  PID=" + p.Id + " CmdLine=" + cmdLine);
            }
            catch (Exception ex)
            {
                Console.WriteLine("  PID=" + p.Id + " (无法读取命令行: " + ex.Message + ")");
            }
        }

        Assert(desklandWv2Procs.Count >= 2, "Deskland 的 msedgewebview2.exe 至少有两个实例（壁纸 + 设置）",
            "实际 " + desklandWv2Procs.Count + " 个");

        // 用 Contains 匹配（不依赖精确正则提取完整路径）
        bool hasWallpaperUdf = false;
        bool hasSettingsUdf = false;
        foreach (var p in desklandWv2Procs)
        {
            try
            {
                var cmd = GetCommandLine(p);
                if (cmd.Contains("WebView2-Settings")) hasSettingsUdf = true;
                if (cmd.Contains("WebView2") && !cmd.Contains("WebView2-Settings")) hasWallpaperUdf = true;
            }
            catch { }
        }

        Assert(hasWallpaperUdf, "存在 UDF 指向 WebView2（壁纸层）");
        Assert(hasSettingsUdf, "存在 UDF 指向 WebView2-Settings（设置层）");
        Console.WriteLine();

        // 6. 穿透开关校验
        Console.WriteLine("--- 穿透开关校验 ---");
        if (wallpaperWin != null)
        {
            var exStyle = (uint)GetWindowLong(wallpaperWin.Hwnd, GWL_EXSTYLE);
            Console.WriteLine("GWL_EXSTYLE = 0x" + exStyle.ToString("X8"));
            var hasTransparent = (exStyle & WS_EX_TRANSPARENT) != 0;
            Console.WriteLine("WS_EX_TRANSPARENT: " + (hasTransparent ? "ON" : "OFF"));
            Console.WriteLine("  [INFO] 穿透当前状态: " + (hasTransparent ? "开启" : "关闭"));
        }
        else
        {
            Assert(false, "壁纸窗口未找到，无法校验穿透");
        }
        Console.WriteLine();

        // 汇总
        Console.WriteLine("=== 结果 ===");
        Console.WriteLine("通过: " + passes + "  失败: " + failures);
        Environment.Exit(failures > 0 ? 1 : 0);
    }

    static WindowInfo GetWindowInfo(IntPtr hwnd)
    {
        var title = new StringBuilder(256);
        var className = new StringBuilder(256);
        GetWindowText(hwnd, title, 256);
        GetClassName(hwnd, className, 256);
        return new WindowInfo
        {
            Hwnd = hwnd,
            Title = title.ToString(),
            ClassName = className.ToString(),
        };
    }

    static WindowInfo FindChildByClass(IntPtr parent, string className)
    {
        WindowInfo result = null;
        EnumChildWindows(parent, delegate(IntPtr hwnd, IntPtr lParam)
        {
            var info = GetWindowInfo(hwnd);
            if (info.ClassName == className)
            {
                result = info;
                return false; // 找到就停
            }
            return true;
        }, IntPtr.Zero);
        return result;
    }

    // 读取进程命令行（WMI）
    static string GetCommandLine(Process proc)
    {
        try
        {
            using (var searcher = new System.Management.ManagementObjectSearcher(
                "SELECT CommandLine FROM Win32_Process WHERE ProcessId = " + proc.Id))
            {
                foreach (var obj in searcher.Get())
                {
                    return obj["CommandLine"] != null ? obj["CommandLine"].ToString() : "";
                }
            }
        }
        catch (Exception ex)
        {
            return "[WMI error: " + ex.Message + "]";
        }
        return "";
    }
}
