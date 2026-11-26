// 点云形态 registry： orb 主题的可扩展点。
// 新增形态 = 加一个 OrbDesign 条目 + manifest 的 options 一项；
// manifest 的「形态」选项文案需与本文件的 name 保持一致（由 designs.test.ts 断言）。
//
// 约定：
//   - build(rng, n) 必须返回恰好 n 个点（引擎按返回值绘制）；
//   - pos 为带半径的位置（方向 × 半径系数，系数量级 ≤ ~1.1），**不做归一化**——
//     环面/星轨盘的径向结构必须保留，否则会退化成球带；
//   - misc = [相位, 尺寸因子, 公转速度因子, 色散]，全部由 rng 驱动（同 seed 同输出）。

import { mulberry32 } from './rng.js';

export interface OrbCloud {
  count: number;
  pos: Float32Array; // count*3，带半径的位置（见文件头约定）
  misc: Float32Array; // count*4，[相位 0..1, 尺寸 0.6..1.4, 速度 0.5..1.5, 色散 0..1]
}

export interface OrbDesign {
  id: string;
  name: string;
  build(rng: () => number, n: number): OrbCloud;
}

const TAU = Math.PI * 2;

function makeCloud(n: number): OrbCloud {
  return { count: n, pos: new Float32Array(n * 3), misc: new Float32Array(n * 4) };
}

// 每点的公共随机量：相位 / 尺寸 / 速度 / 色散
function fillMisc(c: OrbCloud, rng: () => number, i: number): void {
  c.misc[i * 4] = rng();
  c.misc[i * 4 + 1] = 0.6 + 0.8 * rng();
  c.misc[i * 4 + 2] = 0.5 + rng();
  c.misc[i * 4 + 3] = rng();
}

// 球面均匀（Marsaglia）：拒绝采样在方形里找单位圆再抬升到球面
function sphereDir(rng: () => number): [number, number, number] {
  for (;;) {
    const a = rng() * 2 - 1;
    const b = rng() * 2 - 1;
    const s = a * a + b * b;
    if (s >= 1 || s === 0) continue;
    const f = 2 * Math.sqrt(1 - s);
    return [a * f, b * f, 1 - 2 * s];
  }
}

/** 均匀球面 + 轻微半径抖动（避免完美壳的单调感） */
function buildSphere(rng: () => number, n: number): OrbCloud {
  const c = makeCloud(n);
  for (let i = 0; i < n; i++) {
    const [x, y, z] = sphereDir(rng);
    const rr = 0.94 + 0.06 * rng();
    c.pos[i * 3] = x * rr;
    c.pos[i * 3 + 1] = y * rr;
    c.pos[i * 3 + 2] = z * rr;
    fillMisc(c, rng, i);
  }
  return c;
}

/** 环面：主轴在 xy 平面，随机相位决定绕管位置 */
function buildTorus(rng: () => number, n: number): OrbCloud {
  const c = makeCloud(n);
  const R = 0.72,
    r = 0.34;
  for (let i = 0; i < n; i++) {
    const u = rng() * TAU; // 绕主轴
    const v = rng() * TAU; // 绕管
    const rr = r * (0.92 + 0.16 * rng());
    const x = (R + rr * Math.cos(v)) * Math.cos(u);
    const y = (R + rr * Math.cos(v)) * Math.sin(u);
    const z = rr * Math.sin(v);
    c.pos[i * 3] = x;
    c.pos[i * 3 + 1] = y;
    c.pos[i * 3 + 2] = z;
    fillMisc(c, rng, i);
  }
  return c;
}

