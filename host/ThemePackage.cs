using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;

// 「标准主题包」（.dlp，实质 zip）的解压与安装（M2）。IO 包装：zip 打开、逐条目校验、落盘到
// user-themes/<id>/。校验规则（纯逻辑）在 ThemePackageCore，安全不变量与其单测见该文件与
// ThemePackageTests.cs；规范全文见 docs/specs/2026-11-27-theme-extension-and-import-plan.md §5.2。
static class ThemePackage
{
    public static UserThemes.ImportResult Install(string zipPath, string pageDir)
    {
        var r = new UserThemes.ImportResult();
        try
        {
            var fi = new FileInfo(zipPath);
            if (!fi.Exists) { r.Error = "missing"; return r; }
            if (fi.Length > ThemePackageCore.MaxPackageBytes) { r.Error = "pkg_too_large"; return r; }

            using (var zip = ZipFile.OpenRead(zipPath))
            {
                var raw = zip.Entries.ToList();

                // 第一遍：entry 名净化 + 收集 (名字, 长度)，整包硬约束一次判定（fail-closed）
                var entries = new List<KeyValuePair<string, long>>(raw.Count);
                foreach (var e in raw)
                {
                    string name;
                    if (!ThemePackageCore.TrySafeEntryName(e.FullName, out name)) { r.Error = "entry_path"; return r; }
                    entries.Add(new KeyValuePair<string, long>(name, e.Length));
                }
                string verdict = ThemePackageCore.Validate(entries, fi.Length);
                if (verdict != null) { r.Error = verdict; return r; }

                // manifest（zip 根必须直接含 theme.json）
                var manifestEntry = raw.FirstOrDefault(e => SafeName(e.FullName) == "theme.json");
                if (manifestEntry == null) { r.Error = "no_manifest"; return r; }
                string jsonText;
                using (var s = manifestEntry.Open())
                using (var ms = new MemoryStream())
                {
                    s.CopyTo(ms);
                    jsonText = Encoding.UTF8.GetString(ms.ToArray());
                }
                // 外部打包工具（含 PowerShell Set-Content）常写入带 BOM 的 JSON；解析前剥掉
                if (!string.IsNullOrEmpty(jsonText) && jsonText[0] == '\uFEFF') jsonText = jsonText.Substring(1);
                var t = Json.Parse(jsonText) as Dictionary<string, object>;
                if (t == null) { r.Error = "bad_json"; return r; }
                verdict = ThemePackageCore.ValidateManifest(t);
                if (verdict != null) { r.Error = verdict; return r; }

                // id 冲突（内置或已存在）→ 自动改名 <id>-<hash8>，manifest 内 /u/<旧 id>/ 同步改写
                string id = UniqueId((string)t["id"], fi, pageDir);
                var norm = ThemePackageCore.NormalizeManifest(t, id);

                var dir = Path.Combine(UserThemes.Root, id);
                if (Directory.Exists(dir)) Directory.Delete(dir, true);
                Directory.CreateDirectory(dir);

                foreach (var e in raw)
                {
                    string entryName = SafeName(e.FullName);
                    if (entryName == "theme.json") continue; // 用规范化结果重写
                    string full = Path.GetFullPath(Path.Combine(dir, entryName));
                    if (!full.StartsWith(Path.GetFullPath(dir) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                    { r.Error = "entry_path"; return r; }
                    var sub = Path.GetDirectoryName(full);
                    if (!string.IsNullOrEmpty(sub)) Directory.CreateDirectory(sub);
                    using (var s = e.Open())
                    using (var to = new FileStream(full, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                        s.CopyTo(to);
                }

                File.WriteAllText(Path.Combine(dir, "theme.json"), Json.Stringify(norm), new UTF8Encoding(false));
                r.Id = id;
                Log.Write("安装主题包：" + id + " <- " + zipPath);
            }
        }
        catch (Exception ex) { r.Error = "io"; Log.Write("安装主题包失败：" + zipPath + " " + ex.Message); }
        return r;
    }

    static string SafeName(string fullName)
    {
        string name;
        return ThemePackageCore.TrySafeEntryName(fullName, out name) ? name : null;
    }

    static string UniqueId(string id, FileInfo pkg, string pageDir)
    {
        bool taken = false;
        try
        {
            // 与内置 / 已有用户主题撞名：Themes.List 里已有该 id 即视为冲突
            var list = Themes.List(pageDir);
            taken = list != null && list.Any(x => (string)x["id"] == id);
        }
        catch { taken = false; }
        if (!taken && !Directory.Exists(Path.Combine(UserThemes.Root, id))) return id;
        byte[] head = new byte[Math.Min(4096, pkg.Length)];
        using (var s = pkg.OpenRead()) s.Read(head, 0, head.Length);
        string hex;
        using (var sha = System.Security.Cryptography.SHA256.Create())
            hex = BitConverter.ToString(sha.ComputeHash(head)).Replace("-", "").ToLowerInvariant();
        return id + "-" + hex.Substring(0, 8);
    }
}
