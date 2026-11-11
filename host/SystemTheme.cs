using System;
using System.Drawing;
using Microsoft.Win32;
using Microsoft.Web.WebView2.Core;

// 系统深浅色：窗体底色、标题栏、WebView2 的 prefers-color-scheme 都跟着它走。
// 设置页 settings.html 用 @media (prefers-color-scheme: dark) 响应，宿主必须把
// CoreWebView2Profile.PreferredColorScheme 同步到系统，否则深色媒体查询不触发。
static class SystemTheme
{
    const string PersonalizeKey = @"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";

    // true = 浅色；读不到注册表时按浅色处理（与设置页浅色默认一致）。
    public static bool IsLight()
    {
        try
        {
            object v = Registry.GetValue(PersonalizeKey, "AppsUseLightTheme", 1);
            return v == null || Convert.ToInt32(v) != 0;
        }
        catch (Exception ex) { Log.Write("读取系统深浅色失败：" + ex.Message); return true; }
    }

    // 窗口底色：浅 #ffffff / 深 #171717（与设置页 body 背景一致）。
    public static Color BackgroundColor()
    {
        return IsLight() ? Color.White : Color.FromArgb(23, 23, 23);
    }

    // 把系统深浅色同步给 WebView2。默认 Auto 在部分系统/浏览器组合下不跟随系统，
    // 显式设置 Light / Dark 才能让页面里的 prefers-color-scheme 稳定生效。
    public static void ApplyTo(CoreWebView2 core)
    {
        if (core == null) return;
        try
        {
            core.Profile.PreferredColorScheme = IsLight()
                ? CoreWebView2PreferredColorScheme.Light
                : CoreWebView2PreferredColorScheme.Dark;
        }
        catch (Exception ex) { Log.Write("设置 WebView2 深浅色失败：" + ex.Message); }
    }
}
