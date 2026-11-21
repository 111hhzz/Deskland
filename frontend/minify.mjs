// 构建期压缩：dist/assets/settings.{js,css} 原地 minify（esbuild）。
// 源码保持可读（frontend/src），只压缩构建产物；运行时无依赖。
// 由 frontend/build.ps1 在复制 src → dist 后自动调用；也可 `npm run minify` 手动执行。
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.dirname(fileURLToPath(import.meta.url));
const files = ['assets/settings.js', 'assets/settings.css'];
for (const f of files) {
  const p = path.join(root, 'dist', f);
  let code;
  try { code = await readFile(p, 'utf8'); } catch { continue; }
  const loader = f.endsWith('.css') ? 'css' : 'js';
  const res = await build({
    stdin: { contents: code, loader, resolveDir: path.dirname(p) },
    minify: true,
    write: false,
    logLevel: 'silent',
  });
  await writeFile(p, res.outputFiles[0].text);
  console.log(`minified ${f}  ${Math.round(code.length / 1024)}KB → ${Math.round(res.outputFiles[0].text.length / 1024)}KB`);
}
