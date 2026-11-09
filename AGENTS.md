# Deskland 开源体验版开发指南

- 用中文与项目负责人沟通。
- 本仓库包含基础宿主、共用界面与框架、沙滩和草地两个免费主题；其他主题只保留带锁的名称、简介和缩略图，不包含页面、参数、脚本或其他实现代码。
- 界面只保留简体中文和英文，不跟随主程序增加其他语言。
- 不提供账号登录、购买恢复或自动检查更新功能，不接入授权服务、官网更新清单或商店更新接口。
- 保持 `themes.json`、主题参数默认值和中英文文案一致；锁定主题没有 `page` 和 `groups`，点击只打开购买说明，不能切换当前壁纸。
- 修改主题后检查图标移动、预览、暂停和分享；所有画布按实际像素与小数显示尺寸绘制。
- 壁纸常驻后台，以核显 30fps 为目标。静态绘图进入缓存，小物体使用局部图层，不在全屏着色器中逐个计算大量物体。
- `prototype/thumbs/` 是人工设计的缩略图，未经要求不要重新生成或覆盖。
- 主程序：`powershell -ExecutionPolicy Bypass -File host\build.ps1`；产物 `host/bin/Deskland.exe`。
- 浏览器预览：`node prototype\serve.mjs`，访问 `http://localhost:5178/settings.html`。
- Windows 宿主：`host/DesktopHost.cs`；改主题 HTML/JS 不需要重新编译宿主，托盘“重新载入”即可。
- 产品显示名为 `Deskland Preview`；程序读写 `%LOCALAPPDATA%\DesklandPreview`，安装到 `Programs\Deskland Preview`，启动项和运行实例标识也与开发版分开，不要改回共用身份。
- 不提交 `host/bin/`、`host/lib/`、个人数据、凭证或本机路径。
- 发布或修改商标相关内容前须获得项目负责人的明确指示。
- 许可见 `LICENSE`，名称和图标的说明见 `TRADEMARKS.md`。
- 2026-11-06：已发布 GitHub Release `v0.1.2`，包含 Windows x64 安装包、对应源码 ZIP、SHA256 和文件清单；README 提供最新 Release 下载入口。仓库已公开，安装包未签名。
- 2026-11-07：本地0.1.3同步启动与缩略图修复：壁纸不抢占前台并排除自身、不可见及 cloaked 窗口，沙滩在暂停与首次图标消息相邻到达时仍完成地形；设置页按版本刷新缓存，13张缩略图以内嵌 data URI 和真实 `<img>` 显示，容器 `width:100%`。真实 Preview 宿主验证13图均解码且宽约211px、高112px，暂停注入后沙滩完成、恢复后帧数增长。安装包43个文件且不含马尔代夫源码，SHA256 `e253cad56f1ea0ee2fb9d13ebe8a44f7dbe7232a506ba752cbe54c939c17bf44`；GitHub Release `v0.1.3` 已发布安装包、对应源码ZIP、SHA256和43文件清单，远端资产哈希核对一致，`releases/latest` 已指向0.1.3。缓存 NSIS ZIP 校验失败，构建复用正式版仓库已验证的 NSIS 3.13 编译器。
