using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

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
        catch { /* 观察钩子：异常绝不能拦截用户点击 */ }
        return next;
    }
}
