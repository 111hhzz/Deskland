using System;
using System.Diagnostics;
using System.IO;
using System.Text;

static class Log
{
    public static readonly string DataDir = InstallProfile.DataDir;
    public static readonly string FilePath = Path.Combine(DataDir, "host.log");
    public static readonly string EventsPath = Path.Combine(DataDir, "test-events-" + Process.GetCurrentProcess().Id + ".jsonl");
    public static readonly string RotatedPath = Path.Combine(DataDir, "host.log.1");
    const long MaxBytes = 1 << 20;                      // 1 MiB：超过就把当前日志挪成 host.log.1（覆盖上一份），总量封顶约 2 MiB

    public static void Write(string msg)
    {
        try
        {
            Directory.CreateDirectory(DataDir);
            var fi = new FileInfo(FilePath);
            if (fi.Exists && fi.Length >= MaxBytes)
            {
                if (File.Exists(RotatedPath)) File.Delete(RotatedPath);
                File.Move(FilePath, RotatedPath);
            }
            File.AppendAllText(FilePath, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss ") + msg + "\r\n");
        }
        catch { /* 日志自身写不了：静默，别递归 */ }
    }
}

// 测试探针：仅在 --test / DESKLAND_TEST=1 时写入结构化事件，供 Playwright 等待同步。
// 不替代真实画面/行为断言，只提供确定性信号。
static class TestProbe
{
    public static readonly object Sync = new object();
    public static bool Enabled;

    public static void Signal(string name, object data = null)
    {
        if (!Enabled) return;
        lock (Sync)
        {
            try
            {
                Directory.CreateDirectory(Log.DataDir);
                var obj = Json.Obj("t", "probe", "event", name,
                    "ts", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), "data", data);
                File.AppendAllText(Log.EventsPath, Json.Stringify(obj) + "\n", Encoding.UTF8);
            }
            catch { /* 探针事件写不了不影响主流程 */ }
        }
    }
}
