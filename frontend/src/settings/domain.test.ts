// settings/domain 纯函数单测：默认值、覆盖、格式化、缩略图解析。
import { describe, expect, it } from 'vitest';
import { defaultsOf, fmtParam, seedOf, themeById, thumbUrl, valuesOf } from './domain.js';
import type { ParamDef, ThemeDef } from './types.js';

const param = (over: Partial<ParamDef>): ParamDef => ({ key: 'k', label: 'K', default: 1, ...over });

const theme: ThemeDef = {
  id: 'demo',
  name: 'Demo',
  desc: '',
  status: 'ready',
  adaptive: true,
  groups: [{ name: 'G', params: [param({ key: 'wind', default: 2 })] }],
};

describe('settings/domain', () => {
  it('defaultsOf：adaptive 主题带 adaptive=1，并展开各参数默认值', () => {
    expect(defaultsOf(theme)).toEqual({ adaptive: 1, wind: 2 });
  });

  it('valuesOf：传入参数覆盖默认值', () => {
    expect(valuesOf(theme, { demo: { wind: 5, seed: 42 } })).toEqual({ adaptive: 1, wind: 5, seed: 42 });
  });

  it('seedOf：读取该主题的随机种子', () => {
    expect(seedOf('demo', { demo: { seed: 7 } })).toBe(7);
    expect(seedOf('demo', {})).toBeUndefined();
  });

  it('themeById：按 id 查找', () => {
    expect(themeById([theme], 'demo')).toBe(theme);
    expect(themeById([theme], 'x')).toBeUndefined();
  });

  it('fmtParam：options / times / percent / 步进与单位', () => {
    expect(fmtParam(param({ options: ['关', '开'], default: 1 }), 1)).toBe('开');
    expect(fmtParam(param({ format: 'times' }), 2.5)).toBe('×2.50');
    expect(fmtParam(param({ format: 'percent' }), 0.25)).toBe('25%');
    expect(fmtParam(param({ step: 1, unit: 'px' }), 3.4)).toBe('3 px');
    expect(fmtParam(param({ step: 0.1, unit: 'm' }), 1.25)).toBe('1.25 m');
  });

  it('thumbUrl：从 CSS background 的 url(...) 中取出地址', () => {
    expect(thumbUrl('url(a.png) center/cover')).toBe('a.png');
    expect(thumbUrl('url("b.png") center/cover')).toBe('b.png');
    expect(thumbUrl('#fff')).toBe('');
    expect(thumbUrl('')).toBe('');
  });
});
