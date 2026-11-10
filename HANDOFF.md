# Deskland 二次开发 · 交接文档

> 本仓库是 GitHub 原项目 `BLEZZ0102/Deskland` 的本地二次修改版。
> 截至 2026-11-10，仅存在 **本地 git**，尚未推送远程（用户要求"上云"时才推）。
> 本文档只记录现状、验证结果和待办；下一轮以用户最新请求为准，不要把历史待办当成自动执行指令。

## 1. 环境 / 取码说明

- 原始仓库 git 协议（https 克隆）在本机被网络拦截，源码通过 `codeload.github.com` 的 `main` 分支 tarball 取得。
- WebView2 编译依赖：运行 `host/build.ps1` 时若 `host/lib/` 缺少程序集，脚本会自动从 nuget 下载 SDK（`microsoft.web.webview2`，版本见脚本内 `version` 变量）。运行期还需系统已装 **Microsoft Edge WebView2 Runtime**（本机已装 `154.0.4258.37`）。
- 编译工具：Windows 自带 .NET Framework C# 编译器（`build.ps1` 用 `csc.exe`，C# 5 语法）。

## 2. Git 提交分布（细粒度，便于回退）

| 标签 | commit | 内容 |
|------|--------|------|
| `deskland-baseline` | `33ef171` | 原仓库 `main` 纯净基线（无我的改动） |
| `feat-icon-event-hook` | `b6e9fef` | 图标位置变化改为独立 `SetWinEventHook`（EVENT_OBJECT_LOCATIONCHANGE）事件驱动 + 80ms 去抖，原 400ms 轮询作为降级兜底保留 |
| `feat-sky-theme` | `aa676dd` | 新增"天空"主题（free/ready），复用草地云朵引擎，蓝空渐变 + 白天/傍晚/晚上 |
| `feat-clickthrough` | `31f9b96` | 鼠标穿透开关（C# 层 + 托盘勾选项），默认关闭 |
| （无 tag） | `c8cd8cb` | 添加 `HANDOFF.md` 和里程碑标签，便于安全回退 |
| （无 tag） | `861ec4d` | 静态设置预览 + 移除分享链路 + 只读桌面点击涟漪 + 宿主内存瘦身，仅本地提交、未推送 |

**当前状态**：本次实现已作为本地 commit `861ec4d` 提交；交接文档修订是紧随其后的另一个本地 commit，可用 `git log -2 --oneline` 查看哈希。两个 commit 均未打 tag、未推送，`git remote -v` 为空。`host/bin/`、`host/lib/` 已被 `.gitignore` 忽略。提交范围和验证详见第 9 节。

## 3. 回退 / 恢复（防误改误删）

```powershell
# 看标签
git tag
# 仅看某个功能改了什么
git show feat-sky-theme
git diff deskland-baseline feat-icon-event-hook -- host/DesktopHost.cs
# 误改后丢弃全部未提交改动（危险，先确认）
git checkout -- .        # 或 git restore .
# 彻底回到某个里程碑（会移动 HEAD，本地改动会丢——先 commit 或 stash）
git reset --hard feat-icon-event-hook
# 更安全的做法：新建分支回退，不动当前进度
git checkout -b tmp-rollback feat-clickthrough
```

原则：**每个功能一个 commit + 一个 tag**；大改动前先 `git commit` 或 `git tag wip-xxx` 再动手；不要在当前分支上 `reset --hard` 到别人的历史后再强推。当前两个新 commit 均未打 tag；回退前先确认 `git status --short`，不要用 `git checkout -- .` / `git reset --hard` 丢弃后续未提交改动。

## 4. 三大改动落点

### 4.1 图标事件监听（`feat-icon-event-hook`）
- 新增类 `DesktopIconLocator`（`host/DesktopHost.cs`，位于 `IconReader` 之后）：独立 `SetWinEventHook(0x800B,0x800B,…,0,0,0)`，类级委托字段防 GC。
- 回调 `IconEventProc` 顺序短路：`eventType!=0x800B` → `hwnd` 不匹配 → `OBJID_CURSOR(-9)` → 非 `OBJID_CLIENT(-4)` 且 `idObject>=0`；通过走 80ms 去抖 `Timer`，触发 `DesktopIconsMayHaveChanged`（`PollIcons` 订阅）。
- 启动：`TryLocate()` 成功才 `Start(lv)`；失败则保留原 400ms 轮询兜底。退出 `Shutdown` / `OnHandleDestroyed` 调 `Stop()`。
- **未动**：原 Z 顺序钩子 `0x8000–0x8004` 及其回调。

