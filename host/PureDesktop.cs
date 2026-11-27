using System;
using System.Collections.Generic;
using System.Text;

// 「纯净显示桌面」：临时隐藏 Windows 任务栏（含多屏副任务栏），并把壁纸窗置顶盖住桌面图标层与
// 系统壁纸（由 WallpaperForm.SetOverlay 完成）。
//
// 刻意不动 SHELLDLL_DefView：壁纸窗是 Explorer 桌面层的子窗口，隐藏父层会让它一起消失，
// 还会触发资源管理器重排、把系统壁纸顶出来。置顶方案零副作用、可即时恢复。
//
// 开关状态持久化在 settings.json（Settings.PureDesktop）；关闭开关、程序退出都会恢复。
static class PureDesktop
{
    static bool on;
    static readonly List<IntPtr> hidden = new List<IntPtr>();

    public static bool On { get { return on; } }

    public static void Set(bool enable)
    {
        if (on == enable) return;
        on = enable;
        if (enable) HideTaskbars(); else ShowAll();
    }

    // 退出兜底：无条件恢复任务栏
    public static void Restore()
    {
        on = false;
        ShowAll();
    }

    static void HideTaskbars()
    {
        foreach (IntPtr h in Collect())
            if (Native.IsWindow(h) && Native.IsWindowVisible(h))
            {
                Native.ShowWindow(h, Native.SW_HIDE);
                hidden.Add(h);
            }
        Log.Write("纯净模式开启：已隐藏 " + hidden.Count + " 个任务栏");
    }

    static void ShowAll()
    {
        int n = 0;
        foreach (IntPtr h in hidden)
            if (Native.IsWindow(h)) { Native.ShowWindow(h, Native.SW_SHOW); n++; }
        hidden.Clear();
        if (n > 0) Log.Write("纯净模式关闭：已恢复 " + n + " 个任务栏");
    }

    static List<IntPtr> Collect()
    {
        var list = new List<IntPtr>();
        IntPtr tray = Native.FindWindow("Shell_TrayWnd", null);
        if (tray != IntPtr.Zero) list.Add(tray);
        Native.EnumWindows(delegate (IntPtr h, IntPtr l)
        {
            var sb = new StringBuilder(64);
            Native.GetClassName(h, sb, 64);
            if (sb.ToString() == "Shell_SecondaryTrayWnd") list.Add(h);
            return true;
        }, IntPtr.Zero);
        return list;
    }
}
