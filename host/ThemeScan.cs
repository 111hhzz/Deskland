using System;
using System.Collections;
using System.Collections.Generic;

// 本文件同时被测试项目（net8.0，nullable enable）链接，这里按 .NET Framework 的非空语义写。
// 可空警告只在测试项目里屏蔽：宿主用旧 csc，不认 CS 前缀的 analyzer 警告号（会报 CS1692/CS1691）。
#if NET8_0
#pragma warning disable CS8600, CS8601, CS8602, CS8603, CS8604, CS8625
#endif

// 主题清单组装（纯逻辑：无 IO、无日志依赖）。
// 输入 = 授权表（id / status / product + 顺序）、已解析的 theme.json 字典、页面存在性校验；
// 输出 = 与设置页 ThemeDef 同构的主题字典列表。Themes.cs 负责读盘与解析后调这里，单测直接调这里。
static class ThemeScan
{
    /// <summary>把一份 theme.json 转成设置页要的主题字典；缺字段 / 页面不存在返回 null。</summary>
    static Dictionary<string, object> ToTheme(string id, Dictionary<string, object> t, Func<string, bool> pageExists, Action<string> log)
    {
        string name = t.ContainsKey("name") ? t["name"] as string : null;
        string desc = t.ContainsKey("desc") ? t["desc"] as string : null;
        string page = t.ContainsKey("page") ? t["page"] as string : null;
        string thumb = t.ContainsKey("thumb") ? t["thumb"] as string : null;
        if (string.IsNullOrEmpty(name) || string.IsNullOrEmpty(page) || string.IsNullOrEmpty(thumb))
        {
            if (log != null) log("theme.json 缺 name/page/thumb，已跳过：" + id);
            return null;
        }
        if (!pageExists(page))
        {
            if (log != null) log("page 指向的页面不存在，已跳过：" + id + " -> " + page);
            return null;
        }
        var dict = new Dictionary<string, object>
        {
            { "id", id },
            { "name", name },
            { "desc", desc ?? "" },
            { "page", page },
            { "thumb", thumb },
        };
        object adaptive;
        bool adaptiveOn;
        if (t.TryGetValue("adaptive", out adaptive) && TryBool(adaptive, out adaptiveOn) && adaptiveOn) dict["adaptive"] = true;
        object thumbSource;
        if (t.TryGetValue("thumbSource", out thumbSource) && thumbSource is string) dict["thumbSource"] = thumbSource;
        dict["groups"] = ConvertGroups(t.ContainsKey("groups") ? t["groups"] : null);
        return dict;
    }

    /// <summary>参数组白名单拷贝：只保留设置页 ThemeParam 认识的字段，其余（含 tokens）不外发。</summary>
    public static List<Dictionary<string, object>> ConvertGroups(object raw)
    {
        var list = new List<Dictionary<string, object>>();
        if (!(raw is IEnumerable)) return list;
        foreach (var g in (IEnumerable)raw)
        {
            var gd = g as Dictionary<string, object>;
            if (gd == null) continue;
            var item = new Dictionary<string, object>();
            string gname = gd.ContainsKey("name") ? gd["name"] as string : null;
            if (gname != null) item["name"] = gname;
            var ps = new List<Dictionary<string, object>>();
            object rawParams;
            if (gd.TryGetValue("params", out rawParams) && rawParams is IEnumerable)
            {
                foreach (var pv in (IEnumerable)rawParams)
                {
                    var pd = pv as Dictionary<string, object>;
                    if (pd == null) continue;
                    var p = new Dictionary<string, object>();
                    foreach (var kv in pd)
                    {
                        string k = kv.Key;
                        object v = kv.Value;
                        if (k == "key" || k == "label" || k == "hint" || k == "unit" || k == "format")
                        {
                            var s = v as string;
                            if (s != null) p[k] = s;
                        }
                        else if (k == "min" || k == "max" || k == "step" || k == "default")
                        {
                            double d;
                            if (TryNumber(v, out d)) p[k] = d;
                        }
                        else if (k == "options")
                        {
                            var opts = new List<string>();
                            if (v is IEnumerable)
                                foreach (var o in (IEnumerable)v)
                                {
                                    var s = o as string;
                                    if (s != null) opts.Add(s);
                                }
                            if (opts.Count > 0) p[k] = opts;
                        }
                        else if (k == "soon")
                        {
                            bool soon;
                            if (TryBool(v, out soon) && soon) p[k] = true;
                        }
                    }
                    if (p.ContainsKey("key")) ps.Add(p);
                }
            }
            item["params"] = ps;
            list.Add(item);
        }
        return list;
    }

    // theme.json 是外部数据（含第三方主题）：非真非假的值一律按 false 处理，不能抛异常拖垮整份清单
    static bool TryBool(object v, out bool b)
    {
        if (v is bool) { b = (bool)v; return true; }
        if (v is int) { b = (int)v != 0; return true; }
        if (v is long) { b = (long)v != 0; return true; }
        if (v is double) { b = (double)v != 0; return true; }
        if (v is decimal) { b = (decimal)v != 0; return true; }
        var s = v as string;
        if (s != null)
        {
            if (bool.TryParse(s, out b)) return true;
            if (s == "1") { b = true; return true; }
            if (s == "0") { b = false; return true; }
        }
        b = false;
        return false;
    }

    static bool TryNumber(object v, out double d)
    {
        if (v is double) { d = (double)v; return true; }
        if (v is int) { d = (int)v; return true; }
        if (v is long) { d = (long)v; return true; }
        if (v is decimal) { d = (double)(decimal)v; return true; }
        return double.TryParse(Convert.ToString(v), out d);
    }

    /// <summary>
    /// 按授权表顺序产出主题清单。授权表是唯一入口：不在表里的目录不进清单（否则主题可自我授权）。
    /// 缺 theme.json、缺字段、页面不存在的条目跳过并记日志。
    /// </summary>
    public static List<Dictionary<string, object>> Build(
        List<Dictionary<string, object>> products,
        Dictionary<string, Dictionary<string, object>> manifests,
        Func<string, bool> pageExists,
        Action<string> log)
    {
        var list = new List<Dictionary<string, object>>();
        if (products == null) return list;
        foreach (var p in products)
        {
            string id = p != null && p.ContainsKey("id") ? p["id"] as string : null;
            if (string.IsNullOrEmpty(id))
            {
                if (log != null) log("_products.json 有条目缺 id，已跳过");
                continue;
            }
            Dictionary<string, object> t;
            if (manifests == null || !manifests.TryGetValue(id, out t) || t == null)
            {
                if (log != null) log("主题缺 theme.json，已跳过：" + id);
                continue;
            }
            // 单个主题解析失败只跳过它，不能拖垮整份清单（否则一个坏 JSON 让所有主题消失）
            try
            {
                var dict = ToTheme(id, t, pageExists, log);
                if (dict == null) continue;
                object status, product;
                dict["status"] = p.TryGetValue("status", out status) && status is string ? status : "locked";
                dict["product"] = p.TryGetValue("product", out product) && product is string ? product : null;
                list.Add(dict);
            }
            catch (Exception ex)
            {
                if (log != null) log("theme.json 字段无法解析，已跳过：" + id + " " + ex.Message);
            }
        }
        return list;
    }
}
