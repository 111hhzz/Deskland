# Deskland+ (Unofficial Community Fork)

**Adaptive Windows wallpaper that makes your desktop icons part of the scenery.**

> **Unofficial community fork**
>
> This repository is an **unofficial, community-maintained fork** of [Deskland](https://github.com/BLEZZ0102/Deskland). It is not released, endorsed or affiliated with the upstream project (BLEZZ0102/Deskland / deskland.app). Code and theme assets are GPL-3.0; see [TRADEMARKS.md](TRADEMARKS.md).
>
> **What differs from upstream**
> - Adds a third usable theme, **Sky** (upstream ships Beach and Meadow only).
> - Theme engine: pages are thin shells; rendering lives in `frontend/src/engine/` (BaseEngine / SceneEngine / per-theme engines / DeskApp).
> - In-page theme hot-switching via `engine.html` (no WebView reload).
> - Frontend sources moved from `prototype/` to `frontend/src/`, with `frontend/scripts/build.ps1`.
> - Settings styles/scripts live in `frontend/src/settings/settings.css|js`.
> - Added `tools/ci.ps1` (build + test in one command) and an xUnit + Playwright test suite (19 tests) with visual baselines.
> - Event-driven desktop-icon tracking (`SetWinEventHook`) with a 400 ms polling fallback.

Deskland turns the space around your icons into a living landscape. Move, add or remove an icon and the beach, meadow, sky, clouds and shadows quietly reshape around it — in real time, without AI, an account or an API key.

This is an **unofficial community fork** of Deskland, not a time-limited trial. It includes the complete **Beach**, **Meadow** and **Sky** themes, the Windows host and the settings interface.

**English** · [简体中文](#中文说明) · [Upstream](https://github.com/BLEZZ0102/Deskland) · [Features](#features) · [Build from source](#build-from-source)

![Meadow — included in Deskland+](media/images/meadow.webp)

![Beach — included in Deskland+](media/images/beach.webp)

Meadow, Beach and Sky are included in this fork.

## Included themes

| Beach | Meadow | Sky |
| --- | --- | --- |
| ![Beach theme](frontend/src/thumbs/beach.webp) | ![Meadow theme](frontend/src/thumbs/meadow.webp) | ![Sky theme](frontend/src/thumbs/sky.webp) |
| Turquoise waves, kayaks, seabirds and coconut palms. | Drifting clouds and shadows, a boy flying a kite and a little black cat. | Cartoon blue sky and puffy clouds, with day, dusk and night. |

## Features

- **Adaptive scenery:** uses the real positions of desktop icons and transitions smoothly when they move.
- **Three complete themes:** every setting for Beach, Meadow and Sky is included and saved between sessions.
- **Made for the desktop:** tray controls, startup on sign-in and automatic pause when a window is maximized or full-screen.
- **Independent installation:** Preview uses its own install directory, settings, startup entry and instance identity, so it can coexist with other Deskland builds.
- **English and Simplified Chinese:** no sign-in, purchase restoration, update service or store API is included.

## Requirements

- Windows 10 or Windows 11, 64-bit.
- Microsoft Edge WebView2 Runtime.
- PowerShell and the .NET Framework C# compiler included with Windows; no .NET SDK installation is required.
- An internet connection for the first build, which downloads the WebView2 development library.
- Node.js only if you want to run the browser preview.

Currently, Deskland renders on the **primary monitor** and targets 30 fps on integrated graphics.

## Build from source

Open PowerShell in the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File frontend\scripts\build.ps1   # frontend/src → frontend/dist
powershell -ExecutionPolicy Bypass -File host\build.ps1       # compile the host and copy dist → host/bin/prototype
host\bin\Deskland.exe
```

Frontend sources live in `frontend/src/`; `frontend\scripts\build.ps1` produces the static bundle in `frontend/dist/`, and `host\build.ps1` copies it into `host/bin/prototype/`. Build output is written to `host/bin/`.

Run the program again or double-click its tray icon to open Settings. To exit and restore the original Windows wallpaper, use the tray menu or run:

```powershell
host\bin\Deskland.exe --exit
```

Preview settings and logs are stored separately in `%LOCALAPPDATA%\DesklandPlus`.

## Developing and testing

One command to build the host and run the full test suite (xUnit + Playwright .NET, needs the .NET SDK):

```powershell
powershell -ExecutionPolicy Bypass -File tools\build\ci.ps1
```

Add `-Package` to also build the installer, or `-SkipTests` to build only. The pre-commit hook runs `dotnet format --verify-no-changes`, `dotnet build --warnaserror`, a deslop check and `dotnet test`.

Tests are organised in four layers: **unit** (theme conventions, no browser), **E2E** (Playwright .NET over the WebView2 CDP), **Win32** (window-structure probe) and **visual baseline** (frozen-frame pixel comparison).

## Browser preview

```powershell
cd frontend
pnpm dev        # Vite dev server（默认 5173 端口）
```

Open **http://localhost:5173/pages/settings.html**. The browser uses sample icons; adaptation to real desktop icons requires the Windows host.

## Windows installer

Build the NSIS installer without installing global development tools:

```powershell
powershell -ExecutionPolicy Bypass -File tools\build\build-installer.ps1
```

The first build downloads portable NSIS and Microsoft's WebView2 bootstrapper. Artifacts are written to `dist/` with SHA256 checksums and a matching source ZIP.

The installer targets the current user's `Programs\Deskland+` directory and does not require administrator rights. If WebView2 is missing, its bootstrapper requires an internet connection. Uninstalling preserves user settings.

[Download Deskland+ for Windows](https://github.com/111hhzz/Deskland/releases/latest). The installer is unsigned, so Windows SmartScreen may show a warning.

## Project layout

| Path | Contents |
| --- | --- |
| `host/` | Windows host, build scripts and application manifest |
| `frontend/src/` | Frontend sources (Vite root): pages, themes, engine, scenes, settings |
| `frontend/src/pages/` | App pages: `engine.html`（页内热切换入口）、`settings.html` |
| `frontend/src/themes/<id>/<id>.html` | 主题页（beach / meadow / sky / aurora） |
| `frontend/src/engine/` | 主题引擎类（BaseEngine / SceneEngine / 各主题引擎 / DeskApp） |
| `frontend/src/settings/` | 设置页样式 / 脚本 |
| `frontend/public/` | 配置型静态（themes / i18n / thumbs / lib） |
| `frontend/public/themes/_products.json` | 主题授权表（id / status / product + 展示顺序，宿主持有） |
| `frontend/public/themes/<id>/theme.json` | 单个主题的自描述（含锁定主题的展示信息） |
| `tools/` | 构建 / 打包 / 发布脚本（`build/` 构建与打包、`release/` 发布、`local.ps1` 本机状态） |

## Known limitations

- Only the primary monitor is supported.
- Windows Spotlight or a wallpaper slideshow can briefly flash when Windows changes the background image.
- Preview does not include account sign-in, entitlement restoration, automatic updates or the other themes' implementation.

## Credits and license

Source code and included theme assets are released under [GPL-3.0](LICENSE). Third-party dependencies are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

The Deskland name and icon are not licensed as trademarks; modified distributions should use their own name and icon. See [TRADEMARKS.md](TRADEMARKS.md).

Issues and suggestions are welcome through GitHub Issues. This is an unofficial community fork, so immediate responses are not guaranteed.

---

## 中文说明

[English](#deskland-unofficial-community-fork) · **简体中文**

**让桌面图标成为风景的一部分。**

> **非官方社区修改版**
>
> 本仓库是 [Deskland](https://github.com/BLEZZ0102/Deskland) 的**非官方、社区维护的修改版**，与上游官方（BLEZZ0102/Deskland / deskland.app）**无关联、未获认可或背书**。代码与主题素材按 GPL-3.0 发布；上游商标条款见 [TRADEMARKS.md](TRADEMARKS.md)。
>
> **与上游的主要差异**
> - 新增第三个可用主题 **Sky（天空）**（上游仅 Beach / Meadow）。
> - 主题引擎化：页面退化为引导壳，渲染逻辑在 `frontend/src/engine/`（BaseEngine / SceneEngine / 各主题引擎 / DeskApp）。
> - 新增 `engine.html` 页内主题热切换，不重建 WebView。
> - 前端源从 `prototype/` 迁移到 `frontend/src/`，新增 `frontend/scripts/build.ps1` 打包。
> - 设置页样式/脚本在 `frontend/src/settings/settings.css|js`。
> - 新增 `tools/ci.ps1`（一条命令构建 + 测试）与 xUnit + Playwright 测试体系（20 项）及视觉基线。
> - 桌面图标检测改为 `SetWinEventHook` 事件驱动，400ms 轮询兜底。

Deskland 是一款 Windows 自适应动态壁纸。移动、添加或删除桌面图标时，海岸线、草地、云朵和阴影会实时围绕图标调整。全部在本地实时演算，不使用 AI，无需账号或 API Key。

本仓库是 Deskland 的**非官方社区修改版**，不是限时试用版，包含完整的沙滩、草地和天空主题、Windows 宿主与设置界面。

[上游项目](https://github.com/BLEZZ0102/Deskland) · [从源码运行](#build-from-source) · [许可](#credits-and-license)

### 包含的主题

| 沙滩 | 草地 | 天空 |
| --- | --- | --- |
| ![沙滩主题](frontend/src/thumbs/beach.webp) | ![草地主题](frontend/src/thumbs/meadow.webp) | ![天空主题](frontend/src/thumbs/sky.webp) |
| 海浪、皮划艇、海鸟和椰子树。 | 漂浮的云与云影、放风筝的男孩和小黑猫。 | 卡通风的蓝天白云，可选白天、傍晚、晚上。 |

### 功能

- **图标自适应：**读取真实桌面图标的位置，在移动、添加或删除时平滑调整场景。
- **三个完整主题：**沙滩、草地和天空的全部参数均可调整并自动保存。
- **适合常驻桌面：**托盘控制、开机自动启动，前台窗口最大化或全屏时自动暂停。
- **独立安装：**安装目录、用户数据、启动项和运行实例标识均独立，可与其他 Deskland 版本共存。
- **简体中文和英文：**不包含登录、购买恢复、自动更新或商店接口。

### 系统要求

- Windows 10 / Windows 11，64 位。
- Microsoft Edge WebView2 Runtime。
- 使用 Windows 自带的 .NET Framework C# 编译器，无需安装 .NET SDK。
- 第一次构建需要联网下载 WebView2 开发库。
- 仅浏览器预览需要 Node.js。

目前只覆盖**主显示器**，以核显 30fps 为目标。

### 从源码运行

在仓库根目录打开 PowerShell：

```powershell
powershell -ExecutionPolicy Bypass -File frontend\scripts\build.ps1   # frontend/src → frontend/dist
powershell -ExecutionPolicy Bypass -File host\build.ps1       # 编译宿主并把 dist 复制到 host/bin/prototype
host\bin\Deskland.exe
```

前端源在 `frontend/src/`，`frontend\scripts\build.ps1` 产出静态包到 `frontend/dist/`，`host\build.ps1` 再复制到 `host/bin/prototype/`。编译结果位于 `host/bin/`。

再次运行程序或双击托盘图标可打开设置。退出并恢复系统原壁纸，请使用托盘菜单或执行：

```powershell
host\bin\Deskland.exe --exit
```

体验版的设置与日志独立保存在 `%LOCALAPPDATA%\DesklandPlus`。

### 开发与测试

一条命令构建宿主并跑完整测试（xUnit + Playwright .NET，需要 .NET SDK）：

```powershell
powershell -ExecutionPolicy Bypass -File tools\build\ci.ps1
```

加 `-Package` 同时打包安装器，或加 `-SkipTests` 只构建。pre-commit 钩子会依次跑 `dotnet format --verify-no-changes`、`dotnet build --warnaserror`、屎山检查与 `dotnet test`。

测试分四层：**单元**（主题约定，无浏览器）、**E2E**（Playwright .NET 经 WebView2 CDP）、**Win32**（窗口结构探针）与**视觉基线**（冻结画面像素比对）。

### 浏览器预览

```powershell
cd frontend
pnpm dev        # Vite dev server（默认 5173 端口）
```

打开 **http://localhost:5173/pages/settings.html**。浏览器使用示例图标，真实桌面图标适配需要 Windows 宿主。

### Windows 安装包

```powershell
powershell -ExecutionPolicy Bypass -File tools\build\build-installer.ps1
```

首次构建会下载便携版 NSIS 和微软 WebView2 引导程序，无需安装全局开发工具。产物位于 `dist/`，附 SHA256 校验文件和对应源码 ZIP。

安装包安装到当前用户的 `Programs\Deskland+` 目录，无需管理员权限。缺少 WebView2 时需要联网安装；卸载保留用户设置。

[下载 Deskland+ Windows 安装包](https://github.com/111hhzz/Deskland/releases/latest)。安装包未签名，Windows SmartScreen 可能显示提示。

### 目录结构

| 路径 | 用途 |
| --- | --- |
| `host/` | Windows 宿主、构建脚本与清单 |
| `frontend/src/` | 前端源（Vite root）：pages、themes、engine、scenes、settings |
| `frontend/src/pages/` | 应用页：`engine.html`（页内热切换入口）、`settings.html` |
| `frontend/src/themes/<id>/<id>.html` | 主题页（beach / meadow / sky / aurora） |
| `frontend/src/engine/` | 主题引擎类（BaseEngine / SceneEngine / 各主题引擎 / DeskApp） |
| `frontend/src/settings/` | 设置页样式 / 脚本 |
| `frontend/public/` | 配置型静态（themes / i18n / thumbs / lib） |
| `frontend/public/themes/_products.json` | 主题授权表（id / status / product + 展示顺序，宿主持有） |
| `frontend/public/themes/<id>/theme.json` | 单个主题的完整定义及锁定主题的展示信息 |
| `tools/` | 构建 / 打包 / 发布脚本（`build/` 构建与打包、`release/` 发布、`local.ps1` 本机状态） |

### 已知限制

- 目前只支持主显示器。
- 使用 Windows 聚焦或壁纸幻灯片时，系统换图可能造成短暂闪烁。
- 体验版不包含账号登录、购买恢复、自动更新或其他主题实现。

### 许可与反馈

项目源码和随附主题素材按 [GPL-3.0](LICENSE) 发布，第三方依赖见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

Deskland 名称与图标不作为商标授权授予；修改版应使用自己的名称和图标，详见 [TRADEMARKS.md](TRADEMARKS.md)。

欢迎通过 GitHub Issues 反馈问题和建议。本仓库为非官方社区修改版，不保证即时回复。
