# Vite 引入设计文档（前端构建迁移）

- 日期：2026-11-22
- 状态：**已批准（2026-11-22）**，按阶段实施中
- 范围：`frontend/` 构建链路与目录结构；`host/`、宿主 C#、测试断言逻辑不变

## 1. 背景与目标

项目前端已进入持续工程化阶段（资源外联、压缩、ESLint/Stylelint/axe、Lighthouse 调优），且未来长期活跃、前端会继续加重。现有构建链是自建胶水：

```
frontend/scripts/build.ps1   # 清空 dist → 拷贝 src/* → dist → 调 minify.mjs → 写 version.txt
frontend/scripts/minify.mjs  # esbuild 压缩 dist/assets/settings.{js,css}
frontend/scripts/serve.mjs   # 23 行静态服务器（浏览器预览）
host/build.ps1               # 编译 C# → 清空 bin/prototype → 拷贝 frontend/dist/*
运行时：宿主把 https://app.local 虚拟映射到 <exe目录>\prototype（纯静态文件，无服务端）
```

目标：用 Vite 统一接管**开发服务器、模块打包、代码压缩、静态拷贝**，收编重复件；**产物形态与目录结构保持不变**，`host/build.ps1` 与宿主 C# 零改动。

## 2. 决策记录（已拍板）

| # | 决策 | 结论 |
|---|---|---|
| 1 | 结构方案 | **方案 C**：`src/` 放打包源码、`scripts/` 放工具模块、`public/` 放配置型静态 |
| 2 | dev server 定位 | **仅浏览器预览**调试；宿主仍跑 dist 构建产物（不动 `DesktopHost.cs`） |
| 3 | 产物命名 | **固定名、无哈希**（`assets/engine.js`、`assets/settings.css`…），缓存清理沿用 `version.txt` |
| 4 | MPA 范围 | **自动扫描 `src` 下全部 HTML 入口**（engine / settings / 各主题页），新增主题页零配置 |
| 5 | 分享功能 | 本次不涉及；旧 `lib/share.js` 已删除（HANDOFF 4.33），分享待**重新写**，与 Vite 迁移解耦 |

## 3. 现状盘点

### 3.1 文件与职责

| 位置 | 内容 |
|---|---|
| `src/engine.html` `settings.html` `meadow.html` `sky.html` `flat.html` | HTML 入口（MPA） |
| `src/themes/aurora/aurora.html` | 新增主题页样式（页在主题目录内） |
| `src/scenes/*.js`（Meadow/Sky/Flat/Aurora Engine） | 主题引擎（ES module） |
| `src/engine/DeskApp.js` `BaseEngine.js` `SceneEngine.js` `glsl/` | 引擎基类与应用层 |
| `src/engine/legacy/{meadow-boy,meadow-cat,beach-palms}.js` | 旧全局桥接脚本，运行时 `createElement` 动态加载，字面路径引用 `assets/*.png` |
| `src/assets/settings.{js,css}` | 设置页逻辑与样式（classic script + 同步外联 link） |
| `src/assets/share.js` | 旧分享脚本，**已删除**（零引用，见 HANDOFF 4.33）；分享功能待重新写 |
| `src/assets/*.png`（9 张） | legacy 脚本运行时字面引用（`assets/xxx.png`） |
| `src/themes/`（base.css、`<id>/theme.css|json`、CONVENTIONS.md、`_template/`） | 主题配置（纯静态，运行时换 `<link href>`） |
| `src/themes.json` `src/i18n/` `src/thumbs/` `src/lib/ripple.js` | 注册表 / 文案 / 缩略图 / classic 脚本 |

### 3.2 要替代的重复件

| 现有件 | 结局 |
|---|---|
| `scripts/serve.mjs` | 删 → `vite` dev server |
| `scripts/minify.mjs` | 删 → `vite build` 内置压缩 |
| `scripts/build.ps1` 的拷贝/清空/version.txt | 瘦身为 `npm ci && npm run build` + 写 version.txt |
| `package.json` 的 esbuild 直接依赖 | 降级为 Vite 传递依赖 |
| `scripts/thumbs.mjs` | **保留**（sharp 资源处理，非打包） |
| eslint / stylelint 配置 | **保留**（Vite 不管 lint） |
| `host/build.ps1` | 不动（仍读 `frontend/dist`） |

## 4. 方案选择

- **方案 A（仅 dev server）**：替代率太低，不满足「尽可能完全引入」。否决。
- **方案 B（src 布局不变 + 拷贝插件）**：改动小，但 Vite 会处理 HTML 内 `<link href="themes/...">` 等静态引用，破坏字面路径与「主题只加配置」，需持续绕行。保守备选，未选。
- **方案 C（Vite 标准结构，已选）**：`src` 只放代码、`public` 放配置型静态，Vite 原样拷贝 public、不处理，路径字面不变；从结构上消除 B 的暗礁，长期维护成本最低。

## 5. 目标架构