### 4.2 天空主题（`feat-sky-theme`）
- 新增 `prototype/sky.html`：`meadow.html` 的图标 + 云朵 WebGL2 引擎克隆，草地填充换成"顶→地平线"蓝空渐变，云影改成淡蓝灰；移除男孩/小猫人物与 `grassInk`。
- 时段切换 `scheme`(0/1/2)：面板新增分段按钮，着色器 `SKY_DAY/DUSK/NIGHT_TOP/BOT` 三套渐变。
- `prototype/themes.json` 中 `sky` 由 `locked` 改为 `ready`/`free`，并补 `page:"sky.html"` 与参数组（sigma/cover/flow/scheme）。

### 4.3 鼠标穿透（`feat-clickthrough`）
- `Native` 新增 `WS_EX_TRANSPARENT=0x20` 与 `EnumChildWindows`。
- `WallpaperForm.SetClickThrough(bool)`：`ON` → `|= WS_EX_LAYERED` → `|= WS_EX_TRANSPARENT` → `SetWindowPos(…SWP_FRAMECHANGED)`；`OFF` 只清 `TRANSPARENT`，保留 `LAYERED`/alpha。入口/出口各打一条日志（十六进制 `GWL_EXSTYLE`），`ON` 后枚举直接子窗口（仅打印）。
- 语义："完全让出鼠标事件"（页面交互一并失效），**非**修复桌面不可点；默认关闭。
- 托盘菜单新增默认不勾选的"鼠标穿透（让出点击）"项；i18n 加 `trayClickThrough`（zh-CN/en）。
- 未改 `settings.html`、未加热键、未动 `EnsureZOrder`、未改 WebView2 子窗口样式。

## 5. 关键文件速查

| 文件 | 职责 |
|------|------|
| `host/DesktopHost.cs` | 宿主主体：窗口挂载、WebView2 初始化、图标读取、Z 顺序、穿透开关、只读鼠标钩子、托盘 |
| `host/Themes.cs` | 主题清单读取 + `Allowed()` 权限判定（`status==ready` 且 `product` 命中） |
| `prototype/themes.json` | 主题清单（含 locked 预告与已解锁主题） |
| `prototype/sky.html` `prototype/ripple.js` | 天空主题页面；共用 DOM/CSS 桌面点击涟漪覆盖层 |
| `prototype/settings.html` | 主题列表、参数、语言、静态缩略图预览；不再加载实时预览 iframe |
| `prototype/meadow.html` `flat.html` | 草地 / 沙滩主题，云朵引擎源 |
| `host/build.ps1` | 构建脚本（自动补 WebView2 SDK） |
| `prototype/i18n/*.json` | 界面文案（`host` 段） |

## 6. 构建与运行

```powershell
cd host
powershell -ExecutionPolicy Bypass -File build.ps1
# 产出 host/bin/Deskland.exe
```
- 直接双击 `host/bin/Deskland.exe` 运行（单实例；托盘退出或 `Deskland.exe --exit`）。
- 首次运行会弹托盘提示；设置数据在 `%LOCALAPPDATA%\DesklandPreview`，与商店版隔离。

## 7. 待办 / 交给下一个 AI

### 7.1 优先：壁纸 / 壁纸切换延迟（用户 2026-11-10 反馈，本轮未处理）

