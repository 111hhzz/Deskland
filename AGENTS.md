# Deskland 二次修改版 · 开发指南

> 上游 `BLEZZ0102/Deskland` 的本地 fork。本文件优先于上游 `AGENTS.md`；历史与验证见 `HANDOFF.md`，不确定行为先查它，不凭记忆恢复已删功能。

## 1. 身份与范围

- 中文沟通。产品名 `Deskland Preview`，读写 `%LOCALAPPDATA%\DesklandPreview`，与商店版隔离。
- 仅本地 git，无 remote；未获负责人要求，不上云。
- 不接授权/商店更新/账号登录；`themes.json` 购买文案保留，不接真实支付。
- 界面仅简体中文和英文。

## 2. 主题

- 已完成主题：`flat` / `meadow` / `sky`（均 `ready`+`free`）。（会逐渐完成主题制作）
- 锁定主题无 `page` 和 `groups`，点击只打开购买说明。
- `themes.json`、参数默认值、中英文文案保持一致。
- `prototype/thumbs/` 人工设计，未经要求不重新生成。
- 画布按实际像素与小数显示尺寸绘制。

## 3. 构建与运行

- 宿主：`powershell -ExecutionPolicy Bypass -File host\build.ps1` → `host/bin/Deskland.exe`。
- C# 5 语法，不引入新依赖（禁字符串插值、`?.`、表达式体成员）。
- 参数：`--autostart` / `--settings` / `--exit`。重编前先正常退出。
- 浏览器预览：`node prototype\serve.mjs` → `http://localhost:5178/settings.html`。
- 改 HTML/JS 不重编宿主（托盘“重新载入”）；改 C# 重跑 `build.ps1`。

## 4. 桌面集成架构（改动前必读）

- 壁纸窗口挂在 `SHELLDLL_DefView` 之下（24H2+ 走 `Progman` 分层子窗口，经典走 `WorkerW`）。`EnsureZOrder` 不动。
- 混合命中：桌面图标区域由 `SysListView32` 消费点击，图标间空白落到 WebView2。图标始终可点，与穿透开关无关。
- `SetClickThrough` 语义 = 完全让出鼠标事件（WebView2 连空白也不再接收），非“修复桌面不可点”。默认关闭。
- 两个独立 `SetWinEventHook`，互不干扰：
  - Z 顺序钩子 `0x8000–0x8004`：上游原样，不改。
  - 图标事件钩子 `0x800B`（`DesktopIconLocator`，80ms 去抖）：回调入口按 `eventType → hwnd → OBJID_CURSOR(-9) → OBJID_CLIENT(-4)` 顺序短路。`OBJID_CURSOR` 最先过滤。
  - 两个钩子的委托用类级字段持有，防 GC 野指针。
- `DesktopClickHook`（`WH_MOUSE_LL`）：只观察主屏桌面根窗口左键，先 `CallNextHookEx` 放行，仅发 `ripple` 消息。不替代穿透开关，不记录坐标/按键。
- 已知遗留：WebView2 最外层 `Chrome_WidgetWin_0` 未带 `WS_EX_TRANSPARENT`，穿透开启后点击是否真落到桌面尚未实测，不假设父窗口穿透已覆盖子窗口。

## 5. 性能 / 内存（硬约束）

- 目标核显 30fps；静态绘图缓存，小物体用局部图层，不在全屏着色器逐个计算大量物体。
- 闲置 `Deskland.exe` Private Bytes 10 分钟峰值 < 50 MiB（`msedgewebview2` 不计）。
- 设置页 `MemoryUsageTargetLevel.Low` 若影响动画，只删 `SettingsForm` 中那一行。
- 性能埋点可一键移除（`PERF_DEBUG` 开关），低频，不记录点击坐标或按键。
- 排查延迟问题：先量化，不预设根因。区分冷启动 / 热切换 / 稳态帧率三类场景，改前先出报告。

## 6. 改动后验证

- 图标移动/新增/删除后壁纸更新（事件驱动 + 降级轮询均可）。
- 三主题切换、参数同步、暂停/继续。
- 桌面点击涟漪正常且不阻断点击。
- 穿透开关：关时点空白 WebView2 能收点击；开时桌面能响应；两态下桌面图标均可选中。
- 设置页静态缩略图正常（无实时预览 iframe）。
- `--exit` 后 `DesklandPreview` 进程数为 0。

## 7. 硬约束

- 不移除只读点击钩子、`ripple` 消息、穿透开关、`GWL_EXSTYLE` 日志。
- 不引入新依赖、不升级 C# 版本。
- 不记录点击坐标、按键或任何用户输入。

## 8. Git 工作流

- 每次代码更改都做好版本管理和本地提交，提交信息说明改动范围与验证结果。
- 每功能一 commit + 一 tag；大改前先 commit 或 `git tag wip-xxx`。
- 里程碑 tag：`deskland-baseline` / `feat-icon-event-hook` / `feat-sky-theme` / `feat-clickthrough`。
- 不 `reset --hard` 丢弃未提交改动；回退优先新建分支（`git checkout -b tmp-rollback <tag>`）。
- 动手前先 `git status --short`，保留用户未提交改动，除非负责人要求回退。
- 不提交 `host/bin/`、`host/lib/`、个人数据、凭证、本机路径。
- 未获负责人要求，不上云（不 `git remote add`、不 `push`）。

## 9. 当前优先待办

- 壁纸/切换延迟（见 `HANDOFF.md` 7.1）：先埋点量化冷启动、热切换、稳态帧率，再定优化点。候选 `Navigate` 整页重载、`sky.html` 首次 `commit(true)` 的 2.6s morph、同步 shader/`buildNoiseTex()`——测量前均非确定根因。
- 可选后续：穿透状态持久化、`clickthrough` 消息驱动、解锁其它 locked 主题、上云。延迟问题落地后再排。

## 10. 发布与许可

- 发布或修改商标须负责人指示。许可见 `LICENSE`，名称图标见 `TRADEMARKS.md`。
- 上游 `v0.1.2` / `v0.1.3` 属上游历史；本 fork 未上云、未发布，不当作本仓库发布状态。