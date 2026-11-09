# Deskland 二次开发 · 交接文档

> 本仓库是 GitHub 原项目 `BLEZZ0102/Deskland` 的本地二次修改版。
> 截至 2026-11-10，仅存在 **本地 git**，尚未推送远程（用户要求"上云"时才推）。

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

工作区当前干净（`git status` 无改动），`host/bin/`、`host/lib/` 已被 `.gitignore` 忽略。

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

原则：**每个功能一个 commit + 一个 tag**；大改动前先 `git commit` 或 `git tag wip-xxx` 再动手；不要在当前分支上 `reset --hard` 到别人的历史后再强推。

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
| `host/DesktopHost.cs` | 宿主主体：窗口挂载、WebView2 初始化、图标读取、Z 顺序、穿透开关、托盘 |
| `host/Themes.cs` | 主题清单读取 + `Allowed()` 权限判定（`status==ready` 且 `product` 命中） |
| `prototype/themes.json` | 主题清单（含 locked 预告与已解锁主题） |
| `prototype/sky.html` | 天空主题页面（含消息契约 `icons/settings/reset/pause`） |
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

## 7. 待办 / 可选下一步（未做）

- 把"穿透"状态持久化进 `settings.json`，重启恢复勾选。
- 从壁纸页消息 `{"t":"clickthrough","v":...}` 驱动 `SetClickThrough`（本次按要求未改 `settings.html`）。
- 继续解锁其它 locked 主题（大海/湖泊/森林…）：它们**只有缩略图和文案、没有页面实现**，需以 `flat.html`/`meadow.html`/`sky.html` 为底座自研，且缺少原作者的美术素材。
- 上云：用户确认后 `git remote add` + `git push`（本机当前无 remote、未推送）。

## 8. 注意事项

- 本程序挂到桌面图标层之下当壁纸层，正常退出才还原；勿在任务管理器强杀导致层数残留（强杀后可重开一次再正常退出）。
- `DesktopIconLocator` 与 Z 顺序钩子是 **两个独立** `SetWinEventHook` 实例，委托各自持有，互不干扰。
- 改动 HTML 主题页后无需重编 C#；改 C# 需重跑 `build.ps1`。
