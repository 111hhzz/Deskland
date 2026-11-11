# AGENTS.md

> 本文件为 AI 编程助手提供 Deskland 项目的上下文和开发规范。

## 项目概述

Deskland 是一个 Windows 桌面壁纸应用，基于 WinForms + WebView2 构建：
- **C# / .NET Framework 4.x**：宿主程序（WinForms 窗口、托盘、图标钩子）
- **WebView2**：嵌入 HTML/CSS/JS 页面作为壁纸和设置界面
- **HTML / CSS / JavaScript**：主题渲染（WebGL 云朵动画、涟漪效果）

## 开发规范

### 1. 编译与运行

```powershell
# 编译宿主（需要 .NET Framework C# 编译器）
cd host
powershell -ExecutionPolicy Bypass -File build.ps1

# 运行
host\bin\Deskland.exe --settings    # 打开设置窗口
host\bin\Deskland.exe --autostart   # 启动壁纸
host\bin\Deskland.exe --exit        # 退出
```

### 2. 测试

```powershell
# 运行 E2E 测试（需要 .NET 8 SDK）
cd test/Deskland.Tests
dotnet test

# Win32 Probe（独立窗口结构断言）
$env:DESKLAND_PROFILE_DIR = "D:\tmp\deskland-test"
$env:DESKLAND_TEST = "1"
.\host\bin\Deskland.exe --test --settings
# 另开终端：
$env:DESKLAND_PROFILE_DIR = "D:\tmp\deskland-test"
.\test\win32-probe\bin\Win32Probe.exe
```

### 3. Git 提交规范

**重要**：每次提交前必须运行测试，确保编译和测试通过。

- 使用 `git commit` 会自动触发 pre-commit hook（lint + typecheck + deslop + test）
- 使用 `git push` 会自动触发 pre-push hook（编译 + test）
- 提交信息格式：`type: 简短描述`
  - `feat:` 新功能
  - `fix:` 修复
  - `test:` 测试
  - `docs:` 文档
  - `refactor:` 重构
  - `perf:` 性能优化

**pre-commit 门禁**（按顺序执行，任一失败即阻止提交）：
1. **Lint**：`dotnet format --verify-no-changes`
2. **Typecheck**：`dotnet build --warnaserror`（编译警告即错误）
3. **Deslop**：屎山代码检查
   - TODO/FIXME/HACK/XXX 注释
   - 调试输出（Console.WriteLine，host/ 目录）
   - 空 catch 块
   - 硬编码敏感信息（password/secret/token）
4. **Test**：`dotnet test`

**注意**：
- `host/` 目录禁止 `Console.WriteLine`（用 `Log.Write`）
- 禁止提交 TODO/FIXME 注释（先完成再提交）
- 禁止空 catch 块（至少 `catch { Log.Write(ex.Message); }`）
- 禁止硬编码密码/密钥/token

### 4. 代码风格

- C# 5 语法（.NET Framework 4.x 限制）
- 使用 `var` 而不是显式类型
- 优先使用 `async/await`
- 异常处理：记录日志并优雅降级

### 5. 测试规范

- **E2E 测试**：Playwright .NET 连接 WebView2 CDP，断言 DOM 状态
- **Win32 Probe**：独立 C# 程序，断言窗口结构（`Chrome_WidgetWin_1` 存在性）
- **性能埋点**：`TestProbe.Signal("perf", new { path, ms })`，只在 `--test` 模式启用
- **禁止**：像素对比视觉回归（WebGL 动画导致大量误报）

## 常见问题

### Q: WebView2 初始化失败？
- 确保安装了 Microsoft Edge WebView2 Runtime
- 检查 `host/lib/` 是否有 `Microsoft.Web.WebView2.Core.dll`
- 运行 `host/build.ps1` 自动下载 SDK

### Q: 测试端口冲突？
- 确保 9222/9223 端口空闲
- 杀掉残留的 `Deskland.exe` 和 `msedgewebview2.exe` 进程

### Q: .NET 8 SDK 未找到？
- 安装路径：`$env:LOCALAPPDATA\Microsoft\dotnet`
- 添加到 PATH：`$env:Path = "$env:LOCALAPPDATA\Microsoft\dotnet;$env:Path"`

### Q: Git hook 不生效？
- 检查 `.git/hooks/pre-commit` 是否存在
- 确保有执行权限：`chmod +x .git/hooks/pre-commit`

## 参考资源

- [HANDOFF.md](HANDOFF.md) — 项目现状、功能落点、待办
- [Playwright .NET + WebView2](https://playwright.dev/dotnet/docs/webview2)
- [FlaUI](https://github.com/FlaUI/FlaUI)
- [Git Hooks](https://git-scm.com/book/en/v2/Customizing-Git-Git-Hooks)

## 重要约束

1. **云端推送必须用户逐次同意**，默认只本地提交
2. **GitHub 代理**：`127.0.0.1:7890`（用户已关闭，重开前一律不推）
3. **PAT**：存放在 `.gh_token`（已 gitignore），勿提交、勿外传
4. **设置数据**：`%LOCALAPPDATA%\DesklandPreview\settings.json` 用户保留，勿擅改
5. **单实例**：Deskland 只允许一个实例运行，测试前确保无残留进程
