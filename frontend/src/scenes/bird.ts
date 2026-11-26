// 海鸟群：在画面上空滑翔，时而盘旋、时而扇几下翅膀；飞出画面会兜回来。
// 从 FlatEngine 抽出的纯逻辑（不碰 WebGL），依赖宿主引擎的尺寸与值噪声。

const TASKBAR = 48;

export interface Bird {
  x: number;
  y: number;
  h: number;
  v: number;
  mode: number;
  modeT: number;
  ph: number;
  flap: boolean;
  flapT: number;
  wander: number;
}

export interface BirdHost {
  readonly W: number;
  readonly H: number;
  /** 值噪声（0..1） */
  _vnoise(x: number, y: number, k?: number): number;
}

export class BirdFlock {
  list: Bird[] = [];

  constructor(private host: BirdHost) {}

  spawn(fromEdge: boolean): Bird {
    const H2 = this.host.H - TASKBAR;
    let x = Math.random() * this.host.W,
      y = Math.random() * H2;
    if (fromEdge) {
      // 从画面外飞进来
      const side = Math.floor(Math.random() * 4);
      if (side === 0) x = -40;
      else if (side === 1) x = this.host.W + 40;
      else if (side === 2) y = -40;
      else y = H2 + 40;
    }
    const h = Math.atan2(H2 / 2 - y, this.host.W / 2 - x) + (Math.random() - 0.5) * 1.2;
    return {
      x,
      y,
      h,
      v: 36 + Math.random() * 16,
      mode: 0,
      modeT: 2 + Math.random() * 4,
      ph: 0,
      flap: false,
      flapT: Math.random() * 3,
      wander: Math.random() * 100,
    };
  }

  /** want 为已按主题声明夹紧后的数量（0..8） */
  sync(want: number, fromEdge = true): void {
    while (this.list.length > want) this.list.pop();
    while (this.list.length < want) this.list.push(this.spawn(fromEdge));
  }

  step(dt: number): void {
    const H2 = this.host.H - TASKBAR,
      m = 90;
    const turnToward = (h: number, target: number, rate: number): number => {
      let d = target - h;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      return h + Math.sign(d) * Math.min(Math.abs(d), rate);
    };
    this.list.forEach((b, i) => {
      if ((b.modeT -= dt) <= 0) {
        // 换一种飞法：直飞 / 向左或向右盘旋
        b.mode = Math.random() < 0.4 ? (Math.random() < 0.5 ? -1 : 1) : 0;
        b.modeT = b.mode ? 4 + Math.random() * 6 : 3 + Math.random() * 5;
      }
      b.wander += dt * 0.4;
      if (b.x < -m || b.x > this.host.W + m || b.y < -m || b.y > H2 + m)
        b.h = turnToward(b.h, Math.atan2(H2 / 2 - b.y, this.host.W / 2 - b.x), 1.3 * dt);
      else b.h += (b.mode * 0.55 + (this.host._vnoise(b.wander, i * 7.3) - 0.5) * 0.8) * dt;
      if ((b.flapT -= dt) <= 0) {
        b.flap = !b.flap;
        b.flapT = b.flap ? 0.8 + Math.random() * 1.2 : 2.5 + Math.random() * 4;
      }
      if (b.flap || Math.cos(b.ph) < 0.97) b.ph = (b.ph + dt * 9) % (Math.PI * 2); // 停下时把这一下扇完
      const v = b.v * (b.flap ? 1.15 : 1);
      b.x += Math.cos(b.h) * v * dt;
      b.y += Math.sin(b.h) * v * dt;
    });
  }
}
