using System;
using System.Collections.Generic;
using System.Windows.Forms;

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
            Native.EnumWindows(delegate (IntPtr h, IntPtr l)
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
