using System;
using System.Diagnostics;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

class SettingsForm : Form
{
    readonly WebView2 web;
    readonly HostContext host;
    readonly string pageDir;

    public SettingsForm(string pageDir, HostContext host)
    {
        this.pageDir = pageDir;
        this.host = host;
        Text = "Deskland+";
        AccessibleName = "Deskland+";
        ShowIcon = true;
        Icon = AppIcon.Create();
        StartPosition = FormStartPosition.CenterScreen;
        float s = Native.GetDpiForSystem() / 96f;       // 进程按物理像素工作，窗口尺寸要自己按缩放比例算
        ClientSize = new Size((int)(1120 * s), (int)(800 * s));     // 左边主题排三列，右边上面预览、下面参数
        MinimumSize = new Size((int)(940 * s), (int)(680 * s));
        BackColor = SystemTheme.BackgroundColor();       // 跟随系统深浅色，加载/拖动期间避免白色拖影

        web = new WebView2();
        web.Dock = DockStyle.Fill;
        web.DefaultBackgroundColor = BackColor;
        web.CreationProperties = new CoreWebView2CreationProperties();
        // 设置窗口用独立的用户数据目录（→ 独立浏览器进程），以便单独切换宿主模式：
        // 壁纸走默认 windowed（子 HWND 接收鼠标，穿透/图标/任务栏都靠这条路径）；
        // 设置窗口切到 window-to-visual（无子 HWND，内容与外框同源合成，拖动跟手）。
        web.CreationProperties.UserDataFolder = Path.Combine(Log.DataDir, "WebView2-Settings");
        Controls.Add(web);

    }

    // 标题栏（系统原生那条）刷成和页面底色一样：settings.html 跟随系统深浅色（浅 #ffffff / 深 #171717），
    // 标题栏也按系统深浅色取同一个颜色。DWMWA_CAPTION_COLOR / 深色模式要 Win11，旧系统调用失败就保持系统原样
    void ThemeTitleBar()
    {
        Color bg = SystemTheme.BackgroundColor();
        BackColor = bg;                    // 窗体底色与页面/标题栏同色，拖动重绘间隙不露白
        web.DefaultBackgroundColor = bg;   // WebView2 控制器底色同色，加载期不闪白
        bool light = bg == Color.White;
        int dark = light ? 0 : 1;
        int color = light ? 0x00FFFFFF : 0x00171717;      // COLORREF 是 0x00BBGGRR
        Native.DwmSetWindowAttribute(Handle, 20, ref dark, 4);    // DWMWA_USE_IMMERSIVE_DARK_MODE：标题文字、按钮跟着深浅色
        Native.DwmSetWindowAttribute(Handle, 35, ref color, 4);   // DWMWA_CAPTION_COLOR
    }
    protected override void OnHandleCreated(EventArgs e) { base.OnHandleCreated(e); ThemeTitleBar(); }
    protected override void WndProc(ref Message m)
    {
        if (m.Msg == 0x001A /* WM_SETTINGCHANGE */) ThemeTitleBar();   // 系统切深浅色时标题栏跟着换
        base.WndProc(ref m);
    }

