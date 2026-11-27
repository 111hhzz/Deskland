using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Text;

// 主题清单的 IO 层：刷新时扫描 prototype/themes/。
// 数据来自 themes/_products.json（宿主持有的授权表：id / status / product + 顺序）
// 与 themes/<id>/theme.json（主题自描述）。组装逻辑在 ThemeScan.cs（纯函数，可单测）。
// 没有构建期生成物：设置页的清单由 init / themes 消息下发。
static class Themes
{
    static string dir;
    static List<Dictionary<string, object>> cache;

    /// <summary>当前清单（带缓存）；刷新主题时调用 Invalidate 后重新扫描。</summary>
    public static List<Dictionary<string, object>> List(string pageDir)
    {
        if (cache != null && dir == pageDir) return cache;
        // 清单与 /u/ 镜像强绑定：扫描前先同步（新增 / 删除 / 改动都会反映）
        UserThemes.SyncMirrors(pageDir);
        cache = Scan(pageDir);
        dir = pageDir;
        return cache;
    }

    public static void Invalidate()
    {
        cache = null;
        dir = null;
    }

    static List<Dictionary<string, object>> Scan(string pageDir)
    {
        var themesDir = Path.Combine(pageDir, "themes");
        var products = new List<Dictionary<string, object>>();
        try
        {
            var root = Json.Parse(File.ReadAllText(Path.Combine(themesDir, "_products.json"), Encoding.UTF8)) as Dictionary<string, object>;
            object arr;
            if (root != null && root.TryGetValue("themes", out arr) && arr is IEnumerable)
                foreach (var o in (IEnumerable)arr)
                {
                    var d = o as Dictionary<string, object>;
                    if (d != null) products.Add(d);
                }
        }
        catch (Exception ex) { Log.Write("读取 _products.json 失败：" + ex.Message); }

        var manifests = new Dictionary<string, Dictionary<string, object>>();
        foreach (var id in RegisteredIds(products))
        {
            var p = Path.Combine(themesDir, id, "theme.json");
            if (!File.Exists(p)) continue;
            try
            {
                var t = Json.Parse(File.ReadAllText(p, Encoding.UTF8)) as Dictionary<string, object>;
                if (t != null) manifests[id] = t;
            }
            catch (Exception ex) { Log.Write("theme.json 解析失败：" + id + " " + ex.Message); }
        }

        var list = ThemeScan.Build(products, manifests,
            delegate (string page) { return File.Exists(Path.Combine(pageDir, page)); },
            delegate (string msg) { Log.Write(msg); });

        // 授权表是唯一入口：未登记的目录只提示，不进清单（否则主题可自我授权）。
        try
        {
            foreach (var d in Directory.GetDirectories(themesDir))
            {
                var id = Path.GetFileName(d);
                if (id.StartsWith("_")) continue;
                if (!HasProduct(products, id))
                    Log.Write("主题目录未登记进 _products.json，已忽略：" + id);
            }
        }
        catch (Exception ex) { Log.Write("扫描 themes 目录失败：" + ex.Message); }

        // 用户导入主题合并进清单（product 固定 user；撞名跳过）
        var existing = new HashSet<string>();
        foreach (var t in list) existing.Add((string)t["id"]);
        try
        {
            list.AddRange(UserThemes.Scan(existing));
        }
        catch (Exception ex) { Log.Write("合并用户主题失败：" + ex.Message); }
        return list;
    }

    static List<string> RegisteredIds(List<Dictionary<string, object>> products)
    {
        var ids = new List<string>();
        if (products == null) return ids;
        foreach (var p in products)
        {
            var id = p != null && p.ContainsKey("id") ? p["id"] as string : null;
            if (!string.IsNullOrEmpty(id)) ids.Add(id);
        }
        return ids;
    }

    static bool HasProduct(List<Dictionary<string, object>> products, string id)
    {
        if (products == null) return false;
        foreach (var p in products)
        {
            var pid = p != null && p.ContainsKey("id") ? p["id"] as string : null;
            if (pid == id) return true;
        }
        return false;
    }

    static Dictionary<string, object> Find(string pageDir, string id)
    {
        if (id == null) return null;
        foreach (var t in List(pageDir))
            if ((string)t["id"] == id && (string)t["status"] == "ready") return t;
        return null;
    }

    public static string PageFor(string pageDir, string id)
    {
        var theme = Find(pageDir, id);
        return theme == null ? null : theme["page"] as string;
    }

    public static string ProductFor(string pageDir, string id)
    {
        var theme = Find(pageDir, id);
        object product;
        return theme != null && theme.TryGetValue("product", out product) ? product as string : null;
    }

    public static bool Allowed(string pageDir, string id, Func<string, bool> owns)
    {
        if (PageFor(pageDir, id) == null) return false;
        string product = ProductFor(pageDir, id);
        if (product == "free" || product == "user") return true;   // 用户导入主题无需授权
        return product != null && owns != null && owns(product);
    }
}
