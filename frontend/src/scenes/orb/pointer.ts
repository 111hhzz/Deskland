// 指针物理（纯 TS，无 DOM）：指针弹簧跟随 + 能量包络 + 球内强度 + 点击涟漪。
// 参考 DiyarDesk thinking-orbs 页的交互模型（弹簧系数 / insideEnergy 阈值 / ripple 生命期），
// 帧率无关（系数全部按 dt 指数衰减），行为可由 Vitest 直接断言。

export const RIPPLE_LIFE = 1.6; // 秒
export const MAX_RIPPLES = 6;
export const SPRING_K = 13; // 指针跟随弹簧（1/s）

export interface PointerEnv {
  cx: number; // 球心 x（CSS px）
  cy: number;
  r: number; // 球半径（CSS px）
}

export class PointerField {
  // 当前平滑位置与目标位置（CSS px）
  x = 0;
  y = 0;
  tx = 0;
  ty = 0;
  active = false; // 指针是否在窗口内（触摸设备无 hover，靠 down/up 维持）
  downFlag = false;
  energy = 0; // 0..1 交互强度包络（按下更强）
  inside = 0; // 0..1 指针在球内区域的渐变强度
  ripples: Array<{ x: number; y: number; t0: number; str: number }> = [];

  move(x: number, y: number): void {
    this.tx = x;
    this.ty = y;
    this.active = true;
  }

  press(x: number, y: number): void {
    this.downFlag = true;
    this.move(x, y);
  }

  release(): void {
    this.downFlag = false;
  }

  leave(): void {
    this.active = false;
    this.downFlag = false;
  }

  addRipple(x: number, y: number, now: number, str = 1): void {
    if (this.ripples.length >= MAX_RIPPLES) this.ripples.shift();
    this.ripples.push({ x, y, t0: now, str });
  }

  /**
   * 推进一步。now 为秒级场景时间（涟漪生命期用）。
   * inside 的判定带过渡带：球心到 0.58R 为 1，向外到 1.08R 线性衰减到 0。
   */
  step(dt: number, env: PointerEnv, now: number): void {
    const k = 1 - Math.exp(-SPRING_K * dt);
    this.x += (this.tx - this.x) * k;
    this.y += (this.ty - this.y) * k;

    const targetE = this.active ? (this.downFlag ? 1 : 0.72) : 0;
    const rate = targetE > this.energy ? 9 : 2.2; // 快起慢放
    this.energy += (targetE - this.energy) * (1 - Math.exp(-rate * dt));

    const d = Math.hypot(this.x - env.cx, this.y - env.cy);
    const inner = env.r * 0.58;
    // 失活（指针移出窗口 / 触摸抬起）时目标为 0，否则 inside 锁存会让自转持续加速、
    // halo/accent 残留——视差已按 active 门控，inside 同理。
    const t = !this.active ? 0 : d <= inner ? 1 : Math.max(0, 1 - (d - inner) / (env.r * 0.5));
    this.inside += (t - this.inside) * (1 - Math.exp(-8 * dt));

    while (this.ripples.length && now - this.ripples[0]!.t0 > RIPPLE_LIFE) this.ripples.shift();
  }
}
