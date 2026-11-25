// Vite+ 统一配置（dev / build / lint / fmt / type-check）。
// 结构：root = src（代码），public = ../public（配置型静态，原样拷贝到产物根），产物 ../dist（固定名、无哈希）。
// 宿主仍读 frontend/dist；dev server 只用于浏览器预览，不接宿主。
import { defineConfig } from 'vite-plus';
import react from '@vitejs/plugin-react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
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

// 设置页 HTML 两项优化（仅 build 生效，dev 保留外链与锚点，方便热更新）：
//   ① settings.css 内联成 <style>——去掉一次渲染阻塞请求（本地 HTTP / 虚拟域读盘各要一跳）。
//      settings.css 无外部 url()/@import（唯一一处是 data URI），内联无相对路径副作用；产出 css 删除。
//   ② 主题缩略图 preload——从各主题 theme.json 取真实 thumb URL（含 ?v= 版本串，才能与运行时
//      LCP 请求完全匹配），让设置页最大的可见元素 #preview 在初始文档里就可被发现。
const thumbPreloadUrls = (): string[] => {
  const urls: string[] = [];
  for (const id of readdirSync(join(pub, 'themes'))) {
    if (id.startsWith('_')) continue;
    const dir = join(pub, 'themes', id);
    if (!statSync(dir).isDirectory()) continue; // themes/ 下还混着 base.css 等文件
    const file = join(dir, 'theme.json');
    if (!statSync(file).isFile()) continue;
    try {
      const json = JSON.parse(readFileSync(file, 'utf8')) as { thumb?: string };
      const m = String(json.thumb || '').match(/^url\(([^)]+)\)/);
      if (m) urls.push(m[1].replace(/^['"]|['"]$/g, ''));
    } catch {
      /* 单个清单坏了：跳过它，不影响其它主题 */
    }
  }
  return [...new Set(urls)];
};

const tuneSettingsHtml = {
  name: 'deskland-tune-settings-html',
  enforce: 'post',
  generateBundle(
    _options: Record<string, unknown>,
    bundle: Record<string, { type: string; source?: string | Uint8Array }>,
  ) {
    const htmlKey = Object.keys(bundle).find((k) => k.endsWith('pages/settings.html'));
    if (!htmlKey) return;
    const htmlOut = bundle[htmlKey];
    if (htmlOut.type !== 'asset') return;
    let html = String(htmlOut.source);

    const cssKey = Object.keys(bundle).find((k) => k.endsWith('settings.css'));
    if (cssKey) {
      const cssSource = bundle[cssKey].source;
      const css = typeof cssSource === 'string' ? cssSource : new TextDecoder().decode(cssSource);
      const link = new RegExp(`<link rel="stylesheet"[^>]*${cssKey}[^>]*>`);
      if (css && link.test(html)) {
        html = html.replace(link, () => `<style>\n${css}\n</style>`);
        delete bundle[cssKey];
      }
    }

    const urls = thumbPreloadUrls();
    if (urls.length) {
      const links = urls
        .map((u) => `    <link rel="preload" as="image" href="${u}" fetchpriority="high" />`)
        .join('\n');
      html = html.replace('<head>', () => `<head>\n${links}\n`);
    }

    htmlOut.source = html;
  },
};

export default defineConfig({
  root,
  base: './',
  publicDir: pub,
  // React 只用于 TSX/JSX 组件；引擎等纯脚本仍走 oxc/esbuild，产物不变。
  plugins: [noFavicon, tuneSettingsHtml, react({ include: /\.[jt]sx$/ })],
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