```
frontend/
  src/                       # 代码（Vite root = src）
    engine.html  settings.html  meadow.html  sky.html  flat.html
    themes/<id>/<id>.html    # 新增主题页（打包入口，自动扫描）
    engine/{DeskApp,BaseEngine,SceneEngine}.js  engine/glsl/  engine/main.js
    scenes/*.js
    assets/settings.{js,css} assets/share.js
  public/                    # 配置型静态（Vite 原样拷贝到产物根）
    themes.json  i18n/  thumbs/
    themes/{base.css,CONVENTIONS.md,_template/,<id>/{theme.css,theme.json}}
    lib/ripple.js  engine/legacy/*.js
    assets/*.png             # legacy 脚本字面引用，必须原样可达
  scripts/                   # 工具模块（build.ps1 / thumbs.mjs / eslint / stylelint / vite.config.mjs）
  dist/                      # 产物（结构不变，host 读它）
```

### 5.1 关键约定

1. **MPA 入口自动扫描**：`vite.config.mjs` 用 glob 扫描 `src/**/*.html` 作为 input。
2. **base = `'./'`**，`outDir = '../dist'`，`publicDir = '../public'`。
3. **产物固定名**：`rollupOptions.output.entryFileNames / assetFileNames` 设为 `assets/[name].[ext]`（CSS/JS 同规则），不用哈希。
4. **不进打包、保持字面路径的加载**（全部在 public，Vite 不处理）：
   - `lib/ripple.js`（classic script，位置与写法不变）
   - `engine/legacy/*.js`（运行时动态创建 `<script>`，路径 `engine/legacy/...` 不变）
   - `assets/*.png`（legacy 脚本 `image.src = 'assets/' + file`）
   - `themes/<id>/theme.css`（运行时动态换 `<link href>`）
5. **需要的小改**（低风险，测试兜底）：
   - `engine.html` 内联 `<script type="module">` 抽到 `src/engine/main.js`，HTML 改 `<script type="module" src>`。
   - `settings.html` 的 `<script src="assets/settings.js">` 加 `type="module"`（无全局依赖，安全）。
   - `themes/<id>/<id>.html` 按 CONVENTIONS 的 `../base.css` 写法引用 public 资源，路径保持。
6. **分享**：本次不涉及；旧 `share.js` 已删，重新写时不依赖它。
7. **legacy 无静态 import**（已核实）：迁移 `engine/legacy` 与 `lib/ripple.js` 到 public 不影响模块图。

## 6. 迁移步骤（每步独立验收、可单独回退）

### 阶段 0 · 基线固化
- `dotnet test` 全绿、工作区干净，打 tag `wip-vite-base`。

### 阶段 1 · Vite 落地
- 建 `frontend/public/`，`git mv` 迁移静态目录（保留历史）：`themes/`、`thumbs/`、`i18n/`、`lib/`、`engine/legacy/`、`themes.json`、`assets/*.png`。
- 新增 `vite.config.mjs`（root/outDir/base/publicDir/MPA glob/固定名）；`engine/main.js` 抽取；settings.js 改 module。
- `package.json`：加 `vite` devDependency，scripts 改 `dev/build/thumbs/lint`；`scripts/build.ps1` 瘦身为 `npm ci && npm run build`（`version.txt` 仍由它写）。
- 同步路径引用：`scripts/thumbs.mjs`（src/thumbs → public/thumbs）、`CONVENTIONS.md`、`AGENTS.md`（**需用户明确同意**）、`README.md`、`ThemeConventionTests` 等。
- **验收**：`dotnet test` 全绿（含 ThemeConvention 5 + 视觉基线 5 张）；dist 逐文件 diff（除预期 js/css 变化与 version.txt）；宿主实跑（设置页浅/深、语言切换、搜索、主题切换；4 主题热切换、legacy 脚本、ripple）。

### 阶段 2 · 收编与清理
- 删 `scripts/serve.mjs`、`scripts/minify.mjs`；更新 `HANDOFF.md`、`tools/ci.ps1` 若涉及。
- **验收**：`npm run dev` 浏览器预览可用；`tools/ci.ps1` 全绿；Lighthouse 设置页不低于迁移前。

### 不在本次范围
TypeScript 迁移、legacy 脚本 module 化（消除 window 全局桥接）、HMR 细调、分享功能重上线、接宿主 dev server。

## 7. 风险与回退

| 风险 | 应对 |
|---|---|
| Vite 处理 HTML 内静态引用 | 方案 C 用 public 隔离，结构上消除 |
| 视觉基线抖动（已知 8.6 环境性问题） | 迁移前记录基线差异；逐张比对，区分构建变化与抖动 |
| 设置页 CSS 加载形态（历史三次反复） | Vite 产物与现状同形态（同步外联 link），Lighthouse 复测兜底 |
| legacy 执行顺序（classic vs module） | 保持 classic 加载方式与位置不变 |
| legacy 图片 404 | `assets/*.png` 走 public 原样拷贝，阶段 1 验收覆盖 |
| 迁移失败 | 阶段 0 tag 整体回退；Vite 只影响 `frontend/` |

## 8. 验收清单（总）

- `dotnet test` 全绿（ThemeConvention 5 + 视觉基线 5 张 + E2E 20/20）
- 宿主实跑：设置页（浅/深、语言、搜索、切换）+ 壁纸（engine 启动、4 主题热切换、legacy、ripple）+ Win32 Probe
- `npm run dev` 浏览器预览可用
- Lighthouse 设置页不低于迁移前
- dist 结构 diff 无意外变化
- `tools/ci.ps1` 全绿
