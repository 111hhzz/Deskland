// 缩略图重编码：src/thumbs/*.webp → 同尺寸、quality 78，覆盖写回。
// 用途：缩略图卡片实际显示宽度很小（~300px），源图 294×168 却要 40—80KB，
// 重编码后每张约 8—15KB，首屏图片体积约降到 1/4。
// 运行：npm run thumbs   （需要先 npm install，仅在新增/替换缩略图时执行）
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'src', 'thumbs');
const files = (await readdir(dir)).filter(f => f.toLowerCase().endsWith('.webp'));
if (!files.length) { console.log('没有找到 .webp 缩略图'); process.exit(0); }

let totalBefore = 0, totalAfter = 0;
for (const f of files) {
  const p = path.join(dir, f);
  const before = await readFile(p);
  const after = await sharp(before).webp({ quality: 78, effort: 6 }).toBuffer();
  await writeFile(p, after);
  totalBefore += before.length; totalAfter += after.length;
  console.log(`${f}: ${(before.length / 1024).toFixed(1)} KB → ${(after.length / 1024).toFixed(1)} KB`);
}
console.log(`合计: ${(totalBefore / 1024).toFixed(1)} KB → ${(totalAfter / 1024).toFixed(1)} KB`);
