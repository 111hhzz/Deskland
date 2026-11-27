using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;

// 用户导入主题（M1b）：%LOCALAPPDATA%\DesklandPlus\user-themes\<id>\。
//
// 与内置主题的边界：
//   - 授权：product 固定 "user"（包内任何 product/status/page 声明一律忽略，不能自我授权）；
//   - page 合成 "pages/engine.html"（壁纸统一走引擎页，媒体类型由 theme.json 的 engine 字段决定）；
//   - 资源访问：pageDir/u 以目录联接到本目录（net48 WebView2 无按路径的响应 API，见 EnsureLink），
//     页面统一 /u/<id>/<file>；不暴露真实文件系统路径（URL 里只有 id 与文件名）。
static class UserThemes
{
    static readonly Regex IdOk = new Regex("^[a-z0-9][a-z0-9-]{0,63}$", RegexOptions.Compiled);

    public static string Root { get { return Path.Combine(InstallProfile.DataDir, "user-themes"); } }

    /** id 目录名合法性：宿主导入生成（kind-hash8），同时防手改目录穿越 */
    public static bool IsValidId(string id)
    {
        return !string.IsNullOrEmpty(id) && IdOk.IsMatch(id);
    }

    /// <summary>扫描用户主题并合并进清单；与内置撞名的条目跳过（自动改名在导入侧解决）。</summary>
    public static List<Dictionary<string, object>> Scan(HashSet<string> existingIds)
    {
        var list = new List<Dictionary<string, object>>();
        try
        {
            if (!Directory.Exists(Root)) return list;
            foreach (var d in Directory.GetDirectories(Root))
            {
                var id = Path.GetFileName(d);
                if (!IsValidId(id)) { Log.Write("用户主题目录名非法，已忽略：" + id); continue; }
                if (existingIds != null && existingIds.Contains(id)) { Log.Write("用户主题与内置主题撞名，已忽略：" + id); continue; }
                var p = Path.Combine(d, "theme.json");
                if (!File.Exists(p)) { Log.Write("用户主题缺 theme.json，已忽略：" + id); continue; }
                try
                {
                    var t = Json.Parse(File.ReadAllText(p, Encoding.UTF8)) as Dictionary<string, object>;
                    var dict = t == null ? null : ThemeScan.ParseUserTheme(id, t);
                    if (dict != null) list.Add(dict);
                    else Log.Write("用户主题缺 name/thumb，已忽略：" + id);
                }
                catch (Exception ex) { Log.Write("用户主题 theme.json 解析失败：" + id + " " + ex.Message); }
            }
        }
        catch (Exception ex) { Log.Write("扫描 user-themes 失败：" + ex.Message); }
        return list;
    }

    /* ---- /u/<id>/<file> 资源可达性 ----
   WebView2 虚拟域映射是「主机 → 文件夹」粒度，实测对目录联接（junction）不提供服务；
   net48 版 SDK 又没有 CreateWebResponse 这类自建响应 API。因此采用镜像目录：
   pageDir/u/<id>/ ← 硬链接（同卷零额外空间；跨卷回退复制）→ 用户主题主拷贝
   （%LOCALAPPDATA%\DesklandPlus\user-themes\<id>\）。镜像由 SyncMirrors 维护，
   随清单扫描同步；升级重装丢失 pageDir 也无损（主拷贝在数据目录，可重建）。 */

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CreateHardLinkW(string lpFileName, string lpExistingFileName, IntPtr lpSecurityAttributes);

