// 皮划艇群：在深水里慢慢划，互相避让。从 FlatEngine 抽出的纯逻辑（不碰 WebGL）。
// 依赖宿主引擎的场采样与值噪声（均为 SceneEngine 公共成员），经 host 接口注入。

const TASKBAR = 48;

export interface Kayak {
  x: number;
  y: number;
  h: number;
  v: number;
  ph: number;
  wander: number;
  fade: number;
}

export interface KayakHost {
  readonly W: number;
  readonly H: number;
  /** 当前插值后的陆地场采样（图标挪动时新旧场之间过渡） */
  curS(x: number, y: number): number;
  /** 值噪声（0..1） */
  _vnoise(x: number, y: number, k?: number): number;
}

export class KayakFlock {
  list: Kayak[] = [];

  constructor(private host: KayakHost) {}

  spawn(): Kayak | null {
    for (let t = 0; t < 400; t++) {
      const x = 60 + Math.random() * (this.host.W - 120),
        y = 60 + Math.random() * (this.host.H - TASKBAR - 120);
      if (this.host.curS(x, y) > 170 && this.list.every((k) => Math.hypot(k.x - x, k.y - y) > 160))
        return {
          x,
          y,
          h: Math.random() * Math.PI * 2,
          v: 7 + Math.random() * 4,
          ph: Math.random() * 6,
          wander: Math.random() * 100,
          fade: 0,
        };
    }
    return null;
  }

  /** want 为已按主题声明夹紧后的数量（0..4） */
  sync(want: number): void {
    while (this.list.length > want) this.list.pop();
    while (this.list.length < want) {
      const k = this.spawn();
      if (!k) break;
      this.list.push(k);
    }
  }

  step(dt: number): void {
    const clearance = 64; // 船身长 44px，连同划桨留出安全间距。
    const plans: { h: number; dx: number; dy: number }[] = [];
    for (let i = 0; i < this.list.length; i++) {
      const k = this.list[i];
      if (!k) continue;
      let heading = k.h;
      const ax = k.x + Math.cos(k.h) * 70,
        ay = k.y + Math.sin(k.h) * 70;
      const margin = ax < 40 || ay < 40 || ax > this.host.W - 40 || ay > this.host.H - TASKBAR - 40;
      if (this.host.curS(ax, ay) < 150 || margin) {
        // 转向更深的水 / 画面中间
        let gx = this.host.curS(k.x + 10, k.y) - this.host.curS(k.x - 10, k.y),
          gy = this.host.curS(k.x, k.y + 10) - this.host.curS(k.x, k.y - 10);
        if (margin) {
          gx += (this.host.W / 2 - k.x) * 0.02;
          gy += ((this.host.H - TASKBAR) / 2 - k.y) * 0.02;
        }
        let d = Math.atan2(gy, gx) - k.h;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        heading += Math.sign(d) * Math.min(Math.abs(d), 0.7 * dt);
      } else {
        k.wander += dt * 0.3;
        heading += (this.host._vnoise(k.wander, i * 10) - 0.5) * 0.25 * dt;
      }
      const fx = Math.cos(k.h),
        fy = Math.sin(k.h);
      let steerX = Math.cos(heading),
        steerY = Math.sin(heading),
        speed = 1,
        avoiding = false;
      for (let j = 0; j < this.list.length; j++) {
        if (i === j) continue;
        const other = this.list[j];
        if (!other) continue;
        const dx = other.x - k.x,
          dy = other.y - k.y;
        const distance = Math.hypot(dx, dy);
        if (distance > 210) continue;
        const rvx = Math.cos(other.h) * other.v - fx * k.v;
        const rvy = Math.sin(other.h) * other.v - fy * k.v;
        const closing = dx * rvx + dy * rvy;
        const ahead = Math.max(0, Math.min(7, -closing / Math.max(0.01, rvx * rvx + rvy * rvy)));
        const closest = Math.hypot(dx + rvx * ahead, dy + rvy * ahead);
        const risk = Math.max(
          0,
          Math.min(1, (110 - distance) / 46),
          closing < 0 ? (1 - Math.min(1, closest / 90)) * (1 - ahead / 8) : 0,
        );
        if (risk <= 0) continue;
        avoiding = true;
        // 相向时都向自己的右侧绕行；交叉或追尾时同时远离另一艘船。
        const awayX = distance > 0.001 ? -dx / distance : -fy;
        const awayY = distance > 0.001 ? -dy / distance : fx;
        steerX += (awayX * 2 - fy * 1.6) * risk;
        steerY += (awayY * 2 + fx * 1.6) * risk;
        if (dx * fx + dy * fy > 0 && closing < 0)
          speed = Math.min(speed, 0.25 + 0.75 * Math.max(0, Math.min(1, (distance - clearance) / 50)));
      }
      if (avoiding) {
        const d = Math.atan2(Math.sin(Math.atan2(steerY, steerX) - k.h), Math.cos(Math.atan2(steerY, steerX) - k.h));
        heading = k.h + Math.sign(d) * Math.min(Math.abs(d), dt);
      }
      k.ph += dt * 2.4;
      const v = k.v * (0.75 + 0.25 * Math.abs(Math.sin(k.ph))) * speed; // 划一下快一下
      plans.push({ h: heading, dx: Math.cos(heading) * v * dt, dy: Math.sin(heading) * v * dt });
    }
    // 根据同一帧的路线检查最近间距。极端相遇时减速，继续转向，不推开或瞬移船只。
    for (let pass = 0; pass < this.list.length; pass++) {
      for (let i = 0; i < this.list.length; i++)
        for (let j = i + 1; j < this.list.length; j++) {
          const a = plans[i],
            b = plans[j];
          if (!a || !b) continue;
          const dx = this.list[j]!.x - this.list[i]!.x,
            dy = this.list[j]!.y - this.list[i]!.y;
          const vx = b.dx - a.dx,
            vy = b.dy - a.dy,
            vv = vx * vx + vy * vy;
          const dot = dx * vx + dy * vy;
          if (dot >= 0 || vv < 1e-12) continue;
          const closestAt = Math.max(0, Math.min(1, -dot / vv));
          if (Math.hypot(dx + vx * closestAt, dy + vy * closestAt) >= clearance) continue;
          const gap = dx * dx + dy * dy - clearance * clearance;
          const fraction =
            gap <= 0
              ? 0
              : Math.max(0, Math.min(1, gap / (-dot + Math.sqrt(Math.max(0, dot * dot - vv * gap))) - 0.001));
          a.dx *= fraction;
          a.dy *= fraction;
          b.dx *= fraction;
          b.dy *= fraction;
        }
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const k = this.list[i],
        plan = plans[i];
      if (!k || !plan) continue;
      k.h = plan.h;
      k.x += plan.dx;
      k.y += plan.dy;
      if (this.host.curS(k.x, k.y) < 40) {
        const n = this.spawn();
        if (n) this.list[i] = n;
        else this.list.splice(i, 1);
      } // 被陆地"吞掉"就换个地方出现
    }
  }
}
