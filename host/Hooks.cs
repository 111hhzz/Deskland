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

// 全局鼠标观察钩子（只读，永远先放行）：
//   · 桌面左键 → DOM 涟漪消息（全主题通用，见 lib/ripple.ts）；
//   · move/down/up → 「ptr」指针注入当前壁纸页面（ADR 0002：壁纸窗口 z 序低于图标层时收不到真实命中，
//     指针事件由这里补发；穿透开关开启时停发，点击与指针全部交给桌面 / 图标层）。
class DesktopPointerHook
{
    const int MoveIntervalMs = 16;              // move 注入节流（约 60Hz）：再密只是浪费跨进程消息

    readonly Native.LowLevelMouseProc proc;
    IntPtr hook;
    WallpaperForm wallpaper;
    DateTime lastMove = DateTime.MinValue;

    public WallpaperForm Wallpaper { set { wallpaper = value; } }

    /// <summary>是否向页面注入指针事件。鼠标穿透开启时置 false（点击不再驱动壁纸）。</summary>
    public bool InjectPointer { get; set; }

    public DesktopPointerHook()
    {
        proc = OnMouse;
        hook = Native.SetWindowsHookEx(Native.WH_MOUSE_LL, proc, Native.GetModuleHandle(null), 0);
        if (hook == IntPtr.Zero) Log.Write("桌面指针钩子注册失败（WH_MOUSE_LL）");
    }

    public void Stop()
    {
        if (hook == IntPtr.Zero) return;
        Native.UnhookWindowsHookEx(hook);
        hook = IntPtr.Zero;
    }

    IntPtr OnMouse(int nCode, IntPtr wParam, IntPtr lParam)
    {
        // 先交给后续钩子：观察逻辑出错也不能拦截用户的输入
        IntPtr next = Native.CallNextHookEx(hook, nCode, wParam, lParam);
        try
        {
            if (nCode < 0 || wallpaper == null) return next;
            int msg = wParam.ToInt32();
            if (msg != Native.WM_MOUSEMOVE && msg != Native.WM_LBUTTONDOWN && msg != Native.WM_LBUTTONUP) return next;
            var data = (Native.MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(Native.MSLLHOOKSTRUCT));
            Rectangle scr = Screen.PrimaryScreen.Bounds;
            if (!scr.Contains(data.pt.X, data.pt.Y)) return next;
            int x = data.pt.X - scr.X, y = data.pt.Y - scr.Y;

            if (msg == Native.WM_MOUSEMOVE)
            {
                // 移动只要落在主屏就注入（指针划过任何窗口上方也驱动壁纸跟随），仅做时间节流
                if (!InjectPointer) return next;
                DateTime now = DateTime.UtcNow;
                if ((now - lastMove).TotalMilliseconds < MoveIntervalMs) return next;
                lastMove = now;
                Inject("move", x, y);
                return next;
            }

            // 按下 / 抬起：只有落在真桌面（Progman / WorkerW）才算壁纸交互，点到设置窗口、任务栏不误触
            if (!OnDesktopRoot(data.pt)) return next;
            if (msg == Native.WM_LBUTTONDOWN)
            {
                wallpaper.Post(Json.Stringify(Json.Obj("t", "ripple", "x", x, "y", y)));
                if (InjectPointer) Inject("down", x, y);
            }
            else if (InjectPointer)
            {
                Inject("up", x, y);
            }
        }
        catch { /* 观察钩子：异常绝不能拦截用户输入 */ }
        return next;
    }

    static bool OnDesktopRoot(Native.POINT pt)
    {
        IntPtr root = Native.GetAncestor(Native.WindowFromPoint(pt), Native.GA_ROOT);
        if (root == IntPtr.Zero) return false;
        var cls = new StringBuilder(64);
        Native.GetClassName(root, cls, 64);
        string c = cls.ToString();
        return c == "Progman" || c == "WorkerW";
    }

    static string PtrMsg(string p, int x, int y)
    {
        return Json.Stringify(Json.Obj("t", "ptr", "p", p, "x", x, "y", y));
    }

    // 注入 = 发消息 + （仅 --test）落一条探针事件，供 E2E 确认钩子确实注入过
    void Inject(string p, int x, int y)
    {
        wallpaper!.Post(PtrMsg(p, x, y));
        TestProbe.Signal("ptr", new { p, x, y });
    }
}
