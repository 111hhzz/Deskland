# Deskland 二次开发 · 交接文档

> 本仓库是 GitHub 原项目 `BLEZZ0102/Deskland` 的本地二次修改版。
> 截至 2026-11-10，已上云：远程 `origin` = `https://github.com/111hhzz/Deskland.git`，远端分支 `main`，本地分支 `master` 跟踪推送。
> 本文档只记录现状、验证结果和待办；下一轮以用户最新请求为准，不要把历史待办当成自动执行指令。

## 1. 环境 / 取码说明

- 原始仓库 git 协议（https 克隆）在本机被网络拦截，源码通过 `codeload.github.com` 的 `main` 分支 tarball 取得；现远程已是本仓库 `111hhzz/Deskland`。
- WebView2 编译依赖：运行 `host/build.ps1` 时若 `host/lib/` 缺少程序集，脚本会自动从 nuget 下载 SDK（`microsoft.web.webview2`，版本见脚本内 `version` 变量）。运行期还需系统已装 **Microsoft Edge WebView2 Runtime**（本机已装 `154.0.4258.37`）。
- 编译工具：Windows 自带 .NET Framework C# 编译器（`build.ps1` 用 `csc.exe`，C# 5 语法）。
- 网络：GitHub 需经本地代理 `127.0.0.1:7890` 才能访问（已写入本仓库 git config，未改全局）。SourceForge 的二进制下载经此代理会被拦成 HTML，故安装包构建需用**系统已装的 NSIS**（`C:\Program Files (x86)\NSIS\makensis.exe`，v3.13）。

## 2. Git 提交分布（细粒度，便于回退）

| 标签 | commit | 内容 |
|------|--------|------|
| `deskland-baseline` | `33ef171` | 原仓库 `main` 纯净基线（无我的改动） |
| `feat-icon-event-hook` | `b6e9fef` | 图标位置变化改为独立 `SetWinEventHook`（EVENT_OBJECT_LOCATIONCHANGE）事件驱动 + 80ms 去抖，原 400ms 轮询作为降级兜底保留 |
| `feat-sky-theme` | `aa676dd` | 新增"天空"主题（free/ready），复用草地云朵引擎，蓝空渐变 + 白天/傍晚/晚上 |
| `feat-clickthrough` | `31f9b96` | 鼠标穿透开关（C# 层 + 托盘勾选项），默认关闭 |
| （无 tag） | `c8cd8cb` | 添加 `HANDOFF.md` 和里程碑标签，便于安全回退 |
| （无 tag） | `861ec4d` | 静态设置预览 + 移除分享链路 + 只读桌面点击涟漪 + 宿主内存瘦身 |
| （无 tag） | `bd55fe9` | 主题切换淡入 + 修复 sky 背景（meadow 绿 → 天空蓝）+ AGENTS.md 更新 |
| （无 tag） | `813ca53` | 发布脚本：portable / source ZIP + GitHub release 创建与上传 |
| （无 tag） | `001b21b` | 发布脚本：上传 NSIS Setup.exe，PAT 改从环境变量 / `.gh_token` 读取 |
| （无 tag） | `182814d` | 设置窗口白闪/拖影修复：主题同色背景（BackColor + DefaultBackgroundColor + html 透明） |
| （无 tag） | `d37a4c5` | 设置窗口拖动时冻结 WebView2 布局（ResizeBegin/End + is-dragging）——**用户反馈观感问题，已在下一提交返工** |
| （无 tag） | `3289a78` | 拖动观感返工：取消尺寸冻结，拖动全程 WebView2 平滑跟随；松手 220ms 落定微动效——**用户反馈拉伸 + 错位，已在下一提交返工** |
| （无 tag） | `8119543` | 拖动性能返工：尺寸冻结恢复 + GPU 合成层 `transform:scale` + 180ms 落定过渡——**用户反馈仍拉伸/错位/抽动，已在下一提交回退** |
| （无 tag） | *(本次)* | 拖动逻辑整体回退到 magpie 式原生行为：删掉全部自定义拖拽/缩放/落定代码，`SettingsForm` 不再订阅 `ResizeBegin/Resize/ResizeEnd`，WebView2 保持 `Dock=Fill` 由系统模态循环处理移动与缩放，页面侧零特殊处理 |