- 现象：用户观察到"壁纸和壁纸切换会有一些延迟"，可能涵盖壁纸本体动画 / 互动响应与主题切换过程；本轮没有改动延迟相关逻辑，也没有量化耗时，因此不要先认定根因或缩小问题范围。
- 先复现并量化三类路径：A. 壁纸启动 / 重载后首帧、动画恢复；B. 壁纸本体动画 / 涟漪等互动响应；C. 设置页点击主题到新壁纸可见。分别记录冷启动、热切换、三个主题（`flat.html` / `meadow.html` / `sky.html`）的耗时和帧率，以 `861ec4d` 为基线做 A/B 对比。
- 优先排查候选，不预设结论：`CoreWebView2.Navigate` 整页重载、WebView2 renderer/GPU 初始化、WebGL2 shader 编译与 `buildNoiseTex()` / 陆地场重建、`ready` → `settings` / `icons` → 首次 `commit()`、全屏 DPR 画布、前台暂停/继续、设置页 `MemoryUsageTargetLevel.Low` 是否影响共享 browser process。日志目前只有"切换主题"时间，没有耗时埋点；如需埋点，保持低频、可移除，不记录点击坐标或按键。
- 硬约束：闲置 `Deskland.exe` Private Bytes 连续 10 分钟峰值仍须 `< 50 * 1024 * 1024` 字节（`msedgewebview2` 子进程不计）；不得恢复设置页实时预览 iframe 或第二套 WebGL2 预览；不得移除只读点击钩子、`ripple` 消息、穿透开关与 `GWL_EXSTYLE` 日志；保持 C# 5 语法、无新依赖、正常退出无 WebView2 孤儿进程。
- 验收建议：由用户确认主观流畅度；用相同的主题/参数/图标布局测量首帧和切换耗时，至少覆盖三主题切换、参数同步、图标自适应、暂停/继续、桌面点击涟漪、穿透开关前后点击不被阻断。优化若影响壁纸动画流畅度，先撤回设置页 `Low` 级别单独验证，不要顺手重构其他逻辑。

### 7.2 历史 / 可选下一步（未做）

- 把"穿透"状态持久化进 `settings.json`，重启恢复勾选。
- 从壁纸页消息 `{"t":"clickthrough","v":...}` 驱动 `SetClickThrough`（本次按要求未改 `settings.html`）。
- 继续解锁其它 locked 主题（大海/湖泊/森林…）：它们**只有缩略图和文案、没有页面实现**，需以 `flat.html`/`meadow.html`/`sky.html` 为底座自研，且缺少原作者的美术素材。
- 上云：用户确认后 `git remote add` + `git push`（本机当前无 remote、未推送）。

## 8. 注意事项

- 本程序挂到桌面图标层之下当壁纸层，正常退出才还原；勿在任务管理器强杀导致层数残留（强杀后可重开一次再正常退出）。
- `DesktopIconLocator` 与 Z 顺序钩子是 **两个独立** `SetWinEventHook` 实例，委托各自持有，互不干扰。
- 第 9 节新增的 `DesktopClickHook` 是另一个 `WH_MOUSE_LL` 全局钩子：只观察主屏桌面根窗口左键、先 `CallNextHookEx` 放行、退出时 `UnhookWindowsHookEx`；它不替代 `WS_EX_TRANSPARENT` 穿透开关。
- 改动 HTML 主题页后无需重编 C#；改 C# 需重跑 `build.ps1`。

## 9. 2026-11-10 本地提交实现与实测交接

### 9.1 代码状态（实现位于本地 commit `861ec4d`，无 tag / 无远程）