    protected override async void OnShown(EventArgs e)
    {
        base.OnShown(e);
        TestProbe.Signal("settings_shown");
        // 等壁纸窗口的 WebView2 初始化完成再设置环境变量：
        // COREWEBVIEW2_FORCED_HOSTING_MODE 是进程级环境变量，如果与壁纸窗口的
        // EnsureCoreWebView2Async 并发执行，会污染壁纸窗口的宿主模式。
        // 用 await Task.Delay 轮询等待，避免阻塞 UI 线程。
        if (host != null)
        {
            var sw = System.Diagnostics.Stopwatch.StartNew();
            while (sw.ElapsedMilliseconds < 10000)
            {
                if (host.WallpaperForm != null && host.WallpaperForm.IsWebView2Ready) break;
                await Task.Delay(50);
            }
            TestProbe.Signal("settings_wallpaper_wait", new { ms = sw.ElapsedMilliseconds });
        }
        try
        {
            // 仅对本次 EnsureCoreWebView2Async 生效：创建完立刻清掉，不影响壁纸的 WebView2。
            // 代价：设置窗口内 Pointer Lock / Gamepad 不可用（本程序不用）。
            Environment.SetEnvironmentVariable("COREWEBVIEW2_FORCED_HOSTING_MODE", "COREWEBVIEW2_HOSTING_MODE_WINDOW_TO_VISUAL");
            // 测试模式：给设置窗口的浏览器进程单独开 CDP 端口（9223），与壁纸（9222）分离。
            // 用 CoreWebView2Environment 显式创建环境，再传给 EnsureCoreWebView2Async：
            // 同进程内两个 WebView2 的环境变量会互相覆盖，必须用独立环境。
            CoreWebView2Environment env = null;
            if (TestProbe.Enabled)
            {
                var options = new CoreWebView2EnvironmentOptions();
                options.AdditionalBrowserArguments = "--remote-debugging-port=9223";
                env = await CoreWebView2Environment.CreateAsync(null, web.CreationProperties.UserDataFolder, options);
            }
            await web.EnsureCoreWebView2Async(env);
            if (IsDisposed) return;
            TestProbe.Signal("settings_webview2_ready");
            var core = web.CoreWebView2;
            SystemTheme.ApplyTo(core);                 // 同步系统深浅色，设置页的 prefers-color-scheme 才能生效
            try { core.MemoryUsageTargetLevel = CoreWebView2MemoryUsageTargetLevel.Low; }
            catch (Exception ex) { Log.Write("设置窗口内存级别调整失败：" + ex.Message); }
            core.SetVirtualHostNameToFolderMapping(VirtualHost.Name(), pageDir, CoreWebView2HostResourceAccessKind.Allow);
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.WebMessageReceived += delegate (object s, CoreWebView2WebMessageReceivedEventArgs a)
            {
                string msg = null;
                try { msg = a.TryGetWebMessageAsString(); } catch { /* 消息取不出来按无消息处理 */ }
                try
                {
                    // 测试信号：页面 ready（DOMContentLoaded 后首帧）
                    var parsed = Json.Parse(msg) as Dictionary<string, object>;
                    object t;
                    if (parsed != null && parsed.TryGetValue("t", out t) && (t as string) == "ready")
                        TestProbe.Signal("settings_ready");
                    host.OnSettingsMessage(msg);
                }
                catch (Exception ex) { Log.Write("处理设置消息失败：" + ex.Message); }
            };
            string settingsUrl = "https://" + VirtualHost.Name() + "/pages/settings.html?v=" + Uri.EscapeDataString(Application.ProductVersion) + "&ui=2";
            Log.Write("设置页面：" + settingsUrl);
            core.Navigate(settingsUrl);
            TestProbe.Signal("settings_navigated");
        }
        catch (Exception ex)
        {
            Log.Write("设置窗口启动失败：" + ex);
            MessageBox.Show(I18n.T("errSettings", "msg", ex.Message), "Deskland+");
            Close();
        }
        finally
        {
            Environment.SetEnvironmentVariable("COREWEBVIEW2_FORCED_HOSTING_MODE", null);
        }
    }

    public void Post(string json)
    {
        // 设置窗口是临时窗口：它的 WebView2 失效就先不发（关掉重开即恢复），别把异常抛回壁纸的轮询
        try { if (!IsDisposed && web.CoreWebView2 != null) web.CoreWebView2.PostWebMessageAsString(json); }
        catch { /* WebView2 已失效：设置窗关掉重开即恢复 */ }
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        try { web.Dispose(); } catch { /* WebView2 可能已被释放 */ }
        base.OnFormClosed(e);
    }
}