**当前 HEAD**：`8119543` + *(本次)* 回退改动（本地领先远端 `main` 两个提交）。`v0.1.3` tag 已推送。`host/bin/`、`host/lib/`、`dist/` 已被 `.gitignore` 忽略；`.gh_token`（PAT，勿提交/外传）也已 gitignore。

## 3. 回退 / 恢复（防误改误删）

```powershell
git tag                       # 看标签
git show feat-sky-theme       # 仅看某个功能改了什么
git diff deskland-baseline feat-icon-event-hook -- host/DesktopHost.cs
git restore .                 # 丢弃全部未提交改动（危险，先确认）
git reset --hard feat-icon-event-hook            # 回到某个里程碑（会丢本地改动，先 commit/stash）
git checkout -b tmp-rollback feat-clickthrough   # 更安全：新建分支回退，不动当前进度
git push origin master:main                       # 上云（用户说"同步到云端"时用）
```

原则：每个功能一个 commit + 一个 tag；大改动前先 commit 或 `git tag wip-xxx`；不要在当前分支 `reset --hard` 后强推。回退前先 `git status --short`，不要误删用户未提交改动。

## 4. 关键功能落点（当前代码）

### 4.1 图标事件监听（`feat-icon-event-hook`）
- 新增类 `DesktopIconLocator`（`host/DesktopHost.cs`，位于 `IconReader` 之后）：独立 `SetWinEventHook(0x800B,0x800B,…,0,0,0)`，类级委托字段防 GC。
- 回调 `IconEventProc` 顺序短路：`eventType!=0x800B` → `hwnd` 不匹配 → `OBJID_CURSOR(-9)` → 非 `OBJID_CLIENT(-4)` 且 `idObject>=0`；80ms 去抖 `Timer`，触发 `DesktopIconsMayHaveChanged`（`PollIcons` 订阅）。
- 启动：`TryLocate()` 成功才 `Start(lv)`；失败保留原 400ms 轮询兜底。退出 `Shutdown` / `OnHandleDestroyed` 调 `Stop()`。

### 4.2 天空主题（`feat-sky-theme`）
- 新增 `prototype/sky.html`：`meadow.html` 的图标 + 云朵 WebGL2 引擎克隆，草地填充换成蓝空渐变，云影改淡蓝灰；移除男孩/小猫与 `grassInk`。
- 时段切换 `scheme`(0/1/2)：面板分段按钮，着色器 `SKY_DAY/DUSK/NIGHT_TOP/BOT` 三套渐变。`prototype/themes.json` 中 `sky` 为 `ready`/`free`，`page:"sky.html"`。

### 4.3 鼠标穿透（`feat-clickthrough`）
- `Native` 新增 `WS_EX_TRANSPARENT=0x20` 与 `EnumChildWindows`；`WallpaperForm.SetClickThrough(bool)` 开/关 `WS_EX_TRANSPARENT`（开时先 `|= WS_EX_LAYERED`），入口/出口各打一条 `GWL_EXSTYLE` 日志。
- 语义："完全让出鼠标事件"（页面交互一并失效），非修复桌面不可点；默认关闭。托盘菜单新增"鼠标穿透（让出点击）"；i18n 加 `trayClickThrough`。

### 4.4 主题切换淡入（`bd55fe9`）
- `prototype/ripple.js` 末尾 `desklandFadeIn()`：三主题页共用，`body` 从透明用 keyframe 在 250ms 淡入（`ease-out`，`forwards`），起点颜色 = `getComputedStyle(body).backgroundColor`，双 rAF 等首帧后触发；`prefers-reduced-motion` 下直接显示。
- 修复 `sky.html` 背景：`#a6c46e`（meadow 残留绿）→ `#6fb3ea`（天空蓝）。