- `SetClickThrough` 的两条 `GWL_EXSTYLE` 日志经 `Log.Write` 无条件写入 `%LOCALAPPDATA%\DesklandPreview\host.log`，没有日志级别或控制台 sink；本次未调级别，也未改穿透逻辑。
- `prototype/settings.html`：实时预览 iframe 改为 `DESKLAND_THUMBS` 静态 `<img>`；保留 `state.screen` / `layoutPreview()` 控制框比例；移除分享按钮、弹窗、消息分支与预览转发，保留主题/参数/语言/自启/帮助/购买提示/刷新种子；`data-i18n="themePreview"` 及中英文 key 已加，旧的分享 i18n key 和 `prototype/share.js` 文件保留不删。
- `host/DesktopHost.cs`：设置页 URL 和壁纸页 URL 固定加 `ui=2`；设置页 WebView2 单独设 `MemoryUsageTargetLevel.Low`，`OnFormClosed` 释放 `web`；移除分享/截图/录制、预览图标转发与进度消息，`WebMessageReceived` 只处理 `ready`；`PollIcons` 到壁纸页和 `SettingsJson` 保留。
- 新增只读 `DesktopClickHook`：`WH_MOUSE_LL` → 主屏左键 → `WindowFromPoint` / `GetAncestor(GA_ROOT)` → 根类仅 `Progman` / `WorkerW` → 发 `{"t":"ripple","x":主屏相对物理像素,"y":主屏相对物理像素}`；任何路径都放行点击，不记录坐标、不装键盘钩子，正常 `Exit()` 卸载。
- 新增 `prototype/ripple.js`：三主题共用 DOM/CSS 涟漪，最多 6 个元素，`animationend` 自动移除；`flat.html` / `meadow.html` / `sky.html` 仅把 `share.js` 引用换成 `ripple.js`，现有 WebGL `addRipple` / shader 未改。`host/README.md` 和 `DesktopHost.cs` 顶部注释已同步。
- 实现提交 `861ec4d` 包含 9 个文件：`host/DesktopHost.cs`、`host/README.md`、`prototype/settings.html`、`prototype/flat.html`、`prototype/meadow.html`、`prototype/sky.html`、`prototype/i18n/*.json`、`prototype/ripple.js`；`HANDOFF.md` 由紧随其后的文档 commit 单独提交。用 `git log -2 --oneline` 可查到两个 commit；两者都仅存在于本地。

### 9.2 已完成的验证

- `powershell -ExecutionPolicy Bypass -File host/build.ps1` 编译通过；C# 使用 .NET Framework `csc.exe` / C# 5；Node 语法检查、JSON 解析、DOM id / 静态资源引用、`git diff --check` 通过。
- 闲置宿主内存：连续 10 分钟、299 次采样，`Deskland.exe` Private Bytes 最小 `30,027,776`、峰值 `30,535,680` 字节，严格小于 `52,428,800`（50 MiB）；`msedgewebview2` 子进程和设置窗口打开时不计入此口径。
- 设置页用 `...settings.html?v=0.1.3.0&ui=2` 加载；打开只新增一个 renderer，关闭后恢复；`Deskland.exe --exit` 后 `DesklandPreview` WebView2 进程数为 0。
- 穿透开关实测日志：开时操作前 `0x00010000`、操作后 `0x00090020`，并枚举 5 个子窗口的 `GWL_EXSTYLE`；关时 `0x00090020` → `0x00090000`。桌面空白点击根类为 `WorkerW`，点击正常放行；日志无点击坐标或按键记录。
- 日志显示曾发生主题切换（10:47 beach / meadow、11:11 sky），但**未做视觉 / 帧率 / 首帧耗时逐项验收**；延迟问题以第 7.1 节为准。

### 9.3 下一轮接手时的现场

- 最后一次日志显示 `2026-11-10 11:12:50 退出`；当前无 `Deskland.exe`、无 `DesklandPreview` WebView2 进程。`%LOCALAPPDATA%\DesklandPreview\settings.json` 当前 `theme=sky`、`lang=auto`，主题种子和参数由用户操作保留，不要为了复现延迟擅自重置。
- 复现命令：从仓库根目录运行 `host/bin/Deskland.exe --autostart` 启动壁纸，`host/bin/Deskland.exe --settings` 打开设置；退出用托盘或 `host/bin/Deskland.exe --exit`。若重新编译，先正常退出当前实例。
- 回退规则：第 9.1 节的实现已在 `861ec4d`；下一个 AI 开始前先 `git status --short`，保留后续工作区改动，除非用户明确要求回退。查看实现范围用 `git show --stat 861ec4d`，比较基线用 `git diff c8cd8cb 861ec4d`。若 `Low` 内存级别被确认影响动画，只移除 `SettingsForm` 中单独一行 `core.MemoryUsageTargetLevel = CoreWebView2MemoryUsageTargetLevel.Low`，不改其他逻辑。本轮只做本地提交，未上云。
