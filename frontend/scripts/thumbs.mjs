// 缩略图重编码：public/thumbs/*.webp → 同尺寸、quality 78，覆盖写回。
// 规格：卡片/预览显示宽约 200—300 CSS px，源图统一 588×336（≈2x，适配高 DPI），
// 单张约 5—8KB；改动主题视觉后需重新出图并同步 theme.json 的 ?v=（内容 hash）。
// 重新出图：sharp 从 test/baselines/wallpaper-<id>.png 缩至 588×336（cover），再跑本脚本压缩。
// 运行：pnpm thumbs   （需要先 pnpm install，仅在新增/替换缩略图时执行）
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'thumbs');
const files = (await readdir(dir)).filter((f) => f.toLowerCase().endsWith('.webp'));
if (!files.length) {
  console.log('没有找到 .webp 缩略图');
  process.exit(0);
}

let totalBefore = 0,
  totalAfter = 0;
for (const f of files) {
  const p = path.join(dir, f);
  const before = await readFile(p);
  const after = await sharp(before).webp({ quality: 78, effort: 6 }).toBuffer();
  await writeFile(p, after);
  totalBefore += before.length;
  totalAfter += after.length;
  console.log(`${f}: ${(before.length / 1024).toFixed(1)} KB → ${(after.length / 1024).toFixed(1)} KB`);
}
console.log(`合计: ${(totalBefore / 1024).toFixed(1)} KB → ${(totalAfter / 1024).toFixed(1)} KB`);