### 4.5 设置窗口白闪/拖影修复（`182814d`）
- `SettingsForm` 新增 `GetCurrentThemeBackgroundColor()`：读系统深浅色（注册表 `AppsUseLightTheme`），返回 `Color.White` 或 `Color.FromArgb(23,23,23)`。
- 构造器：`BackColor` 与 `web.DefaultBackgroundColor` 均设为该方法返回值（原来 `Color.White`）。
- `ThemeTitleBar()`：同步 `BackColor` + `web.DefaultBackgroundColor` + 标题栏颜色；系统切深浅色时三者一起更新。
- `settings.html`：`html { background: transparent; }`，保留 `body { background: var(--bg) }` 与 `html:not(.ready) body { visibility: hidden }`。
- **未设** `TransparencyKey`/`AllowTransparency`；**未加** `--disable-gpu-compositing`/`--force-cpu-draw`。

### 4.6 设置窗口拖动（本次回退到 magpie 式原生行为，替换 `d37a4c5` / `3289a78` / `8119543`）
**结论：任何页面侧介入都会带来人眼可见的副作用。拖动/缩放完全交给 WinForms 系统模态循环 + WebView2 `Dock=Fill`。**

历史三次尝试全部被用户否决：
- `d37a4c5`：`ResizeBegin` 切 `Dock=None` 冻结尺寸，`ResizeEnd` 一次性恢复——松手瞬间重排跳变（"抽一下"）。
- `3289a78`：取消冻结，`Dock=Fill` 全程跟随 + 220ms 落定动画——拖动中逐帧 Layout/Paint 又回来；放大时内容拉伸、拖动起步 1 帧错位。
- `8119543`：恢复尺寸冻结 + GPU 合成层 `transform:scale` 跟住窗口 + 180ms 落定过渡——内容仍被水平拉伸（用户截图确认），起步错位与松手过渡观感均未通过。

本次回退删除的代码（如需重新实现请先读 `git show 8119543` 避免踩同一坑）：
- `SettingsForm` 字段：`webSizeAtDragBegin` / `dragging` / `settlePending` / `scaleDirty` / `settleFallback`。
- `SettingsForm` 方法：`OnSettingsResizeBegin` / `OnSettingsResize` / `OnSettingsResizeEnd` / `OnDragSettleDone` / `ForceSettle` / `RunOnPage` / `OnFormClosing`（仅为停定时器）。
- `WebMessageReceived` lambda 里对 `{"t":"dragSettleDone"}` 的识别；恢复为直接 `host.OnSettingsMessage(a.TryGetWebMessageAsString())`。
- `settings.html` CSS：`html.is-dragging *:not(body)` / `body { transform-origin }` / `html.is-frozen body` / `html.is-settling body`。
- `settings.html` JS：`__desklandIsFrozen` / `__desklandBeginWindowDrag` / `__desklandUpdateDragScale` / `__desklandEndWindowDrag` / `__desklandForceSettle` / `settleTimer` / `dragScaleX/Y` / `transitionend` 监听。
- 页面 `resize` 监听恢复为无条件 `layoutPreview`。

参考实现：magpie（<https://github.com/yetone/magpie>）用 Wails 的 `--wails-draggable: drag` 触发 OS 模态拖拽循环，页面侧零特殊处理——这是当前采用的方向。

### 4.7 设置窗口拖动抖动（本次：强制 WebView2 走 window-to-visual 宿主）
**症状：** `b8b7188` 回退后窗口外框跟手，但**里面的 WebView2 内容在窗口里小幅游动**（用户两段录屏 + 明确描述）。magpie 的抖动远小于本程序——差别在宿主模式：Wails 默认走 window-to-visual，而 WinForms `WebView2` 默认走 windowed（内容在子 HWND `Chrome_WidgetWin_1` 里，拖动时子窗口与外框由两条路径合成，易错位）。

