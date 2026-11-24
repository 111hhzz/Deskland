// 主题与参数的领域逻辑：默认值、当前值、格式化、缩略图地址。纯函数，组件与 store 共用。

import type { ParamDef, ThemeDef } from './types.js';

export type Params = Record<string, Record<string, number>>;

export const newSeed = (): number => Math.floor(Math.random() * 1e6);

export const themeById = (themes: ThemeDef[], id: string): ThemeDef | undefined => themes.find((t) => t.id === id);

export const defaultsOf = (theme: ThemeDef): Record<string, number> => {
  const d: Record<string, number> = {};
  if (theme.adaptive) d.adaptive = 1;
  for (const g of theme.groups ?? []) for (const p of g.params) d[p.key] = p.default;
  return d;
};

export const valuesOf = (theme: ThemeDef, params: Params): Record<string, number> => ({
  ...defaultsOf(theme),
  ...params[theme.id],
});

export const seedOf = (id: string, params: Params): number | undefined => (params[id] || {}).seed;

export function fmtParam(p: ParamDef, v: number): string {
  if (p.options) return p.options[v] || '';
  if (p.format === 'times') return '×' + v.toFixed(2);
  if (p.format === 'percent') return Math.round(v * 100) + '%';
  const s = Number.isInteger(p.step) ? String(Math.round(v)) : v.toFixed(2);
  return p.unit ? s + ' ' + p.unit : s;
}

// 主题清单里的 thumb 是 CSS background 值，可能内嵌 url(...)；取出来给 <img> 用
export const thumbUrl = (value: string): string => String(value || '').match(/^url\(([^)]+)\)/)?.[1] || '';
