using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

// 用户设置：当前主题 + 每个主题的参数（只存用户改过的，没改过的用主题默认值）
// 保存在 %LOCALAPPDATA%\Deskland\settings.json
static class Settings
{
    static readonly string FilePath = Path.Combine(Log.DataDir, "settings.json");
    public static string Theme = "beach";
    public static string Lang = "auto";                // 界面语言："auto"（跟随系统）或 I18n.Supported 里的一种
    public static string ThemeMode = "auto";            // 设置窗口主题模式：auto / light / dark
    public static Dictionary<string, Dictionary<string, object>> Params = new Dictionary<string, Dictionary<string, object>>();
    public static bool ClickThrough = false;            // 鼠标穿透（托盘勾选状态，重启后恢复）
    public static bool PureDesktop = false;             // 纯净显示桌面：隐藏任务栏 + 桌面图标（重启后恢复）

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
            if (root.TryGetValue("themeMode", out v) && v is string) ThemeMode = (string)v;
            if (root.TryGetValue("clickThrough", out v) && v is bool) ClickThrough = (bool)v;
            if (root.TryGetValue("pureDesktop", out v) && v is bool) PureDesktop = (bool)v;
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
            File.WriteAllText(FilePath, Json.Stringify(Json.Obj("version", 1, "theme", Theme, "lang", Lang, "themeMode", ThemeMode, "clickThrough", ClickThrough, "pureDesktop", PureDesktop, "params", Params)), new UTF8Encoding(false));
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

// 界面语言（2026-10-14）：文字表在 prototype/i18n/<语言>.json——ui 给设置页、host 给托盘菜单和提示框、themes 给主题名和参数（简体中文的主题文字就是 theme.json 本身）。
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
