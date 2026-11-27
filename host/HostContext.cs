using System;
using System.Diagnostics;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

// 整个程序的生命周期：托盘图标常驻；壁纸窗口没了就重新建一个
// 打开菜单的方式：托盘图标左键 / 右键、快捷键 Ctrl+Alt+H（或 --menu）
// 打开设置的方式：双击程序（没运行就先启动再打开）、双击托盘图标、菜单 → 设置…（或 --settings）
class HostContext : ApplicationContext
{
    public const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run", RunName = "DesklandPlus";
    static readonly MethodInfo ShowTrayMenu =
        typeof(NotifyIcon).GetMethod("ShowContextMenu", BindingFlags.Instance | BindingFlags.NonPublic);

    readonly string pageDir;
    readonly NotifyIcon tray;
    readonly MenuItem pauseItem, autoStartItem, settingsItem, reloadItem, exitItem, clickThroughItem;
    readonly System.Windows.Forms.Timer watch;
    readonly EventWaitHandle exitEvent, menuEvent, settingsEvent;
    readonly HotkeyWindow hotkey = new HotkeyWindow();
    readonly Queue<DateTime> restarts = new Queue<DateTime>();
    readonly DesktopPointerHook pointerHook;
    WallpaperForm form, dead;
    public WallpaperForm WallpaperForm { get { return form; } }
    SettingsForm settingsWin;
    DateTime nextStart = DateTime.MaxValue, saveDue = DateTime.MaxValue;
    bool manualPause, exiting;
    string autoStartSw;                                 // 开机自启没跑起来（只在手动打开时检查）：正在运行的安全软件名（没认出来是 ""）；没问题是 null
    string updateVersion, updateUrl, updateStatus = "", updateError = "";
    double updateProgress = -1;                         // -1 = 当前阶段没有可显示的百分比

    public HostContext(string pageDir, bool showSettings)
    {
        this.pageDir = pageDir;
        Log.Write("启动，页面目录：" + pageDir + (showSettings ? "" : "（开机自动启动）"));
        if (showSettings) autoStartSw = AutoStartCheck.Detect(IsAutoStart());
        Rename.MigratePreview();
        Settings.Load();
        I18n.Load(pageDir, Settings.Lang);
        UserThemes.EnsureLink(pageDir);   // /u/<id>/ → %LOCALAPPDATA%\DesklandPlus\user-themes（导入主题的素材通道）
        exitEvent = new EventWaitHandle(false, EventResetMode.AutoReset, Program.ExitEventName);
        menuEvent = new EventWaitHandle(false, EventResetMode.AutoReset, Program.MenuEventName);
        settingsEvent = new EventWaitHandle(false, EventResetMode.AutoReset, Program.SettingsEventName);

        // 快捷键 Ctrl+Alt+H：在鼠标位置弹出菜单
        bool hotkeyOk = hotkey.Register(Native.MOD_CONTROL | Native.MOD_ALT | Native.MOD_NOREPEAT, Keys.H);
        hotkey.Pressed += delegate { ShowMenu(); };
        Log.Write(hotkeyOk ? "快捷键 Ctrl+Alt+H 已注册" : "快捷键 Ctrl+Alt+H 注册失败（可能被其他程序占用）");

        pauseItem = new MenuItem(I18n.T("trayPause"), delegate
        {
            manualPause = !manualPause;
            pauseItem.Checked = manualPause;
            if (form != null) form.SetManualPause(manualPause);
        });
        autoStartItem = new MenuItem(I18n.T("trayAutostart"), delegate { SetAutoStart(!autoStartItem.Checked); });
        autoStartItem.Checked = IsAutoStart();
        clickThroughItem = new MenuItem(I18n.T("trayClickThrough"), delegate
        {
            bool on = !clickThroughItem.Checked;
            if (form != null) form.SetClickThrough(on);
            pointerHook.InjectPointer = !on;              // 指针注入与命中透传同一个开关：开 = 点击全归桌面
            clickThroughItem.Checked = on;
            Settings.ClickThrough = on;
            SaveSoon();                                  // 走 watch 的延迟保存
        });
        clickThroughItem.Checked = Settings.ClickThrough;   // 恢复上次勾选（默认关：保持互动模式基线）
        if (autoStartItem.Checked && AutoStartValue() != "")
        {
            try
            {
                if (CreateAutoStartShortcut())
                {
                    DeleteRunAutoStart();
                    Log.Write("开机自动启动已迁移到当前用户启动文件夹");
                }
                else if (AutoStartValue().IndexOf("--autostart") < 0)
                    using (RegistryKey k = Registry.CurrentUser.CreateSubKey(RunKey))   // 回退项缺参数时补上
                        k.SetValue(RunName, "\"" + Application.ExecutablePath + "\" --autostart");
            }
            catch (Exception ex) { Log.Write("迁移开机自动启动失败，保留原启动项：" + ex.Message); }
        }
        settingsItem = new MenuItem(I18n.T("traySettings"), delegate { OpenSettings(); });
        settingsItem.DefaultItem = true;                // 粗体：主入口

        tray = new NotifyIcon();
        tray.Icon = AppIcon.Create();
        tray.Text = "Deskland+";
        tray.ContextMenu = new ContextMenu(new[] {
            settingsItem,
            pauseItem,
            reloadItem = new MenuItem(I18n.T("trayReload"), delegate { if (form != null) form.Reload(); }),
            autoStartItem,
        clickThroughItem,
            new MenuItem("-"),
            exitItem = new MenuItem(I18n.T("trayExit"), delegate { Exit(); }),
        });
        tray.MouseUp += delegate (object s, MouseEventArgs e) { if (e.Button == MouseButtons.Left) ShowMenu(); };
        tray.DoubleClick += delegate { OpenSettings(); };   // 双击托盘图标：直接打开设置
        tray.Visible = true;
        ShowWelcomeOnce(hotkeyOk);
        pointerHook = new DesktopPointerHook { InjectPointer = !Settings.ClickThrough };

        watch = new System.Windows.Forms.Timer();
        watch.Interval = 500;
        watch.Tick += delegate { Watch(); };
        watch.Start();
        StartForm();
        if (showSettings) OpenSettings();                // 用户双击程序启动：直接打开设置
    }

