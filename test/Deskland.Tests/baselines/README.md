# 视觉基线

`VisualBaseline_AllScreens` 测试的基线截图：

| 文件 | 内容 |
|---|---|
| `settings-light.png` | 设置页 · 浅色（`prefers-color-scheme: light`） |
| `settings-dark.png` | 设置页 · 深色（`prefers-color-scheme: dark`） |
| `wallpaper-meadow.png` | 草地壁纸页（动画冻结） |
| `wallpaper-sky.png` | 天空壁纸页（动画冻结） |
| `wallpaper-beach.png` | 沙滩壁纸页（动画冻结） |
| `wallpaper-aurora.png` | 夜航 · 极光壁纸页（动画冻结） |
| `wallpaper-orb.png` | 星尘 · 点阵球壁纸页（动画冻结） |

新增 ready 主题时，在 `DesklandE2ETests.VisualBaseline_AllScreens` 的页面列表里加一条，
并用下面的命令重新生成基线。

## 可复现性

- 设置页是静态 DOM，整图比对。
- 壁纸页通过 `AddInitScriptAsync` 冻结 `performance.now` / `requestAnimationFrame`，
  并把 `Math.random` 换成固定种子的 PRNG（meadow.html 用 `Math.random()` 生成场景种子）。
- 截图前调用 `__dbg.applyLayout('mine')`，把图标重摆到内置固定格子：云团形状绕图标走，
  若用真实桌面图标，布局随机器 / 会话变化会导致基线漂移（曾反复失效的根因）。
- 因此截图不随时间、桌面图标位置变化；换分辨率 / DPI 后仍需重新生成。
- 允许 2% 的像素差异（`MaxDiffRatio`），用于吸收抗锯齿/缩放的轻微抖动。

## 重新生成

```powershell
$env:DESKLAND_UPDATE_BASELINES = "1"
dotnet test test/Deskland.Tests/Deskland.Tests.csproj --filter "FullyQualifiedName~VisualBaseline_AllScreens"
```

基线与当前机器的分辨率 / DPI / 窗口尺寸相关；换机器或改分辨率后需要重新生成。
失败时测试会在本目录写 `actual-<name>.png`（已 gitignore），便于目视对比。