    /// <summary>同步镜像：把用户主题（含 assets 子目录）以硬链接复制进 pageDir/u/&lt;id&gt;/（幂等）。</summary>
    public static void SyncMirrors(string pageDir)
    {
        try
        {
            if (!Directory.Exists(Root)) return;
            var mirror = Path.Combine(pageDir, "u");
            Directory.CreateDirectory(mirror);
            var keep = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var d in Directory.GetDirectories(Root))
            {
                var id = Path.GetFileName(d);
                if (!IsValidId(id)) continue;
                keep.Add(id);
                MirrorTree(d, Path.Combine(mirror, id));
            }
            foreach (var d in Directory.GetDirectories(mirror))
                if (!keep.Contains(Path.GetFileName(d))) Directory.Delete(d, true);
        }
        catch (Exception ex) { Log.Write("同步用户主题镜像失败：" + ex.Message); }
    }

    static void MirrorTree(string srcDir, string dstDir)
    {
        Directory.CreateDirectory(dstDir);
        foreach (var f in Directory.GetFiles(srcDir)) MirrorFile(f, Path.Combine(dstDir, Path.GetFileName(f)));
        foreach (var sub in Directory.GetDirectories(srcDir)) MirrorTree(sub, Path.Combine(dstDir, Path.GetFileName(sub)));
    }

    static void MirrorFile(string src, string dst)
    {
        var si = new FileInfo(src);
        var di = new FileInfo(dst);
        if (di.Exists && di.Length == si.Length && Math.Abs((di.LastWriteTimeUtc - si.LastWriteTimeUtc).TotalSeconds) < 2) return;
        if (di.Exists) di.Delete();
        if (!CreateHardLinkW(dst, src, IntPtr.Zero))
        {
            // 跨卷 / 硬链接不可用：回退复制（镜像仍是派生物，可重建）
            File.Copy(src, dst, false);
        }
    }

    /** id 是否为用户目录下的主题（防误删内置：内置在 pageDir，不在本根下） */
    public static bool IsUserTheme(string id)
    {
        return IsValidId(id) && Directory.Exists(Path.Combine(Root, id));
    }

    /* ---- 导入 / 删除（M1c/M1d） ---- */

    public const long MaxMediaBytes = 50L * 1024 * 1024; // 单文件上限（行业区间内，见计划文档 §7）

    static readonly string[] ImageExt = { ".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif" };
    static readonly string[] VideoExt = { ".mp4", ".webm" };

    public class ImportResult
    {
        public string Id;
        public string Error;   // 空 = 成功
    }

    /// <summary>导入入口：.dlp / .zip 走主题包安装，其余按媒体文件导入。</summary>
    public static ImportResult ImportFile(string srcPath, string pageDir)
    {
        var ext = Path.GetExtension(srcPath).ToLowerInvariant();
        if (ext == ".dlp" || ext == ".zip") return ThemePackage.Install(srcPath, pageDir);
        return ImportMedia(srcPath);
    }

    /// <summary>把一个媒体文件导入成用户主题（复制到 user-themes/id/ 并生成 theme.json）。</summary>
    public static ImportResult ImportMedia(string srcPath)
    {
        var r = new ImportResult();
        try
        {
            var fi = new FileInfo(srcPath);
            if (!fi.Exists) { r.Error = "missing"; return r; }
            if (fi.Length > MaxMediaBytes) { r.Error = "too_large"; return r; }
            var ext = fi.Extension.ToLowerInvariant();
            bool isImage = Array.IndexOf(ImageExt, ext) >= 0;
            bool isVideo = Array.IndexOf(VideoExt, ext) >= 0;
            if (!isImage && !isVideo) { r.Error = "bad_ext"; return r; }

            byte[] head = new byte[Math.Min(4096, fi.Length)];
            using (var s = fi.OpenRead()) s.Read(head, 0, head.Length);
            if (!SniffOk(head, isImage)) { r.Error = "sniff_mismatch"; return r; }

            string id = NewId(isImage ? "img" : "vid", head, fi.Name);
            var dir = Path.Combine(Root, id);
            if (Directory.Exists(dir))
            {
                // 同一文件重复导入：目录已存在即视为同一 id（内容哈希相同），直接复用
                var existingJson = Path.Combine(dir, "theme.json");
                if (File.Exists(existingJson)) { r.Id = id; return r; }
                Directory.Delete(dir, true);
            }
            Directory.CreateDirectory(dir);
            var dst = Path.Combine(dir, SanitizeFileName(fi.Name));
            using (var from = fi.OpenRead())
            using (var to = new FileStream(dst, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                from.CopyTo(to);

            string json = BuildManifest(id, fi.Name, "/u/" + id + "/" + SanitizeFileName(fi.Name), isImage ? "image" : "video");
            File.WriteAllText(Path.Combine(dir, "theme.json"), json, new UTF8Encoding(false));
            r.Id = id;
            Log.Write("导入媒体主题：" + id + " <- " + srcPath);
        }
        catch (Exception ex) { r.Error = "io"; Log.Write("导入媒体失败：" + srcPath + " " + ex.Message); }
        return r;
    }

    /// <summary>删除用户主题目录（仅允许删本根下的合法 id；顺带清 settings.json 里的参数）。</summary>
    public static bool Delete(string id)
    {
        if (!IsValidId(id)) return false;
        var dir = Path.GetFullPath(Path.Combine(Root, id));
        var rootFull = Path.GetFullPath(Root) + Path.DirectorySeparatorChar;
        if (!dir.StartsWith(rootFull, StringComparison.OrdinalIgnoreCase) || !Directory.Exists(dir)) return false;
        try
        {
            Directory.Delete(dir, true);
            Log.Write("删除用户主题：" + id);
            return true;
        }
        catch (Exception ex) { Log.Write("删除用户主题失败：" + id + " " + ex.Message); return false; }
    }

    static string NewId(string kind, byte[] head, string name)
    {
        using (var sha = System.Security.Cryptography.SHA256.Create())
        {
            var bytes = new List<byte>(head);
            bytes.AddRange(Encoding.UTF8.GetBytes(name));
            var h = sha.ComputeHash(bytes.ToArray());
            var hex = BitConverter.ToString(h).Replace("-", "").ToLowerInvariant();
            return kind + "-" + hex.Substring(0, 8);
        }
    }

    static string SanitizeFileName(string name)
    {
        foreach (var c in Path.GetInvalidFileNameChars())
            name = name.Replace(c, '_');
        return name;
    }

    // 头部嗅探：不只信扩展名（最小集：PNG/JPEG/GIF/WebP/AVIF/MP4/WebM）
    static bool SniffOk(byte[] b, bool isImage)
    {
        if (b == null || b.Length < 4) return false;
        if (isImage)
        {
            if (b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47) return true; // PNG
            if (b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF) return true;               // JPEG
            if (b[0] == 0x47 && b[1] == 0x49 && b[2] == 0x46) return true;               // GIF
            if (b[0] == 0x52 && b[1] == 0x49 && b[2] == 0x46 && b[3] == 0x46) return true; // RIFF(WebP)
            if (b.Length >= 12 && b[4] == 0x66 && b[5] == 0x74 && b[6] == 0x79 && b[7] == 0x70) return true; // ftyp(AVIF/MP4 系)
            return false;
        }
        if (b[4] == 0x66 && b[5] == 0x74 && b[6] == 0x79 && b[7] == 0x70) return true; // MP4
        if (b[0] == 0x1A && b[1] == 0x45 && b[2] == 0xDF && b[3] == 0xA3) return true; // WebM(EBML)
        return false;
    }

    // 生成的 theme.json：与前端 scenes/media/schema.ts 的参数声明保持同一 schema（单一约定见计划文档 §5.1）
    static string BuildManifest(string id, string fileName, string url, string engine)
    {
        string name = Path.GetFileNameWithoutExtension(fileName);
        string thumb = "url(" + url + ") center / cover no-repeat, linear-gradient(135deg, #223 0%, #445 100%)";
        string groups;
        if (engine == "image")
            groups = "[{\"name\":\"媒体\",\"params\":["
                + "{\"key\":\"fit\",\"label\":\"填充方式\",\"hint\":\"铺满屏幕（裁切）或完整显示（留边）\",\"options\":[\"cover\",\"contain\"],\"default\":0},"
                + "{\"key\":\"veil\",\"label\":\"暗色遮罩\",\"hint\":\"压暗背景以保证图标与面板可读\",\"min\":0,\"max\":0.8,\"step\":0.01,\"default\":0}"
                + "]}]";
        else
            groups = "[{\"name\":\"媒体\",\"params\":["
                + "{\"key\":\"fit\",\"label\":\"填充方式\",\"hint\":\"铺满屏幕（裁切）或完整显示（留边）\",\"options\":[\"cover\",\"contain\"],\"default\":0},"
                + "{\"key\":\"veil\",\"label\":\"暗色遮罩\",\"hint\":\"压暗背景以保证图标与面板可读\",\"min\":0,\"max\":0.8,\"step\":0.01,\"default\":0},"
                + "{\"key\":\"speed\",\"label\":\"播放速度\",\"hint\":\"倍速播放\",\"min\":0.25,\"max\":2,\"step\":0.05,\"default\":1},"
                + "{\"key\":\"muted\",\"label\":\"静音\",\"hint\":\"关闭后可播放视频原声\",\"type\":\"bool\",\"default\":true},"
                + "{\"key\":\"loop\",\"label\":\"循环\",\"hint\":\"播放结束后从头开始\",\"type\":\"bool\",\"default\":true}"
                + "]}]";
        return "{\"id\":\"" + id + "\",\"name\":\"" + Json.Stringify(name).Trim('"') + "\",\"desc\":\"导入的媒体\","
            + "\"page\":\"pages/engine.html\",\"engine\":\"" + engine + "\",\"mediaSrc\":\"" + url + "\","
            + "\"thumb\":\"" + thumb + "\",\"groups\":" + groups + "}";
    }
}
