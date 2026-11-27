using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;

// 「标准主题包」（.dlp）的纯校验逻辑（无 IO，可单测）：
// entry 名净化、量级/类型/嵌套校验、manifest 规范化（合成 page、忽略 product/status、id 引用改写）。
// IO 包装（zip 打开 / 落盘）在 ThemePackage.cs。
static class ThemePackageCore
{
    public const long MaxPackageBytes = 32L * 1024 * 1024;
    public const long MaxTotalBytes = 64L * 1024 * 1024;
    public const int MaxEntries = 32;

    static readonly string[] AllowedExt = { ".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".mp4", ".webm", ".woff2", ".json" };
    static readonly string[] Engines = { "image", "video", "meadow", "sky", "beach", "aurora", "orb" };

    /// <summary>entry 名 fail-closed 净化：反斜杠归一；拒绝对路径（含前导分隔符）/ 盘符 / `..` / ADS。</summary>
    public static bool TrySafeEntryName(string fullName, out string name)
    {
        name = null;
        if (string.IsNullOrEmpty(fullName)) return false;
        var s = fullName.Replace('\\', '/');
        if (s.StartsWith("/") || s.Contains(":") || s.Split('/').Any(seg => seg == "..")) return false;
        name = s.TrimStart('/');
        return name.Length > 0;
    }

    /// <summary>
    /// 整包校验（任一不符返回错误码，fail-closed）：条目数 / 扩展名白名单 / 嵌套压缩包 / 解压总量。
    /// entries = (净化后的名字, 解压长度)。返回 null 表示通过。
    /// </summary>
    public static string Validate(IReadOnlyList<KeyValuePair<string, long>> entries, long packageBytes)
    {
        if (packageBytes > MaxPackageBytes) return "pkg_too_large";
        if (entries.Count > MaxEntries) return "pkg_entries";
        long total = 0;
        foreach (var kv in entries)
        {
            string lower = kv.Key.ToLowerInvariant();
            if (lower.EndsWith(".zip") || lower.EndsWith(".dlp")) return "nested_zip";
            var ext = Path.GetExtension(lower);
            if (ext != ".json" && Array.IndexOf(AllowedExt, ext) < 0) return "asset_type";
            total += kv.Value;
        }
        if (total > MaxTotalBytes) return "pkg_total";
        return null;
    }

    /// <summary>manifest 必填字段 / 引擎白名单校验；返回 null 或错误码。</summary>
    public static string ValidateManifest(Dictionary<string, object> t)
    {
        string id = t != null && t.ContainsKey("id") ? t["id"] as string : null;
        string name = t != null && t.ContainsKey("name") ? t["name"] as string : null;
        string engine = t != null && t.ContainsKey("engine") ? t["engine"] as string : null;
        if (!UserThemeIdOk(id) || string.IsNullOrEmpty(name) || Array.IndexOf(Engines, engine) < 0) return "bad_manifest";
        return null;
    }

    static bool UserThemeIdOk(string id)
    {
        return !string.IsNullOrEmpty(id) && Regex.IsMatch(id, "^[a-z0-9][a-z0-9-]{0,63}$");
    }

    /// <summary>
    /// 规范化 manifest（落盘前重写）：page 合成 engine.html；product/status 一律不加（扫描层固定 user）；
    /// thumb / mediaSrc 里的 /u/&lt;旧 id&gt;/ 改写为新 id。
    /// </summary>
    public static Dictionary<string, object> NormalizeManifest(Dictionary<string, object> t, string newId)
    {
        string thumb = t.ContainsKey("thumb") ? t["thumb"] as string : "";
        if (string.IsNullOrEmpty(thumb)) thumb = "linear-gradient(135deg, #223 0%, #445 100%)";
        var norm = new Dictionary<string, object>
        {
            { "id", newId },
            { "name", t["name"] },
            { "desc", t.ContainsKey("desc") && t["desc"] is string ? t["desc"] as string : "" },
            { "page", "pages/engine.html" },
            { "engine", t["engine"] },
            { "thumb", RewriteResourceId(thumb, newId) },
            { "mediaSrc", t.ContainsKey("mediaSrc") ? RewriteResourceId(t["mediaSrc"] as string ?? "", newId) : null },
            { "groups", ThemeScan.ConvertGroups(t.ContainsKey("groups") ? t["groups"] : null) },
        };
        if (t.ContainsKey("tokens")) norm["tokens"] = t["tokens"];
        return norm;
    }

    static string RewriteResourceId(string text, string newId)
    {
        // 导入主题只能引用自己的资源：manifest 里出现的 /u/<任意旧 id>/ 统一改写
        return Regex.Replace(text ?? "", @"/u/[a-z0-9][a-z0-9-]*/", "/u/" + newId + "/");
    }
}
