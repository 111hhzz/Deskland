// ESLint 配置（flat config）。仅报告，不阻断提交。
// 源码在 src/（浏览器脚本），工具脚本在仓库根（.mjs，Node ESM）。
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  {
    // TS / TSX：用 TS 解析器读，规则交给 tsc（noEmit）与 react-hooks
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: { 'no-undef': 'off', 'no-unused-vars': 'off' },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['**/*.mjs'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node } },
  },
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: { ...globals.browser } },
    rules: {
      // 主题页/引擎由多个 <script> 共享全局作用域，跨文件引用与导出无法单文件判断
      'no-undef': 'off',
      'no-unused-vars': 'off',
    },
  },
  {
    // 引擎与主题引擎使用 import/export（ES 模块）；lib/ 与 assets/ 是经典脚本
    files: ['src/engine/**/*.js', 'src/scenes/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.browser } },
  },
];
