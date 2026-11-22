// Vite 配置（前端构建 + dev 预览）。
// 结构：root = src（代码），public = ../public（配置型静态，原样拷贝到产物根），产物 ../dist（固定名、无哈希）。
// 宿主仍读 frontend/dist，host/build.ps1 不变；dev server 只用于浏览器预览，不接宿主。
import { defineConfig } from 'vite';
import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));   // frontend/scripts
const front = join(here, '..');                        // frontend
const root = join(front, 'src');
const dist = join(front, 'dist');
const pub = join(front, 'public');

// MPA 入口：自动扫描 src 下全部 HTML（engine / settings / 各主题页），新增主题页零配置。
function scanHtml(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...scanHtml(p));
    else if (name.endsWith('.html')) out.push(p);
  }
  return out;
}
const input = {};
for (const p of scanHtml(root)) input[relative(root, p).replace(/\\/g, '/')] = p;

export default defineConfig({
  root,
  base: './',
  publicDir: pub,
  build: {
    outDir: dist,
    emptyOutDir: true,
    target: 'es2022',
    // 不注入 modulepreload polyfill（保持产物简单）
    modulePreload: false,
    rollupOptions: {
      input,
      output: {
        // 固定名、无哈希：缓存清理沿用 host 写的 version.txt。
        // entry 都是 js（HTML 内联 module 也被提为 entry）；asset 含 css/图片。
        entryFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
        // 多入口共享模块会被拆成 chunk；[name] 取自模块名（DeskApp / 各 Engine），此处唯一。
        chunkFileNames: 'assets/[name].js',
      },
    },
  },
});
