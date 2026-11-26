// orb 指针物理单测：弹簧跟随 / 能量包络 / 球内强度 / 涟漪生命期。
import { describe, expect, it } from 'vitest';
import { MAX_RIPPLES, PointerField, RIPPLE_LIFE } from './pointer.js';

const ENV = { cx: 500, cy: 400, r: 200 };

function run(p: PointerField, seconds: number, env = ENV): void {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) p.step(dt, env, t);
}

describe('PointerField', () => {
  it('弹簧跟随：目标位置最终收敛', () => {
    const p = new PointerField();
    p.move(800, 300);
    run(p, 1.5);
    expect(Math.hypot(p.x - 800, p.y - 300)).toBeLessThan(1);
  });

  it('未激活时能量衰减到 0；按下后升高', () => {
    const p = new PointerField();
    p.move(800, 300);
    run(p, 2);
    expect(p.energy).toBeGreaterThan(0.6);
    p.leave();
    run(p, 3);
    expect(p.energy).toBeLessThan(0.01);

    const q = new PointerField();
    q.press(800, 300);
    run(q, 2);
    expect(q.energy).toBeGreaterThan(0.9);
    q.release();
  });

  it('inside：球心为 1，远离球体为 0，过渡带平滑', () => {
    const center = new PointerField();
    center.move(ENV.cx, ENV.cy);
    run(center, 2);
    expect(center.inside).toBeGreaterThan(0.95);

    const edge = new PointerField();
    edge.move(ENV.cx + ENV.r * 0.58, ENV.cy); // 内圈边界
    run(edge, 2);
    expect(edge.inside).toBeGreaterThan(0.85);

    const far = new PointerField();
    far.move(ENV.cx + ENV.r * 3, ENV.cy);
    run(far, 3);
    expect(far.inside).toBeLessThan(0.05);
  });

  it('失活（leave）后 inside 归零：指针停在球内移出窗口', () => {
    const p = new PointerField();
    p.move(ENV.cx, ENV.cy);
    run(p, 2);
    expect(p.inside).toBeGreaterThan(0.95);
    p.leave();
    run(p, 1);
    expect(p.inside).toBeLessThan(0.01);
  });

  it('涟漪：上限 6 条、超龄清理', () => {
    const p = new PointerField();
    for (let i = 0; i < 8; i++) p.addRipple(i, 0, 0, 1);
    expect(p.ripples.length).toBe(MAX_RIPPLES);
    expect(p.ripples[0]!.x).toBe(2); // 最早的被挤出

    run(p, RIPPLE_LIFE + 0.2);
    expect(p.ripples.length).toBe(0);
  });
});
