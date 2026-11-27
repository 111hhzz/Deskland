// 主题 Token 运行时：引擎取值的唯一入口。
// 值来自生成的 tokens.ts（源为 tokens/**/*.tokens.json 的 DTCG JSON）；主循环只读一次，不再解析 CSS。
//
// 用户导入主题（M2）：构建期不存在，其覆盖值由 manifest 的 tokens 字段在页面启动时经
// registerUserTheme 注册——sceneToken 取值优先查该表；CSS 变量注入由同一函数完成
// （core 默认 + 覆盖写入 :root，面板 / 任务栏样式因此跟随包内 token，无需重新构建）。
import { TOKENS } from './tokens.js';

export type ThemeId = keyof typeof TOKENS.themes;

const FALLBACK_THEME: ThemeId = 'meadow';
let current: ThemeId = FALLBACK_THEME;

/** 用户主题的 token 覆盖（键 = CSS 变量名 / token 名，值 = string 或数值数组） */
const USER_TOKENS: Record<string, Record<string, unknown>> = {};

/** token 路径（color.bg）→ CSS 变量名（--color-bg），与 scripts/build-tokens.mjs 的 renderThemeCss 同规则 */
const toVarName = (name: string): string => '--' + name.replace(/\./g, '-');

/** 页面装载 / 热切换时调用一次：切换到目标主题的 token 表（未知 id 保持现状；用户主题需先 registerUserTheme）。 */
export function loadTheme(id: string): void {
  // 切回内置主题：撤掉用户主题注入的 :root 覆盖（否则同名变量会盖住 theme.css）
  if (typeof document !== 'undefined' && id in TOKENS.themes) {
    document.getElementById('user-theme-css')?.remove();
  }
  if (id in TOKENS.themes || id in USER_TOKENS) current = id as ThemeId;
}

export function currentThemeId(): ThemeId {
  return current;
}

/**
 * 注册用户主题的 token 覆盖并注入 CSS 变量（幂等；重复注册以最新为准）。
 * tokens 键支持两种写法：CSS 变量名（"--color-bg"）或 token 路径（"color.bg"）。
 */
export function registerUserTheme(id: string, tokens: Record<string, unknown>): void {
  const norm: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(tokens ?? {})) norm[k.startsWith('--') ? k : toVarName(k)] = v;
  USER_TOKENS[id] = norm;

  // CSS 注入：core 全量默认值 + 本主题覆盖（覆盖优先；缺省回落 core，与 theme.css 语义一致）
  if (typeof document === 'undefined') return; // Node / 单测环境只验取值逻辑
  const css: string[] = [];
  for (const [path, v] of Object.entries(TOKENS.core as Record<string, unknown>)) {
    css.push(`${toVarName(path)}: ${Array.isArray(v) ? v.join(' ') : String(v)};`);
  }
  for (const [k, v] of Object.entries(norm)) {
    css.push(`${k}: ${Array.isArray(v) ? v.join(' ') : String(v)};`);
  }
  let el = document.getElementById('user-theme-css');
  if (!el) {
    el = document.createElement('style');
    el.id = 'user-theme-css';
    document.head.appendChild(el);
  }
  el.textContent = `:root{${css.join('')}}`;
}

type TokenValue = string | number[];

/** 当前主题生效值：用户覆盖 → 主题覆盖 → core。 */
export function resolveToken(name: string): TokenValue | undefined {
  const u = USER_TOKENS[current]?.[name] ?? USER_TOKENS[current]?.[toVarName(name)];
  if (u !== undefined) return u as TokenValue;
  const theme = TOKENS.themes[current] as unknown as Record<string, TokenValue | undefined>;
  return theme?.[name] ?? (TOKENS.core as unknown as Record<string, TokenValue | undefined>)[name];
}

/** `--scene-*` 解析为数值数组（0-1 三元组或 vec2）；缺失 / 非法返回 null，由调用方跳过该 uniform。 */
export function sceneToken(name: string): number[] | null {
  const v = resolveToken(name);
  if (Array.isArray(v)) return v.length >= 2 && v.every((x) => Number.isFinite(x)) ? v : null;
  if (typeof v !== 'string') return null;
  const parts = v.trim().split(/\s+/).map(Number);
  return parts.length >= 2 && parts.every(Number.isFinite) ? parts : null;
}