    // 换了界面语言：托盘菜单的文字跟着换
    void ApplyTrayTexts()
    {
        settingsItem.Text = I18n.T("traySettings");
        pauseItem.Text = I18n.T("trayPause");
        reloadItem.Text = I18n.T("trayReload");
        autoStartItem.Text = I18n.T("trayAutostart");
        exitItem.Text = I18n.T("trayExit");
        clickThroughItem.Text = I18n.T("trayClickThrough");
    }

    // ---------------------------------------------------------------- 设置窗口
    public void OpenSettings()
    {
        if (exiting) return;
        if (settingsWin == null || settingsWin.IsDisposed)
        {
            settingsWin = new SettingsForm(pageDir, this);
            settingsWin.FormClosed += delegate { settingsWin = null; };
            Log.Write("打开设置窗口");
            TestProbe.Signal("settings_opened");
        }
        if (settingsWin.WindowState == FormWindowState.Minimized) settingsWin.WindowState = FormWindowState.Normal;
        settingsWin.Show();
        // 外部以 SW_HIDE 启动时，WinForms 的 Visible 状态可能已是 true，
        // 但原生窗口仍被隐藏；Activate / 再次 Show 不会修复，必须显式还原。
        // SW_RESTORE 同时处理隐藏和最小化，SW_SHOW 不会展开已最小化的窗口。
        Native.ShowWindow(settingsWin.Handle, Native.SW_RESTORE);
        settingsWin.Activate();
    }

    string SettingsMessage()
    {
        return Json.Stringify(Json.Obj("t", "settings", "v", Settings.For(Settings.Theme)));
    }

    string UpdateStateMessage()
    {
        return Json.Stringify(Json.Obj("t", "updateState", "version", updateVersion,
            "status", updateStatus, "progress", updateProgress, "error", updateError));
    }

    void PostUpdateState()
    {
        if (settingsWin != null) settingsWin.Post(UpdateStateMessage());
    }

    // 仅用于开发联调或非商店更新源；商店版始终使用 StoreContext，不接受网页传入地址。
    public void OfferUpdate(string version, string url)
    {
        Uri uri;
        if (string.IsNullOrWhiteSpace(version) || !Uri.TryCreate(url, UriKind.Absolute, out uri) || uri.Scheme != Uri.UriSchemeHttps)
            throw new ArgumentException("更新信息需要版本号和有效的 HTTPS 地址");
        updateVersion = version.Trim();
        updateUrl = uri.AbsoluteUri;
        updateStatus = "available";
        updateProgress = -1;
        updateError = "";
        PostUpdateState();
    }

