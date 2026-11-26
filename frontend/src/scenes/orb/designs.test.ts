// orb 点云 registry 单测：确定性 / 点数 / 数值有效性 / manifest 文案对齐。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ORB_BASE_COUNT, ORB_DESIGNS, buildOrbCloud, orbDesignByIndex } from './designs.js';

interface OrbManifest {
  groups: Array<{ params: Array<{ key: string; default: number; options?: string[] }> }>;
}

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../public/themes/orb/theme.json', import.meta.url)), 'utf8'),
) as OrbManifest;

const designParam = manifest.groups.flatMap((g) => g.params).find((p) => p.key === 'orbDesign');

describe('orb designs', () => {
  it('registry 完整且名称唯一（顺序即设置页选项顺序）', () => {
    expect(ORB_DESIGNS.length).toBe(5);
    expect(new Set(ORB_DESIGNS.map((d) => d.id)).size).toBe(ORB_DESIGNS.length);
    expect(new Set(ORB_DESIGNS.map((d) => d.name)).size).toBe(ORB_DESIGNS.length);
    // manifest 的「形态」选项与 registry 文案一一对应，防止两边漂移
    expect(designParam?.options).toEqual(ORB_DESIGNS.map((d) => d.name));
    expect(designParam?.default ?? 0).toBe(0);
  });

  it('索引越界收敛到有效形态', () => {
    expect(orbDesignByIndex(-3).id).toBe(ORB_DESIGNS[0]!.id);
    expect(orbDesignByIndex(99).id).toBe(ORB_DESIGNS[ORB_DESIGNS.length - 1]!.id);
  });

  // 各形态的半径范围（pos 保留径向，不做归一化——见 designs.ts 头注释）
  const RADII: Record<string, [number, number]> = {
    sphere: [0.94, 1.0],
    torus: [0.35, 1.09],
    spiral: [0.99, 1.01],
    galaxy: [0.0, 1.01],
    lattice: [0.96, 1.04],
  };

  for (const d of ORB_DESIGNS) {
    it(`形态 ${d.name}：点数正确、半径在预期范围、数值有限`, () => {
      const c = buildOrbCloud(ORB_DESIGNS.indexOf(d), 1, 123456);
      expect(c.count).toBe(ORB_BASE_COUNT);
      expect(c.pos.length).toBe(c.count * 3);
      expect(c.misc.length).toBe(c.count * 4);
      const [lo, hi] = RADII[d.id]!;
      let minR = Infinity,
        maxR = 0;
      for (let i = 0; i < c.count; i++) {
        const x = c.pos[i * 3]!,
          y = c.pos[i * 3 + 1]!,
          z = c.pos[i * 3 + 2]!;
        expect(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)).toBe(true);
        const r = Math.hypot(x, y, z);
        minR = Math.min(minR, r);
        maxR = Math.max(maxR, r);
        for (let k = 0; k < 4; k++) expect(Number.isFinite(c.misc[i * 4 + k])).toBe(true);
      }
      expect(minR).toBeGreaterThanOrEqual(lo);
      expect(maxR).toBeLessThanOrEqual(hi);
    });
  }

  it('同 seed 同参数完全确定（视觉基线可复现）', () => {
    const a = buildOrbCloud(0, 1, 123456);
    const b = buildOrbCloud(0, 1, 123456);
    expect(Array.from(a.pos)).toEqual(Array.from(b.pos));
    expect(Array.from(a.misc)).toEqual(Array.from(b.misc));
  });

  it('不同 seed 产生不同点云', () => {
    const a = buildOrbCloud(0, 1, 1);
    const b = buildOrbCloud(0, 1, 2);
    expect(Array.from(a.pos)).not.toEqual(Array.from(b.pos));
  });

  it('密度换算点数并设下限', () => {
    expect(buildOrbCloud(0, 0.3, 7).count).toBe(Math.round(ORB_BASE_COUNT * 0.3));
    expect(buildOrbCloud(0, 2, 7).count).toBe(ORB_BASE_COUNT * 2);
    expect(buildOrbCloud(0, 0.01, 7).count).toBeGreaterThanOrEqual(64);
  });
});
