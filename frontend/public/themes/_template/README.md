# 新增主题

1. 复制本目录为 `frontend/public/themes/<id>/`，改 `theme.json` 里的 `id / name / desc / page / thumb / groups / tokens`，改 `theme.css` 里的 Token 值。主题自己的素材（图片、legacy 脚本）放本主题目录下，页面与脚本按主题相对路径引用。
2. 把最接近的原型页复制成 `frontend/src/themes/<id>/<id>.html`，将其内联 `<style>` 整块替换为 `<link rel="stylesheet" href="/themes/base.css">` 与 `<link rel="stylesheet" href="/themes/<id>/theme.css">`（样式在 `public/`，用绝对路径）；页面专属布局例外可保留一个不含颜色的小 `<style>`。
3. 在 `frontend/public/themes/_products.json` 的 `themes` 里加一条记录（`id` / `status` / `product`，顺序即设置页展示顺序），然后跑 `dotnet test` 验证约定与视觉基线。
4. 想让设置页立刻看到新主题：点设置页搜索框旁的「刷新主题」（宿主重扫 `prototype/themes/`，不监听文件变化）。
