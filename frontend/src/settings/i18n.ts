// 界面语言：文字表在 public/i18n/<语言>.json（ui：界面文字；themes：主题名和参数）。
// 加载结果缓存在模块级 Map，translate / localizeRegistry 直接读取；语言切换由 React 状态触发重渲染。

import type { LangCode, ThemeDef, ThemeRegistry } from './types';

export const LANGS: Record<LangCode, string> = { en: 'English', 'zh-CN': '简体中文' };

interface I18nParam {
  label?: string;
  hint?: string;
  options?: string[];
  unit?: string;
}

interface I18nTheme {
  name?: string;
  desc?: string;
  groups?: string[];
  params?: Record<string, I18nParam>;
}

export interface I18nFile {
  name: string;
  ui: Record<string, string>;
  themes?: Record<string, I18nTheme>;
  host: Record<string, string>;
}

const cache = new Map<LangCode, I18nFile>();

export function loadLang(code: LangCode): Promise<I18nFile> {
  const hit = cache.get(code);
  if (hit) return Promise.resolve(hit);
  return fetch(`/i18n/${code}.json`)
    .then(r => r.json() as Promise<I18nFile>)
    .then(data => { cache.set(code, data); return data; })
    // 加载失败不写缓存：否则一次网络抖动会让该语言永久退到 key 原文，重试也没用
    .catch(() => ({ name: code, ui: {}, themes: {}, host: {} }));
}

// 没有宿主时（浏览器里调界面）"跟随系统"按浏览器的语言
export function browserLang(): LangCode {
  for (const l of navigator.languages ?? [navigator.language]) {
    const x = (l || '').toLowerCase();
    if (x.startsWith('zh')) return 'zh-CN';
    const code = x.slice(0, 2) as LangCode;
    if (code in LANGS) return code;
  }
  return 'en';
}

// 一句界面文字：当前语言 → 英文 → 简体中文；{名字} 换成 vars 里的值
export function translate(lang: LangCode, key: string, vars?: Record<string, string | number>): string {
  const pick = (c: LangCode) => cache.get(c)?.ui[key];
  let str = pick(lang) ?? pick('en') ?? pick('zh-CN') ?? key;
  if (vars) str = str.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? '').toString());
  return str;
}

// 主题名、说明、分组、参数按界面语言换：当前语言 → 英文 → 主题清单原文（简体中文）
export function localizeRegistry(reg: ThemeRegistry, lang: LangCode): ThemeDef[] {
  if (lang === 'zh-CN') return reg.themes;
  const srcs = ([lang, 'en'] as LangCode[])
    .map(c => cache.get(c)?.themes)
    .filter((x): x is Record<string, I18nTheme> => !!x);
  return reg.themes.map(th => {
    const trs = srcs.map(x => x[th.id]).filter((x): x is I18nTheme => !!x);
    const get = (f: (x: I18nTheme) => unknown): unknown => {
      for (const x of trs) { const v = f(x); if (v != null) return v; }
      return null;
    };
    const name = get(x => x.name);
    const desc = get(x => x.desc);
    // 分组只能按索引对齐：译文分组数与主题不一致时整体不替换，否则会串名
    const trGroups = get(x => x.groups);
    const groupsAligned = Array.isArray(trGroups) && trGroups.length === (th.groups ?? []).length;
    const groups = (th.groups ?? []).map((g, gi) => {
      const gName = groupsAligned ? get(x => x.groups?.[gi]) : null;
      return {
        ...g,
        name: gName != null ? String(gName) : g.name,
        params: g.params.map(p => {
          const q = (f: (y: I18nParam | undefined) => unknown): unknown => get(x => f(x.params?.[p.key]));
          const label = q(y => y?.label);
          const hint = q(y => y?.hint);
          const options = q(y => y?.options);
          const unit = q(y => y?.unit);
          return {
            ...p,
            label: label != null ? String(label) : p.label,
            hint: hint != null ? String(hint) : p.hint,
            options: options != null ? (options as string[]) : p.options,
            unit: unit != null ? String(unit) : p.unit,
          };
        }),
      };
    });
    return {
      ...th,
      name: name != null ? String(name) : th.name,
      desc: desc != null ? String(desc) : th.desc,
      groups,
    };
  });
}
