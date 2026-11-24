// 主题 Token 运行时：引擎取值的唯一入口。
// 值来自生成的 tokens.ts（源为 tokens/**/*.tokens.json 的 DTCG JSON）；主循环只读一次，不再解析 CSS。
import { TOKENS } from './tokens.js';

export type ThemeId = keyof typeof TOKENS.themes;

const FALLBACK_THEME: ThemeId = 'meadow';
let current: ThemeId = FALLBACK_THEME;

/** 页面装载 / 热切换时调用一次：切换到目标主题的 token 表（未知 id 保持回退主题）。 */
export function loadTheme(id: string): void {
  if (id in TOKENS.themes) current = id as ThemeId;
}

export function currentThemeId(): ThemeId {
  return current;
}

type TokenValue = string | number[];

/** 当前主题生效值：主题覆盖优先，缺失回退 core。 */
export function resolveToken(name: string): TokenValue | undefined {
  const theme = TOKENS.themes[current] as unknown as Record<string, TokenValue | undefined>;
  return theme[name] ?? (TOKENS.core as unknown as Record<string, TokenValue | undefined>)[name];
}

/** `--scene-*` 解析为数值数组（0-1 三元组或 vec2）；缺失 / 非法返回 null，由调用方跳过该 uniform。 */
export function sceneToken(name: string): number[] | null {
  const v = resolveToken(name);
  if (Array.isArray(v)) return v.length >= 2 && v.every((x) => Number.isFinite(x)) ? v : null;
  if (typeof v !== 'string') return null;
  const parts = v.trim().split(/\s+/).map(Number);
  return parts.length >= 2 && parts.every(Number.isFinite) ? parts : null;
}
