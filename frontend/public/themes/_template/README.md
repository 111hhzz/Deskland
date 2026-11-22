# 新增主题

1. 复制本目录为 `frontend/public/themes/<id>/`，改 `theme.json` 里的 `id / name / desc / page / status / product / tokens`，改 `theme.css` 里的 Token 值。
2. 把最接近的原型页复制成 `frontend/src/themes/<id>/<id>.html`，将其内联 `<style>` 整块替换为 `<link rel="stylesheet" href="/themes/base.css">` 与 `<link rel="stylesheet" href="/themes/<id>/theme.css">`（样式在 `public/`，用绝对路径）；页面专属布局例外可保留一个不含颜色的小 `<style>`。
3. 在 `frontend/public/themes.json` 加一条记录（`page` 指向 `themes/<id>/<id>.html`），把缩略图放进 `frontend/public/thumbs/`，然后跑 `dotnet test` 验证约定与视觉基线。
