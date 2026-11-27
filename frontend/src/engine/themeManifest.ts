// 主题清单运行时加载（manifest）：
//  - 内置主题：/themes/<id>/theme.json（构建产物，public 下）
//  - 用户导入主题：/u/<id>/theme.json（宿主映射的用户目录，见 M1b）
// 页面启动时读取一份 manifest，用于：① 解析引擎类型（用户主题的 engine 字段）；② 注册
// 运行时参数声明（groups → PARAM_DEFS 等价物）；③ 媒体素材地址。缺失时回退旧行为，不阻断启动。
import type { ParamMeta } from './paramSchema.js';

export interface ThemeManifest {
  /** 引擎类型键（image / video / meadow…）；缺省时按主题 id 直查内置注册表 */
  engine?: string;
  /** 媒体素材地址（相对站点根，如 /u/<id>/a.mp4） */
  mediaSrc?: string;
  groups?: unknown;
}

/** 按候选顺序拉取 manifest；全部失败返回 null */
export async function loadThemeManifest(...urls: string[]): Promise<ThemeManifest | null> {
  for (const url of urls) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) continue;
      return (await r.json()) as ThemeManifest;
    } catch {
      /* 下一个候选 */
    }
  }
  return null;
}

/**
 * theme.json.groups → ParamMeta（运行时声明，注册到 paramSchema.RUNTIME_DEFS）。
 * 生成期校验在 scripts/build-params.mjs / 宿主导入侧；这里只做容错归一化：
 * 结构明显非法的条目跳过并记 console，不拖垮页面启动。
 */
export function normalizeGroups(raw: unknown): Record<string, ParamMeta> {
  const out: Record<string, ParamMeta> = {};
  if (!Array.isArray(raw)) return out;
  for (const g of raw) {
    if (!g || typeof g !== 'object') continue;
    const params = (g as { params?: unknown }).params;
    if (!Array.isArray(params)) continue;
    for (const p of params) {
      if (!p || typeof p !== 'object') continue;
      const d = p as Record<string, unknown>;
      const key = typeof d.key === 'string' ? d.key : '';
      if (!key || out[key]) continue;
      const meta = normalizeParam(key, d);
      if (meta) out[key] = meta;
    }
  }
  return out;
}

function normalizeParam(key: string, d: Record<string, unknown>): ParamMeta | null {
  const type = d.type === 'bool' ? 'bool' : Array.isArray(d.options) ? 'enum' : 'number';
  const label = typeof d.label === 'string' ? d.label : key;
  if (type === 'bool') {
    return typeof d.default === 'boolean' ? { type, label, default: d.default } : null;
  }
  if (type === 'enum') {
    const options = (d.options as unknown[]).filter((o): o is string => typeof o === 'string');
    if (options.length < 2 || typeof d.default !== 'number' || d.default < 0 || d.default >= options.length)
      return null;
    return { type, label, options, min: 0, max: options.length - 1, step: 1, default: d.default };
  }
  const min = typeof d.min === 'number' ? d.min : 0;
  const max = typeof d.max === 'number' ? d.max : 1;
  const step = typeof d.step === 'number' ? d.step : 1;
  return typeof d.default === 'number' ? { type, label, min, max, step, default: d.default } : null;
}
