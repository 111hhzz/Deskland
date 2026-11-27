// 媒体参数 schema 与运行时清单归一化单测。
import { describe, expect, it } from 'vitest';
import { IMAGE_PARAMS, VIDEO_PARAMS } from './schema.js';
import { FIT_OPTIONS } from './schema.js';
import { normalizeGroups } from '../../engine/themeManifest.js';

describe('scenes/media/schema', () => {
  it('图片主题：填充方式（enum，范围由选项派生）+ 遮罩', () => {
    const fit = IMAGE_PARAMS.fit!;
    const veil = IMAGE_PARAMS.veil!;
    expect(fit.type).toBe('enum');
    expect(fit.options).toEqual([...FIT_OPTIONS]);
    expect(fit.min).toBe(0);
    expect(fit.max).toBe(FIT_OPTIONS.length - 1);
    expect(veil.type).toBe('number');
  });

  it('视频主题：在图片基础上加播放速度 / 静音 / 循环', () => {
    for (const k of Object.keys(IMAGE_PARAMS)) expect(VIDEO_PARAMS[k]).toBeDefined();
    expect(VIDEO_PARAMS.speed!.type).toBe('number');
    expect(VIDEO_PARAMS.muted!.type).toBe('bool');
    expect(VIDEO_PARAMS.loop!.type).toBe('bool');
  });
});

describe('engine/themeManifest.normalizeGroups', () => {
  const group = (params: unknown[]) => [{ name: '媒体', params }];

  it('number / enum / bool 归一化；坏条目跳过不抛错', () => {
    const defs = normalizeGroups(
      group([
        { key: 'veil', label: '遮罩', type: 'number', min: 0, max: 0.8, step: 0.01, default: 0 },
        { key: 'fit', label: '填充', options: ['cover', 'contain'], default: 0 },
        { key: 'muted', label: '静音', type: 'bool', default: true },
        { key: 'bad' }, // 无类型无默认：跳过
      ]),
    );
    expect(Object.keys(defs)).toEqual(['veil', 'fit', 'muted']);
    expect(defs.fit!.type).toBe('enum');
    expect(defs.fit!.max).toBe(1);
    expect(defs.muted!.default).toBe(true);
  });

  it('缺组 / 非数组输入返回空表', () => {
    expect(normalizeGroups(undefined)).toEqual({});
    expect(normalizeGroups([{ name: 'x' }])).toEqual({});
  });
});