**改动（`host/DesktopHost.cs` `Main`）：** 在 `Application.EnableVisualStyles()` 之前加一行：
```csharp
Environment.SetEnvironmentVariable("COREWEBVIEW2_FORCED_HOSTING_MODE", "COREWEBVIEW2_HOSTING_MODE_WINDOW_TO_VISUAL");
```
- 必须在 `Main` 里最早设，WebView2 创建浏览器环境时读取；`SettingsForm` 与 `WallpaperForm` 共享同一进程，两边一起切。
- 已验证：设置窗口的 `Chrome_WidgetWin_1` 子 HWND 消失（只剩 `WindowsForms10` 面板 + `Chrome_WidgetWin_0` 视觉表面），说明切换生效。
- 代价：此进程内 Pointer Lock / Gamepad API 不可用（本程序不用）；壁纸窗口也切到同一宿主，需用户肉眼确认壁纸渲染正常。
- 文档：<https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/windowed-vs-visual-hosting>

**用户明确要求（记住）：** 云端推送必须用户逐次同意，默认只本地提交。前几轮多次因此被否决。

## 5. 关键文件速查

| 文件 | 职责 |
|------|------|
| `host/DesktopHost.cs` | 宿主主体：窗口挂载、WebView2 初始化、图标读取、Z 顺序、穿透开关、只读鼠标钩子、托盘、设置窗口 |
| `host/Themes.cs` | 主题清单读取 + `Allowed()` 权限判定 |
| `prototype/themes.json` | 主题清单（locked 预告 + 已解锁） |
| `prototype/sky.html` `prototype/ripple.js` | 天空主题页；共用涟漪覆盖层 + 淡入函数 |
| `prototype/settings.html` | 主题列表、参数、语言、静态缩略图预览；白闪/拖动相关 CSS |
| `prototype/meadow.html` `flat.html` | 草地 / 沙滩主题 |
| `host/build.ps1` | 构建脚本（自动补 WebView2 SDK） |
| `tools/build-portable.ps1` `build-source-zip.ps1` | 便携 ZIP / 源码 ZIP 打包 |
| `tools/build-installer.ps1` | NSIS 安装包构建（需系统 NSIS + WebView2 bootstrapper） |
| `tools/create-release.ps1` `verify-release.ps1` | 创建/上传 GitHub release（PAT 从 `GITHUB_TOKEN` 或 `.gh_token`） |

## 6. 构建与运行

```powershell
cd host
powershell -ExecutionPolicy Bypass -File build.ps1   # 产出 host/bin/Deskland.exe
host\bin\Deskland.exe --settings                      # 打开设置窗口
host\bin\Deskland.exe --autostart                     # 启动壁纸
host\bin\Deskland.exe --exit                          # 退出
```
- 单实例；设置数据在 `%LOCALAPPDATA%\DesklandPreview`。
- 改 HTML 主题页无需重编 C#；改 C# 需重跑 `build.ps1`。

## 7. 发布（已发布 v0.1.3）

- 已发布 GitHub Release `v0.1.3`：https://github.com/111hhzz/Deskland/releases/tag/v0.1.3
- 资产：`Deskland-Preview-0.1.3-win-x64-portable.zip`（12.42MB）、`Deskland-Preview-0.1.3-win-x64-Setup.exe`（26.73MB，NSIS 安装包）、`Deskland-Preview-0.1.3-source.zip`（12.64MB），各附 `.sha256`，Setup 另附 `.manifest.json`。
- 打包命令（NSIS 用系统安装的，避免 SourceForge 被拦）：
```powershell
$env:GITHUB_TOKEN = (Get-Content .gh_token -Raw).Trim()   # PAT 不写文件，从本地 gitignore 文件读
powershell -ExecutionPolicy Bypass -File tools\build-portable.ps1
powershell -ExecutionPolicy Bypass -File tools\build-source-zip.ps1
powershell -ExecutionPolicy Bypass -File tools\build-installer.ps1 -NsisCompiler "C:\Program Files (x86)\NSIS\makensis.exe" -WebView2Bootstrapper "dist\installer-tools\MicrosoftEdgeWebview2Setup.exe"
powershell -ExecutionPolicy Bypass -File tools\create-release.ps1
```
- `create-release.ps1` 幂等：已上传资产会跳过；改 `tools/version.json` 版本号后重新生成对应资产名。

## 8. 待办 / 交给下一个 AI

