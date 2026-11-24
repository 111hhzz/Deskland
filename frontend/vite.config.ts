// Vite+ 统一配置（dev / build / lint / fmt / type-check）。
// 结构：root = src（代码），public = ../public（配置型静态，原样拷贝到产物根），产物 ../dist（固定名、无哈希）。
// 宿主仍读 frontend/dist；dev server 只用于浏览器预览，不接宿主。
import { defineConfig } from 'vite-plus';
import react from '@vitejs/plugin-react';
import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)); // frontend
const root = join(here, 'src');
const dist = join(here, 'dist');
const pub = join(here, 'public');

// MPA 入口：自动扫描 src 下全部 HTML（engine / settings / 各主题页），新增主题页零配置。
function scanHtml(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...scanHtml(p));
    else if (name.endsWith('.html')) out.push(p);
  }
  return out;
}
const input: Record<string, string> = {};
for (const p of scanHtml(root)) input[relative(root, p).replace(/\\/g, '/')] = p;

// 禁用浏览器默认的 /favicon.ico 请求：注入空 data URI 的 icon link。
const noFavicon = {
  name: 'deskland-no-favicon',
  transformIndexHtml(html: string) {
    return html.replace('</head>', '  <link rel="icon" href="data:,">\n</head>');
  },
};

export default defineConfig({
  root,
  base: './',
  publicDir: pub,
  // React 只用于 TSX/JSX 组件；引擎等纯脚本仍走 oxc/esbuild，产物不变。
  plugins: [noFavicon, react({ include: /\.[jt]sx$/ })],
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
        entryFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
        chunkFileNames: 'assets/[name].js',
      },
    },
  },
  // Oxfmt：与既有代码风格对齐（单引号 / 分号 / 120 列）；CSS 交给 Stylelint，不在此格式化。
  fmt: {
    singleQuote: true,
    semi: true,
    printWidth: 120,
    tabWidth: 2,
    trailingComma: 'all',
    // public/themes/*/theme.json 由 token 编译器整体回写（JSON.stringify 风格），不参与 Oxfmt
    ignorePatterns: ['dist', 'node_modules', '.local', '*.css', 'src/engine/tokens.ts', 'public/themes/*/theme.json'],
  },
  // Oxlint：类型感知规则 + 类型检查（tsrs，即 TypeScript 7 native）。
  lint: {
    ignorePatterns: ['dist/**', 'node_modules/**', 'src/engine/tokens.ts'],
    options: { typeAware: true, typeCheck: true },
  },
});
