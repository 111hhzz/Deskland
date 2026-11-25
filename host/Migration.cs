using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.Win32;

// 2026-11-20 改名（Deskland Preview → Deskland+）：把旧数据目录的设置复制到新目录（保留旧目录，不删用户数据）
static class Rename
{
    const string PreviewName = "DesklandPreview";
    public static void MigratePreview()
    {
        if (InstallProfile.Isolated) return;
        string oldDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), PreviewName);
        try
        {
            if (Directory.Exists(oldDir) && !Directory.Exists(Log.DataDir))
            {
                Directory.CreateDirectory(Log.DataDir);
                foreach (string src in Directory.GetFiles(oldDir))
                    if (!src.EndsWith(".log", StringComparison.OrdinalIgnoreCase))
                        File.Copy(src, Path.Combine(Log.DataDir, Path.GetFileName(src)), false);
                Log.Write("改名：设置从 " + oldDir + " 复制到 " + Log.DataDir);
            }
        }
        catch (Exception ex) { Log.Write("改名：复制设置失败：" + ex.Message); }
        try
        {
            using (RegistryKey k = Registry.CurrentUser.OpenSubKey(HostContext.RunKey, true))
            {
                if (k != null && k.GetValue(PreviewName) != null)
                {
                    k.DeleteValue(PreviewName, false);
                    k.SetValue(HostContext.RunName, "\"" + Application.ExecutablePath + "\" --autostart");
                    Log.Write("改名：开机自启的启动项 " + PreviewName + " 换成 " + HostContext.RunName);
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
        try { Directory.CreateDirectory(Log.DataDir); File.WriteAllText(path, DateTime.UtcNow.Ticks.ToString()); } catch { /* 时间戳标记写不了不影响启动 */ }
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