### 8.1 （已完成 2026-11-11）设置窗口拖动：整体回退到 magpie 式原生行为
- 见 4.6。三次返工均被用户否决，最终选择删光所有自定义拖拽代码，让系统模态循环 + `Dock=Fill` 处理拖动/缩放。
- **未做**：拖动期间 `CSSRecalculateStyle` / `Layout` / `Paint` 计数会随窗口尺寸变化逐帧发生，本方案不规避。用户已接受这一代价换取"零拉伸 / 零错位 / 零抽动"。后续若再想优化性能，需先解决拉伸和错位，不要直接重蹈 `8119543`。
- 如再收到"拖动卡顿"反馈，可考虑只在**移动**（无尺寸变化）时禁用重绘、缩放仍走 `Dock=Fill`，但需用户先确认方向再动手。

### 8.2 历史 / 可选下一步（未做）
- 把"穿透"状态持久化进 `settings.json`，重启恢复勾选。
- 从壁纸页消息 `{"t":"clickthrough","v":...}` 驱动 `SetClickThrough`。
- 继续解锁其它 locked 主题（大海/湖泊/森林…）：只有缩略图和文案、无页面实现，需以 `flat.html`/`meadow.html`/`sky.html` 为底座自研，且缺原作者美术素材。
- 壁纸 / 主题切换延迟（早期反馈，`d37a4c5` 前未量化）：需复现并量化三类路径（启动首帧、动画恢复、切换耗时），不预设根因；当前仍无耗时埋点。

## 9. 注意事项

- 本程序挂到桌面图标层之下当壁纸层，正常退出才还原；勿任务管理器强杀导致层数残留（重开一次再正常退出）。
- `DesktopIconLocator` 与 Z 顺序钩子是**两个独立** `SetWinEventHook` 实例；`DesktopClickHook` 是另一个 `WH_MOUSE_LL` 全局钩子（只观察主屏桌面根窗口左键、先放行、退出卸载），不替代 `WS_EX_TRANSPARENT` 穿透开关。
- 网络：GitHub 需代理 `127.0.0.1:7890`；若代理端口变化，需同步改 `create-release.ps1` / `verify-release.ps1` 里的硬编码地址和本仓库 git config。
- PAT：存放在 `.gh_token`（已 gitignore），勿提交、勿外传。
- 安装包未签名，Windows SmartScreen 可能提示"更多信息 → 仍要运行"。

## 10. 当前现场（下一轮接手时）

- 最后一次验证：`host/build.ps1` 编译通过（无 C# 5 告警）；`Deskland.exe` 启动正常出现 `Deskland Preview` 主窗口；`--exit` 后 `Deskland.exe` 进程清零；`rg` 扫描确认 `is-dragging` / `is-frozen` / `is-settling` / `__deskland*` / `dragSettleDone` 等所有拖动痕迹在 `host/DesktopHost.cs` 与 `prototype/settings.html` 中已清空。
- 未做：真实鼠标拖动（Win32 SendInput）截图对比。本次只删代码、恢复系统默认路径，没有新增逻辑，风险面较小。
- 当前现场：`Deskland.exe` 已正常退出；WebView2 子进程（`msedgewebview2.exe`）可能有其他程序（如 `GUI.for.Clash`）的实例，勿误杀；`%LOCALAPPDATA%\DesklandPreview\settings.json` 主题/参数用户保留，勿擅改。
- 本次改动只在本地，**未推送云端**（用户明确要求不同意就不推）。
- 当前无 `Deskland.exe`、无 `DesklandPreview` WebView2 进程；`%LOCALAPPDATA%\DesklandPreview\settings.json` 主题和参数由用户保留，勿擅改。
- 复现命令：`host/bin/Deskland.exe --settings` 打开设置，拖动标题栏/边框复现"抽动"；`--autostart` 启动壁纸；`--exit` 退出。若重新编译，先正常退出当前实例。
- 回退：如需回到 `8119543`（GPU 合成层缩放方案，用户已否决），`git revert <本次提交>`；如需回到 `182814d`（所有拖动返工之前），`git checkout 182814d -- host/DesktopHost.cs prototype/settings.html` 只还原这两处。不要整仓 `reset --hard`。