/** 球面双旋臂：极角 θ∈[0,π]，方位 φ = k·θ + arm·π，带宽随噪声起伏 */
function buildSpiral(rng: () => number, n: number): OrbCloud {
  const c = makeCloud(n);
  const k = 2.4; // 旋臂缠绕圈数
  for (let i = 0; i < n; i++) {
    const arm = i % 2 === 0 ? 0 : Math.PI;
    // 沿臂均匀推进 + 垂直臂方向的高斯散开
    const t = rng();
    const spread = (rng() + rng() + rng() - 1.5) * 0.22;
    const theta = Math.min(Math.max(t * Math.PI + spread * 0.9, 0.02), Math.PI - 0.02);
    const phi = k * theta + arm + spread;
    const x = Math.sin(theta) * Math.cos(phi);
    const y = Math.cos(theta);
    const z = Math.sin(theta) * Math.sin(phi);
    c.pos[i * 3] = x;
    c.pos[i * 3 + 1] = y;
    c.pos[i * 3 + 2] = z;
    fillMisc(c, rng, i);
  }
  return c;
}

/** 星轨盘：70% 扁盘（压扁 y）+ 30% 核球 */
function buildGalaxy(rng: () => number, n: number): OrbCloud {
  const c = makeCloud(n);
  for (let i = 0; i < n; i++) {
    let x: number, y: number, z: number;
    if (rng() < 0.7) {
      const a = rng() * TAU;
      const rr = Math.pow(rng(), 0.5) * 0.98;
      x = rr * Math.cos(a);
      z = rr * Math.sin(a);
      y = (rng() * 2 - 1) * 0.22;
    } else {
      const [sx, sy, sz] = sphereDir(rng);
      const rr = Math.pow(rng(), 0.7) * 0.5;
      x = sx * rr;
      y = sy * rr * 0.7;
      z = sz * rr;
    }
    c.pos[i * 3] = x;
    c.pos[i * 3 + 1] = y;
    c.pos[i * 3 + 2] = z;
    fillMisc(c, rng, i);
  }
  return c;
}

/** 晶格壳：立方网格落在壳层内的点，超出候选数时循环取样 + 微抖动 */
function buildLattice(rng: () => number, n: number): OrbCloud {
  const cand: Array<[number, number, number]> = [];
  const step = 0.5;
  for (let i = -7; i <= 7; i++)
    for (let j = -7; j <= 7; j++)
      for (let k = -7; k <= 7; k++) {
        const x = i * step,
          y = j * step,
          z = k * step;
        const l = Math.hypot(x, y, z);
        if (l > 2.6 && l < 3.4) cand.push([x / l, y / l, z / l]);
      }
  const c = makeCloud(n);
  for (let i = 0; i < n; i++) {
    const base = cand[(i * 7919) % cand.length]!; // 7919：与候选数互素的步长，散布取样
    const j = 0.02;
    c.pos[i * 3] = base[0]! + (rng() * 2 - 1) * j;
    c.pos[i * 3 + 1] = base[1]! + (rng() * 2 - 1) * j;
    c.pos[i * 3 + 2] = base[2]! + (rng() * 2 - 1) * j;
    fillMisc(c, rng, i);
  }
  return c;
}

// 顺序即「形态」选项的顺序；设计名与 manifest options 对齐（单测守护）
export const ORB_DESIGNS: OrbDesign[] = [
  { id: 'sphere', name: '球体', build: buildSphere },
  { id: 'torus', name: '环面', build: buildTorus },
  { id: 'spiral', name: '双旋臂', build: buildSpiral },
  { id: 'galaxy', name: '星轨盘', build: buildGalaxy },
  { id: 'lattice', name: '晶格壳', build: buildLattice },
];

/** 基础点数：density=1 时的点数；密度在引擎侧换算成实际点数 */
export const ORB_BASE_COUNT = 2400;

export function orbDesignByIndex(i: number): OrbDesign {
  return ORB_DESIGNS[Math.min(Math.max(i | 0, 0), ORB_DESIGNS.length - 1)]!;
}

/** 由 seed 构建某形态的点云（引擎缓存当前 / 目标两缓冲） */
export function buildOrbCloud(designIndex: number, density: number, seed: number): OrbCloud {
  const design = orbDesignByIndex(designIndex);
  const n = Math.max(64, Math.round(ORB_BASE_COUNT * density));
  return design.build(mulberry32(seed >>> 0), n);
}
