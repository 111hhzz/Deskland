# Deskland 主题约定与 Design Token 规范

本文件约定主题的目录结构、Design Token 命名规则、运行时切换方式与开发红线。
目标：**新增主题只加配置，不碰宿主 C#，也不碰其他主题。**

## 1. 文件放在哪里

宿主把 `https://app.local` 虚拟域映射到 `prototype/`（见 `host/DesktopHost.cs` 的
`SetVirtualHostNameToFolderMapping`），所以一切主题文件都必须在 `prototype/` 下。

```
prototype/
  themes.json                 # 注册表：宿主 / 设置页读它（id、status、page、product、thumb、groups）
  themes/
    CONVENTIONS.md            # 本文件
    base.css                  # 公共样式：唯一允许写选择器的地方，全部用 var() 引用 Token
    _template/                # 新增主题的模板（theme.json / theme.css / README.md）
    <id>/
      theme.json              # 主题清单 + Token schema（id/name/desc/page/status/product/tokens）
      theme.css               # 主题 Token 值（只含 :root 自定义属性）
      <id>.html               # 可选：主题页面（新主题建议放在这里）
```

现有三个 ready 主题的页面仍留在 `prototype/*.html`（`meadow.html` / `sky.html` / `flat.html`），
它们的 `themes/<id>/` 目录只放 `theme.json` 与 `theme.css`；新主题建议把页面放进自己的目录。

## 2. 各文件的职责

| 文件 | 职责 | 谁读 |
|---|---|---|
| `prototype/themes.json` | 注册表：主题列表、产品权限、缩略图、参数（groups） | 宿主 `Themes.cs`、设置页 `settings.html`、打包脚本 |
| `themes/<id>/theme.json` | 主题自描述 + Token schema（名字/类型/说明） | 约定测试、工具链、未来设置页 |
| `themes/<id>/theme.css` | 主题 Token **值**（只含 `:root` 自定义属性） | 浏览器（CSS）+ 引擎（JS 读 computed style） |
| `themes/base.css` | 公共样式 + 跨主题 Token 默认值 | 浏览器 |
| `themes/<id>/<id>.html` | 主题页面（引擎 + DOM） | 宿主加载 |

`theme.json` 的 `tokens` 是 **schema**（声明本主题用了哪些 Token），值在 `theme.css`；
约定测试会交叉校验“schema 里的每个名字都存在于 theme.css”。

`theme.json` 的 `page` 是相对 `prototype/` 的路径（如 `themes/<id>/<id>.html`），
必须与 `themes.json` 里该主题的 `page` 一致。

## 3. Token 命名规则

**格式：`--<category>-<role>[-<variant>|-<state>]`**

- 全小写、kebab-case；数字仅用于刻度/层级（`--color-surface-2`、`--font-size-sm`）。
- `role` 必须是**语义名**（用途），禁止外观名（`--color-blue-500` 只能做原始层，页面禁用）。
- 状态后缀限定：`-hover` / `-active` / `-muted` / `-border`。

**category 白名单：**

| category | 含义 | 示例 |
|---|---|---|
| `color` | 颜色 | `--color-bg`、`--color-surface`、`--color-accent` |
| `font` | 字体 / 字号 / 字重 | `--font-main`、`--font-mono`、`--font-size-sm` |
| `motion` | 时长与缓动 | `--motion-fade`、`--motion-settle`、`--motion-ease-out` |
| `radius` | 圆角 | `--radius-sm` / `--radius-md` / `--radius-lg` |
| `size` | 尺寸 | `--taskbar-size`、`--icon-cell-width`、`--panel-width` |
| `blur` | 模糊 / 饱和 | `--blur-panel`、`--saturate-panel` |
| `z` | 层叠 | `--z-taskbar`、`--z-ripple`、`--z-panel` |
| `shadow` | 阴影 | `--shadow-panel`、`--shadow-glyph` |
| `scene` | **WebGL 场景调色板** | `--scene-ground-mid`、`--scene-cloud-hi` |

**scene token 格式：** `--scene-*` 的颜色值写成 **0-1 的 `r g b` 三元组**（如 `0.62 0.75 0.42`），
由引擎用 `getComputedStyle(document.documentElement).getPropertyValue(...)` 读出后解析；
方向/偏移类（`--scene-light-dir`、`--scene-shadow-offset`）用空格分隔的数值。
这样主题 CSS 同时驱动 DOM 和着色器，无需把颜色硬编码进 GLSL。

**公共 Token 默认值**（在 `base.css :root`，主题可覆盖）：