    void SaveSoon() { saveDue = DateTime.Now.AddMilliseconds(600); }

    // 选择文件导入：原生 OpenFileDialog（宿主路径通道，无大小限制；前端只发 importPick）
    void ImportPicker()
    {
        using (var dlg = new OpenFileDialog())
        {
            dlg.Title = "导入图片或视频作为壁纸";
            dlg.Filter = "主题包|*.dlp;*.zip|图片与视频|*.png;*.jpg;*.jpeg;*.webp;*.gif;*.avif;*.mp4;*.webm|图片|*.png;*.jpg;*.jpeg;*.webp;*.gif;*.avif|视频|*.mp4;*.webm|全部文件|*.*";
            dlg.Multiselect = true;
            if (dlg.ShowDialog() != DialogResult.OK) return;
            var results = new List<UserThemes.ImportResult>();
            foreach (var path in dlg.FileNames) results.Add(UserThemes.ImportFile(path, pageDir));
            AfterImport(results);
        }
    }

    // 拖拽导入：页面把 File 读成 base64 传来（≤20MB 由前端拦截）；宿主写临时文件走同一导入逻辑
    void ImportFromPage(Dictionary<string, object> m)
    {
        string name = m.ContainsKey("name") ? m["name"] as string : null;
        string data = m.ContainsKey("data") ? m["data"] as string : null;
        if (string.IsNullOrEmpty(name) || string.IsNullOrEmpty(data)) return;
        string tmp = null;
        try
        {
            byte[] bytes = Convert.FromBase64String(data);
            if (bytes.Length > UserThemes.MaxMediaBytes) { PostImport(null, "too_large"); return; }
            tmp = Path.Combine(Path.GetTempPath(), "deskland-import-" + Guid.NewGuid().ToString("N") + Path.GetExtension(name));
            File.WriteAllBytes(tmp, bytes);
            PostImport(UserThemes.ImportFile(tmp, pageDir), null);
        }
        catch (Exception ex) { Log.Write("处理页面导入数据失败：" + ex.Message); PostImport(null, "io"); }
        finally
        {
            if (tmp != null) { try { File.Delete(tmp); } catch { /* 临时文件删不掉不影响结果 */ } }
        }
    }

    void PostImport(UserThemes.ImportResult r, string fallbackCode)
    {
        if (r == null) r = new UserThemes.ImportResult { Error = fallbackCode };
        settingsWin.Post(Json.Stringify(r.Error == null || r.Error.Length == 0
            ? Json.Obj("t", "themeImported", "id", r.Id ?? "")
            : Json.Obj("t", "themeImported", "error", r.Error)));
    }

    void AfterImport(List<UserThemes.ImportResult> results)
    {
        Themes.Invalidate();
        foreach (var r in results) PostImport(r, null);
        settingsWin.Post(Json.Stringify(Json.Obj("t", "themes", "themes", Themes.List(pageDir))));
    }

    bool DeleteUserTheme(string id)
    {
        // 只允许删用户级主题：内置主题目录在 pageDir，不在此列
        return UserThemes.IsValidId(id) && UserThemes.IsUserTheme(id) && UserThemes.Delete(id);
    }

    bool ThemeAllowed(string id)
    {
        return Themes.Allowed(pageDir, id, delegate (string product) { return false; });
    }

