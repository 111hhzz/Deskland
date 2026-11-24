# 新增主题

1. 复制本目录为 `frontend/public/themes/<id>/`，改 `theme.json` 里的 `id / name / desc / page / thumb / groups`。
   主题自己的素材（图片、legacy 脚本）放本主题目录下，页面与脚本按主题相对路径引用。
2. **Token 值写进 DTCG JSON**：新建 `frontend/tokens/themes/<id>/theme.tokens.json`，只写与 core 不同的覆盖
   （至少 `--color-bg` 与本主题的 `--scene-*`；scene token 用 `$type: vec3/vec2` 并在
   `$extensions."deskland.v1".uniform` 登记 uniform 名）。然后跑 `pnpm tokens` 生成
   `public/themes/<id>/theme.css`、`theme.json.tokens` 与 `src/engine/tokens.ts`。
3. 把最接近的原型页复制成 `frontend/src/themes/<id>/<id>.html`：内联 `<style>` 整块替换为
   `<link rel="stylesheet" href="/themes/base.css">` 与 `<link rel="stylesheet" href="/themes/<id>/theme.css">`
   （样式在 `public/`，用绝对路径）；页面专属布局例外可保留一个不含颜色的小 `<style>`。
   页面内联脚本里在构造引擎前调用 `loadTheme('<id>')`（从 `../../engine/tokenRuntime.js` 导入）。
4. 在 `frontend/public/themes/_products.json` 的 `themes` 里加一条记录（`id` / `status` / `product`，
   顺序即设置页展示顺序），然后跑 `pnpm tokens:check` 与 `dotnet test` 验证同步门禁、约定与视觉基线。
5. 想让设置页立刻看到新主题：点设置页搜索框旁的「刷新主题」（宿主重扫 `prototype/themes/`，不监听文件变化）。