| 分类 | Token | 默认值 |
|---|---|---|
| color | `--color-surface` | `rgba(20,52,64,.74)` |
| color | `--color-surface-2` / `--color-surface-active` | `rgba(255,255,255,.06)` / `rgba(255,255,255,.17)` |
| color | `--color-border` / `--color-text` / `--color-text-muted` | `rgba(255,255,255,.14)` / `#eef6f5` / `#d4e4e2` |
| color | `--color-accent` | `#7fe3d6` |
| color | `--color-taskbar-bg` / `--color-taskbar-border` | `rgba(28,32,38,.6)` / `rgba(255,255,255,.08)` |
| color | `--color-icon-hover-bg` / `--color-icon-hover-border` | `rgba(255,255,255,.16)` / `rgba(255,255,255,.24)` |
| color | `--color-icon-sel-bg` / `--color-icon-sel-border` | `rgba(0,120,215,.34)` / `rgba(140,200,255,.7)` |
| color | `--color-label` / `--color-nogl` | `#fff` |
| color | `--color-ripple` / `--color-ripple-glow` / `--color-ripple-inset` | `rgba(255,255,255,.8)` / `.55` / `.35` |
| font | `--font-main` / `--font-mono` | Segoe UI 系列 / Consolas 系列 |
| font | `--font-size-xs` / `-sm` / `-md` / `-lg` | `11px` / `12px` / `14px` / `16px` |
| motion | `--motion-fade` / `--motion-settle` / `--motion-born` / `--motion-ripple` | `250ms` / `.22s` / `.45s` / `.65s` |
| motion | `--motion-ease-out` / `-settle` / `-spring` | `ease-out` / `cubic-bezier(.2,.8,.3,1)` / `cubic-bezier(.2,.9,.3,1.2)` |
| radius | `--radius-sm` / `--radius-button` / `--radius-md` / `--radius-lg` / `--radius-icon` | `4px` / `5px` / `7px` / `12px` / `9px` |
| size | `--taskbar-size` / `--icon-cell-width` / `--icon-glyph-size` / `--panel-width` / `--panel-offset` | `48px` / `76px` / `48px` / `284px` / `14px` |
| blur | `--blur-taskbar` / `--saturate-taskbar` / `--blur-panel` / `--saturate-panel` | `28px` / `1.6` / `18px` / `1.3` |
| z | `--z-taskbar` / `--z-ripple` / `--z-panel` | `40` / `45` / `50` |
| shadow | `--shadow-panel` / `--shadow-glyph` / `--shadow-ghost` / `--text-shadow-label` | 见 `base.css` |
| scene | `--scene-cloud-hi` / `--scene-cloud-body` / `--scene-cloud-shade` | 云的亮部 / 主体 / 暗部 |
| scene | `--scene-light-dir` / `--scene-shadow-offset` | 阳光方向 / 云影偏移 |

每个主题的 `theme.css` 至少覆盖 `--color-bg` 与自己的 `--scene-*` 调色板；其余继承 `base.css` 默认值。

## 4. 主题页如何引入

页面按 **先 base、后 theme** 的顺序引入（同为主题 `:root`，后加载的覆盖前者）：

```html
<link rel="stylesheet" href="themes/base.css">
<link rel="stylesheet" href="themes/<id>/theme.css">
```

- 新主题页面放在 `themes/<id>/<id>.html` 时，路径写成 `../base.css` 与 `theme.css`。
- 页面专属的**布局**例外（如沙滩始终隐藏调试面板）可以留一个不含颜色的小 `<style>`。
- 页面在 `<html>` 上设 `data-theme="<id>"`（可选，便于调试与未来扩展）。

## 5. 运行时切换与宿主配合

- **壁纸页**：宿主按 `themes.json.page` 整体换页（`WallpaperForm.LoadPage`），一个页面就是一个主题，
  天然不需要 `data-theme` 切换。新增主题只要 `themes.json` 指向存在的页面即可，**不改 C#**。
- **共享引擎外壳**（未来）：外壳页用 JS 动态替换 `<link href="themes/<id>/theme.css">` 并更新
  `document.documentElement.dataset.theme`，CSS 变量自动生效，宿主无需改动。
- **深浅色**：设置页 `settings.html` 用 `@media (prefers-color-scheme: dark)` 响应。宿主在
  WebView2 就绪后调用 `SystemTheme.ApplyTo(core)`，把 `CoreWebView2Profile.PreferredColorScheme`
  设为 `Light` / `Dark`（默认 `Auto` 在部分系统上不跟随系统，深色媒体查询会失效）。

## 6. 开发红线

1. **`theme.css` 只能包含 `:root { --token: value; }`**，禁止任何其他选择器。
2. **`base.css` 是唯一允许写选择器的地方**；其中禁止出现字面颜色（`#hex`、`rgb()`、`rgba()`、
   `hsl()`、`white`、`black` 等），只能 `var(--*)`（`transparent` / `inherit` / `none` 等关键字除外）。
3. **新增颜色、字体、动效、圆角、模糊、阴影必须先定义 Token**，再在 `base.css` 或 `theme.css` 引用；
   禁止在页面 `<style>` 或 JS 里硬编码颜色（WebGL 调色板走 `--scene-*`）。
4. `theme.json` 的 `tokens` schema 必须与 `theme.css` 里实际声明的 Token 一一对应。
5. 新增主题不得修改其他主题的 `theme.css` / `theme.json`，也不得修改 `base.css` 的默认值
   （除非所有主题同步迁移）。

## 7. 验证

- 约定测试：`dotnet test --filter ThemeConvention`（校验上述红线与 schema 一致性）。
- 视觉基线：设置页（浅/深）+ 三个壁纸页（暂停动画后采样）共 5 张，见 `test/Deskland.Tests/`。
- 性能：`theme_switch` 埋点阈值，见 `DesklandE2ETests`。