    // 设置页发来的消息：hello / set / reset / theme / autostart / lang / updateProgram / refreshThemes
    public void OnSettingsMessage(string s)
    {
        var m = Json.Parse(s) as Dictionary<string, object>;
        if (m == null || settingsWin == null) return;
        object t;
        m.TryGetValue("t", out t);
        switch (t as string)
        {
            case "hello":
                Rectangle scr = Screen.PrimaryScreen.Bounds;
                settingsWin.Post(Json.Stringify(Json.Obj("t", "init", "theme", Settings.Theme, "params", Settings.Params,
                    "themes", Themes.List(pageDir),
                    "screen", Json.Obj("w", scr.Width, "h", scr.Height), "autostart", IsAutoStart(),
                    "autostartWarn", autoStartSw != null, "autostartSw", autoStartSw ?? "",
                    "lang", Settings.Lang, "themeMode", Settings.ThemeMode, "langEff", I18n.Code, "langSys", I18n.Sys)));
                if (updateVersion != null) PostUpdateState();
                break;
            case "refreshThemes":                          // 设置页手动刷新：重扫主题文件夹，回一份新清单
                Themes.Invalidate();
                settingsWin.Post(Json.Stringify(Json.Obj("t", "themes", "themes", Themes.List(pageDir))));
                Log.Write("已重新扫描主题文件夹");
                break;
            case "importPick":                             // 选择文件通道：原生对话框（无大小限制），宿主直接落盘
                ImportPicker();
                break;
            case "importFile":                             // 拖拽通道：JS 传 base64（限 20MB，前端已拦）
                ImportFromPage(m);
                break;
            case "deleteTheme":
                {
                    string id = m["id"] as string;
                    if (id != null && DeleteUserTheme(id))
                    {
                        Dictionary<string, object> pd;
                        if (Settings.Params.TryGetValue(id, out pd)) { Settings.Params.Remove(id); SaveSoon(); }
                        Themes.Invalidate();
                        settingsWin.Post(Json.Stringify(Json.Obj("t", "themes", "themes", Themes.List(pageDir))));
                        settingsWin.Post(Json.Stringify(Json.Obj("t", "themeDeleted", "id", id)));
                        Log.Write("设置页请求删除用户主题：" + id);
                    }
                    break;
                }
            case "set":
                {
                    string theme = m["theme"] as string, key = m["key"] as string;
                    if (theme == null || key == null) return;
                    Settings.For(theme)[key] = m["value"];
                    if (theme == Settings.Theme && form != null)
                        form.Post(Json.Stringify(Json.Obj("t", "settings", "v", Json.Obj(key, m["value"]))));
                    SaveSoon();
                    break;
                }
            case "reset":
                {
                    string theme = m["theme"] as string;
                    if (theme == null) return;
                    Settings.Params.Remove(theme);
                    if (theme == Settings.Theme && form != null) form.Post("{\"t\":\"reset\"}");
                    SaveSoon();
                    Log.Write("恢复默认设置：" + theme);
                    break;
                }
            case "theme":
                {
                    string id = m["id"] as string;
                    if (id == null || !ThemeAllowed(id))
                    {
                        settingsWin.Post(Json.Stringify(Json.Obj("t", "themeChanged", "id", Settings.Theme)));
                        Log.Write("拒绝未授权或未知主题切换：" + (id ?? "null"));
                        return;
                    }
                    string page = Themes.PageFor(pageDir, id);
                    if (page == null || id == Settings.Theme) return;
                    Settings.Theme = id;
                    SaveSoon();
                    if (form != null) form.SwitchTheme(id);
                    Log.Write("切换主题：" + id);
                    break;
                }
            case "autostartWarnSeen":
                autoStartSw = null;
                break;
            case "lang":                                    // 换界面语言：存下来，托盘菜单跟着换，告诉设置页实际用哪种
                {
                    object v;
                    if (!m.TryGetValue("v", out v) || !(v is string)) return;
                    Settings.Lang = (string)v;
                    SaveSoon();
                    I18n.Load(pageDir, Settings.Lang);
                    ApplyTrayTexts();
                    settingsWin.Post(Json.Stringify(Json.Obj("t", "lang", "v", Settings.Lang, "eff", I18n.Code, "sys", I18n.Sys)));
                    break;
                }
            case "themeMode":                               // 设置窗口主题模式
                {
                    object v;
                    if (!m.TryGetValue("v", out v) || !(v is string)) return;
                    Settings.ThemeMode = (string)v;
                    SaveSoon();
                    settingsWin.Post(Json.Stringify(Json.Obj("t", "themeMode", "v", Settings.ThemeMode)));
                    break;
                }
            case "openWebsite":
                Process.Start("https://deskland.app/");
                break;
            case "updateProgram":
                if (updateUrl != null) Process.Start(updateUrl);
                break;
            case "autostart":
                SetAutoStart(m["v"] is bool && (bool)m["v"]);
                settingsWin.Post(Json.Stringify(Json.Obj("t", "autostart", "v", IsAutoStart())));
                break;
        }
    }

