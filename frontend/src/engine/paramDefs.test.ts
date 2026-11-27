// 参数数据面单测：PARAM_DEFS 结构完整性 + 引擎默认值与生成物一致（防双写漂移复发）。
import { describe, expect, it } from 'vitest';
import { PARAM_DEFS, paramDefaults } from './paramDefs.js';
import type { EngineParams } from './BaseEngine.js';
import { MeadowEngine } from '../scenes/MeadowEngine.js';
import { SkyEngine } from '../scenes/SkyEngine.js';
import { FlatEngine } from '../scenes/FlatEngine.js';
import { AuroraEngine } from '../scenes/AuroraEngine.js';
import { OrbEngine } from '../scenes/OrbEngine.js';

const ENGINES: Array<[string, { prototype: { defaultParams: () => EngineParams } }]> = [
  ['meadow', MeadowEngine],
  ['sky', SkyEngine],
  ['beach', FlatEngine],
  ['aurora', AuroraEngine],
  ['orb', OrbEngine],
];

describe('engine/paramDefs', () => {
  it('每个注册主题都有参数声明，且参数键非空', () => {
    const ids = Object.keys(PARAM_DEFS);
    for (const [id] of ENGINES) expect(ids, `缺主题声明：${id}`).toContain(id);
    for (const [id, defs] of Object.entries(PARAM_DEFS)) {
      const keys = Object.keys(defs);
      expect(keys.length, `${id} 无参数`).toBeGreaterThan(0);
      for (const [k, m] of Object.entries(defs)) {
        expect(m.label, `${id}/${k} 缺 label`).toBeTruthy();
        if (m.type === 'number') {
          expect(typeof m.min, `${id}/${k} number 缺 min`).toBe('number');
          expect(typeof m.max, `${id}/${k} number 缺 max`).toBe('number');
          expect(m.min!).toBeLessThanOrEqual(m.max!);
        }
        if (m.type === 'enum') {
          expect(m.options!.length, `${id}/${k} enum 选项过少`).toBeGreaterThanOrEqual(2);
          expect(m.default, `${id}/${k} enum default 越界`).toBeGreaterThanOrEqual(0);
          expect(m.default).toBeLessThan(m.options!.length);
        }
      }
    }
  });

  it('引擎 defaultParams 的开放参数与 paramDefaults 逐项一致（防漂移）', () => {
    for (const [id, Cls] of ENGINES) {
      const d = (Cls.prototype.defaultParams as () => EngineParams).call(null);
      for (const [k, v] of Object.entries(paramDefaults(id))) {
        expect(d[k], `${id}/${k}：引擎默认 ${String(d[k])} ≠ theme.json ${String(v)}`).toBe(v);
      }
    }
  });

  it('displayKeys 内置参数不占用 theme.json.groups（adaptive 仅产品语义）', () => {
    for (const defs of Object.values(PARAM_DEFS)) {
      expect(Object.keys(defs)).not.toContain('adaptive');
    }
  });
});
