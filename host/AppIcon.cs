using System;
using System.Drawing;
using System.IO;

// 托盘和设置窗口共用 Deskland 图标；构建脚本会把图标复制到程序目录。
static class AppIcon
{
    public static Icon Create()
    {
        return new Icon(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "DesklandPlus.ico"));
    }
}

// 设置窗口：普通的桌面窗口，里面用 WebView2 显示 prototype/pages/settings.html
// 虚拟域：默认 deskland.test（非 .local 的保留域），可用 DESKLAND_VIRTUAL_HOST 覆盖。
// 历史坑：曾用 app.local；.local 是 mDNS 保留后缀，WebView2 顶层导航提交前会等一次名字解析超时（约 2s）。
static class VirtualHost
{
    public static string Name() =>
        Environment.GetEnvironmentVariable("DESKLAND_VIRTUAL_HOST") is string h && h.Length > 0 ? h : "deskland.test";
}