    // 在鼠标位置弹出托盘菜单（NotifyIcon 自带的弹出逻辑会处理前台窗口，菜单点别处能正常收起）
    void ShowMenu()
    {
        if (exiting) return;
        autoStartItem.Checked = IsAutoStart();
        if (ShowTrayMenu != null) ShowTrayMenu.Invoke(tray, null);
    }

    // 第一次运行时弹一条系统通知：告诉用户菜单在哪
    void ShowWelcomeOnce(bool hotkeyOk)
    {
        try
        {
            string flag = Path.Combine(Log.DataDir, "welcome.shown");
            if (File.Exists(flag)) return;
            Directory.CreateDirectory(Log.DataDir);
            tray.ShowBalloonTip(10000, I18n.T("welcomeTitle"),
                I18n.T("welcomeBody", "hotkey", hotkeyOk ? I18n.T("welcomeHotkey") : ""), ToolTipIcon.Info);
            File.WriteAllText(flag, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"));
        }
        catch (Exception ex) { Log.Write("首次提示失败：" + ex.Message); }
    }

    // 开机自动启动：优先用当前用户“启动”文件夹里的快捷方式；旧 Run 项启动时迁移。
    // 不使用需要额外权限的任务计划；快捷方式创建失败时仍保留 Run 项作为回退。
    static string AutoStartShortcutPath
    {
        get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Startup), "Deskland.lnk"); }
    }

    static object OpenAutoStartShortcut()
    {
        object shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));
        try
        {
            return shell.GetType().InvokeMember("CreateShortcut", BindingFlags.InvokeMethod,
                null, shell, new object[] { AutoStartShortcutPath });
        }
        finally { Marshal.FinalReleaseComObject(shell); }
    }

    static bool AutoStartShortcutEnabled()
    {
        if (!File.Exists(AutoStartShortcutPath)) return false;
        object link = null;
        try
        {
            link = OpenAutoStartShortcut();
            string target = link.GetType().InvokeMember("TargetPath", BindingFlags.GetProperty,
                null, link, null) as string;
            string arguments = link.GetType().InvokeMember("Arguments", BindingFlags.GetProperty,
                null, link, null) as string;
            return string.Equals(target, Application.ExecutablePath, StringComparison.OrdinalIgnoreCase)
                && arguments != null && arguments.IndexOf("--autostart", StringComparison.OrdinalIgnoreCase) >= 0;
        }
        catch { return false; }
        finally { if (link != null) Marshal.FinalReleaseComObject(link); }
    }

    static bool CreateAutoStartShortcut()
    {
        object link = null;
        try
        {
            link = OpenAutoStartShortcut();
            link.GetType().InvokeMember("TargetPath", BindingFlags.SetProperty,
                null, link, new object[] { Application.ExecutablePath });
            link.GetType().InvokeMember("Arguments", BindingFlags.SetProperty,
                null, link, new object[] { "--autostart" });
            link.GetType().InvokeMember("WorkingDirectory", BindingFlags.SetProperty,
                null, link, new object[] { Path.GetDirectoryName(Application.ExecutablePath) });
            link.GetType().InvokeMember("IconLocation", BindingFlags.SetProperty,
                null, link, new object[] { Application.ExecutablePath + ",0" });
            link.GetType().InvokeMember("Description", BindingFlags.SetProperty,
                null, link, new object[] { "Deskland" });
            link.GetType().InvokeMember("Save", BindingFlags.InvokeMethod, null, link, null);
            return File.Exists(AutoStartShortcutPath);
        }
        catch (Exception ex) { Log.Write("创建启动文件夹快捷方式失败：" + ex.Message); return false; }
        finally { if (link != null) Marshal.FinalReleaseComObject(link); }
    }

    static string AutoStartValue()
    {
        if (InstallProfile.Isolated) return "";
        using (RegistryKey k = Registry.CurrentUser.OpenSubKey(RunKey))
        {
            string v = k == null ? null : k.GetValue(RunName) as string;
            return v ?? "";
        }
    }

    static void DeleteRunAutoStart()
    {
        using (RegistryKey k = Registry.CurrentUser.OpenSubKey(RunKey, true))
            if (k != null) k.DeleteValue(RunName, false);
    }

    static bool IsAutoStart()
    {
        return AutoStartShortcutEnabled()
            || AutoStartValue().IndexOf(Application.ExecutablePath, StringComparison.OrdinalIgnoreCase) >= 0;
    }

    void SetAutoStart(bool on)
    {
        if (InstallProfile.Isolated) return;
        try
        {
            if (on)
            {
                bool shortcut = CreateAutoStartShortcut();
                if (shortcut) DeleteRunAutoStart();
                else
                    using (RegistryKey k = Registry.CurrentUser.CreateSubKey(RunKey))
                        k.SetValue(RunName, "\"" + Application.ExecutablePath + "\" --autostart");
                AutoStartCheck.MarkEnabled();
                Log.Write(shortcut ? "已开启开机自动启动（当前用户启动文件夹）" : "已开启开机自动启动（传统启动项回退）");
            }
            else
            {
                DeleteRunAutoStart();
                if (File.Exists(AutoStartShortcutPath)) File.Delete(AutoStartShortcutPath);
                Log.Write(IsAutoStart() ? "关闭开机自动启动失败，启动项仍存在" : "已关闭开机自动启动");
            }
        }
        catch (Exception ex) { Log.Write("设置开机自动启动失败：" + ex.Message); }
        autoStartItem.Checked = IsAutoStart();
    }

    void StartForm()
    {
        nextStart = DateTime.MaxValue;
        if (!ThemeAllowed(Settings.Theme)) Settings.Theme = ThemeAllowed("beach") ? "beach" : "meadow";
        string page = ThemeAllowed(Settings.Theme) ? Themes.PageFor(pageDir, Settings.Theme) : null;
        if (page == null)
        {
            Log.Write("没有可加载的已授权主题，5 秒后重试");
            nextStart = DateTime.Now.AddSeconds(5);
            return;
        }
        form = new WallpaperForm(pageDir, page, Settings.Theme, manualPause);
        form.SettingsJson = SettingsMessage;
        pointerHook.Wallpaper = form;
        pointerHook.InjectPointer = !Settings.ClickThrough;   // form 重建后对齐当前开关
        form.HandleDestroyed += OnFormGone;
        form.Show();
        form.SetClickThrough(Settings.ClickThrough);   // 恢复上次的穿透开关（handle 已建；资源管理器重建窗口后也靠这里）
    }

    void OnFormGone(object sender, EventArgs e)
    {
        var f = (WallpaperForm)sender;
        if (f != form) return;
        form = null;
        pointerHook.Wallpaper = null;
        dead = f;                                        // 稍后在计时器里释放，避免在销毁回调里重入
        if (exiting) return;
        if (f.Fatal) { Exit(); return; }

        // 1 分钟内反复被销毁：不再重试，避免和资源管理器打架
        restarts.Enqueue(DateTime.Now);
        while (restarts.Count > 0 && (DateTime.Now - restarts.Peek()).TotalSeconds > 60) restarts.Dequeue();
        if (restarts.Count > 5)
        {
            Log.Write("壁纸窗口 1 分钟内被销毁超过 5 次，停止重试");
            MessageBox.Show(I18n.T("errRebuilt") + "\n\n" + I18n.T("errSeeLog", "path", Log.FilePath), "Deskland+");
            Exit();
            return;
        }
        Log.Write("壁纸窗口被销毁（资源管理器重建了壁纸层），1 秒后重新挂载");
        nextStart = DateTime.Now.AddSeconds(1);
    }

    void Watch()
    {
        if (dead != null) { try { dead.Dispose(); } catch { /* 旧窗口销毁失败：下个 tick 再收 */ } dead = null; }
        if (exitEvent.WaitOne(0)) { Exit(); return; }
        if (menuEvent.WaitOne(0)) ShowMenu();
        if (settingsEvent.WaitOne(0)) OpenSettings();
        if (DateTime.Now >= saveDue) { saveDue = DateTime.MaxValue; Settings.Save(); }
        if (form == null && !exiting && DateTime.Now >= nextStart) StartForm();
    }

    void Exit()
    {
        if (exiting) return;
        exiting = true;
        watch.Stop();
        if (saveDue != DateTime.MaxValue) Settings.Save();
        if (settingsWin != null) { try { settingsWin.Close(); } catch { /* 设置窗关闭竞争（正在 Dispose）忽略 */ } }
        hotkey.Dispose();
        pointerHook.Stop();
        tray.Visible = false;
        if (form != null) form.Shutdown();
        Log.Write("退出");
        ExitThread();
    }
}
