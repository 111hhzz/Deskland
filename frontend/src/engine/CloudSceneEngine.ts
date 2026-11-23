// 云场景引擎：在 SceneEngine（噪声、陆地场、渲染骨架）之上加入「圆纹理 + 天上的云」。
// meadow / sky / aurora 这类"天空 + 云"的主题继承它；海滩（FlatEngine）没有云，直接继承 SceneEngine。
//
// 两套圆，每帧在 CPU 上算好（几百个），按格子分好上传成一张小纹理，着色器只读自己格子里的几个：
//   - 图标周围的云团：固定的格子里各放一个圆（随机位置、随机大小），圆心要在云团里面，越靠云边圆越小
//     → 边全是圆弧；圆的大小各自慢慢呼吸；图标挪动时跟着场平滑地长大 / 缩小
//   - 天上的小云：一朵朵完整的云，由大小不一的圆组成（底下一排、上面堆几个，底部较平），整朵随风飘

import { SceneEngine, numParam } from './SceneEngine.js';
import { CIRC_K, GRID_PAD } from './glsl/common.js';
import type { EngineOpts } from './BaseEngine.js';
import type { Uniforms } from './SceneEngine.js';

// 冻结帧里主循环首帧的 dt（见 BaseEngine._loop）：settleClouds 用同一个值重建云，
// 让测试帧与"首帧"完全一致。
const SETTLE_DT = 0.03;
const CELL_G = 48;      // 云格子大小（px，与 GLSL 的 uCellG 对应）；CIRC_K / GRID_PAD 在 glsl/common.ts

// ---- 类型 ----
// 天上的云：一朵由若干圆组成，整朵随风飘
export type Circle = [number, number, number, number];   // x, y, r, 相位
export interface SkyCloud { x: number; y: number; circles: Circle[]; v: number; grow: number; hw: number; dying: boolean; }
// 陆地场圆列表（扁平 4 元组：x, y, r, 相位）+ 重算时的画布尺寸
export interface MassList extends Array<number> { W?: number; H?: number; }
export interface CircStats { circles: number; maxPerCell: number; }

// 云的轮廓圆（无相位）与两层圆的大小区间
type BodyCircle = [number, number, number];
type Size2 = [number, number];
// 质量圆的过滤带：[下界, 上界, 按深度缩放]
type MassBand = [number, number, (ci: number) => number];

const sstep = (a: number, b: number, x: number): number => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

export class CloudSceneEngine extends SceneEngine {
  circTex: WebGLTexture | null;
  circBuf: Float32Array | null;
  cgW: number; cgH: number; circStats: CircStats | null;
  skyClouds: SkyCloud[];
  flowT: number;
  massList: MassList | null;
  massT: number;

  constructor(canvas: HTMLCanvasElement, opts: EngineOpts = {}) {
    super(canvas, opts);
    this.circTex = null; this.circBuf = null;
    this.cgW = 0; this.cgH = 0; this.circStats = null;
    this.skyClouds = []; this.flowT = 0;
    this.massList = null; this.massT = -1e9;
  }

  /* ---- SceneEngine 的云钩子 ---- */
  // 每帧把圆上传到纹理（SceneEngine.render 在 prepareScene 之后调用）
  override uploadClouds(t: number): void { this.uploadCircles(t); }

  // 圆纹理 / 云参数的绑定（SceneEngine.render 的 draw 里调用）
  override bindCloudUniforms(U: Uniforms): void {
    const gl = this.gl, P = this.params;
    if (!gl) return;
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.circTex);
    gl.uniform1i(U.uCirc ?? null, 3);
    gl.uniform2f(U.uCGrid ?? null, this.cgW, this.cgH); gl.uniform1f(U.uCellG ?? null, CELL_G);
    gl.uniform1f(U.uEdge ?? null, numParam(P, 'edge'));
  }

  // 云色调（基类 setSceneUniforms 只负责 applyThemeUniforms）
  override setSceneUniforms(U: Uniforms): void {
    super.setSceneUniforms(U);
    const gl = this.gl, S = this.scene;
    if (!gl) return;
    if (U.uShadow && S.shadow) gl.uniform3fv(U.uShadow, S.shadow);
    if (U.uCloudHi && S.cloudHi) gl.uniform3fv(U.uCloudHi, S.cloudHi);
    if (U.uCloudBody && S.cloudBody) gl.uniform3fv(U.uCloudBody, S.cloudBody);
    if (U.uCloudSh && S.cloudSh) gl.uniform3fv(U.uCloudSh, S.cloudSh);
    if (U.uLightDir && S.lightDir) gl.uniform2fv(U.uLightDir, S.lightDir);
    if (U.uShadowOff && S.shadowOff) gl.uniform2fv(U.uShadowOff, S.shadowOff);
  }

  override update(dt: number, now: number): void {
    super.update(dt, now);
    this.stepSkyClouds(dt);
  }

  // 尺寸变化时重摆天上的云（SceneEngine.afterResize 在壁纸 / 预览模式下调用）
  override resetClouds(): void {
    this.skyClouds.length = 0;
  }

  // 测试用：把云归位到"正好跑了一帧"的状态（settleAndRender 调用）
  override settleClouds(): void {
    this.massT = -1e9;
    this.skyClouds.length = 0;
    // flowT 是累加量：settle 前主循环可能已经跑过首帧，直接再 step 一次会变成两帧的相位。
    // 先归零，让这一帧恒等于"首帧"。
    this.flowT = 0;
    this.stepSkyClouds(SETTLE_DT);
  }

  override disposeClouds(): void {
    const gl = this.gl;
    if (!gl) return;
    if (this.circTex) { gl.deleteTexture(this.circTex); this.circTex = null; }
    this.circBuf = null; this.massList = null;
    this.skyClouds.length = 0;
  }

  /* ======================================================================
     云的圆
     ====================================================================== */
  makeSkyCloud(x: number): SkyCloud {
    const rnd = Math.random, R = 95 * 1.2;                 // 轮廓大一些（云厚一些，才放得下大圆）；圆的大小还是按 95 算
    // 1) 大致的轮廓：底下一排大圆（中间大、两边小），上面再堆几个 → 底宽上窄的一团
    const n = 3 + Math.floor(rnd() * 3), w = R * (1.0 + n * 0.5);
    const body: BodyCircle[] = [];
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : i / (n - 1) - 0.5, r = R * (0.6 - Math.abs(t) * 0.45 + rnd() * 0.12);
      body.push([t * w, -r * 0.55, r]);
    }
    for (let i = 0; i < n - 1; i++) {
      const t = n === 2 ? 0 : i / (n - 2) - 0.5, r = R * (0.55 + rnd() * 0.25);
      body.push([t * w * 0.6 + (rnd() - 0.5) * R * 0.4, -R * (0.5 + rnd() * 0.35), r]);
    }
    if (rnd() < 0.6) body.push([(rnd() - 0.5) * w * 0.3, -R * 1.05, R * (0.4 + rnd() * 0.15)]);
    // 离轮廓边多远（<0 在云里）
    const ciOf = (px: number, py: number): number => { let d = 1e9; for (const [cx, cy, r] of body) d = Math.min(d, Math.hypot(px - cx, py - cy) - r); return d; };
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const [cx, cy, r] of body) { x0 = Math.min(x0, cx - r); x1 = Math.max(x1, cx + r); y0 = Math.min(y0, cy - r); y1 = Math.max(y1, cy + r); }
    // 2) 和图标下方的云一样：每层一张格子、每格随机一个圆，圆心要在轮廓里，越靠边越小；
    //    小圆、很小的圆只长在靠边的一圈，而且要和比它大的圆叠住一截（不会有飘在外面的小点）
    const circles: Circle[] = [];
    const S = 0.62 / 1.2;                                     // 中圆的格子和原来一样大（59px）
    const layer = (G: number, size: Size2, band: number, bandFn: (ci: number) => number, attach: boolean): void => {
      for (let gy = Math.floor((y0 - G) / G); gy <= Math.ceil((y1 + G) / G); gy++) for (let gx = Math.floor((x0 - G) / G); gx <= Math.ceil((x1 + G) / G); gx++) {
        const px = (gx + 0.1 + rnd() * 0.8) * G, py = (gy + 0.1 + rnd() * 0.8) * G;
        const ci = ciOf(px, py);
        if (ci > 0 || ci < band) continue;
        let r = G * (size[0] + (size[1] - size[0]) * rnd()) * bandFn(ci);
        if (attach) {
          let att = 0;
          for (const [cx, cy, cr] of circles) att = Math.max(att, sstep(0.2 * r, 0.6 * r, cr + r - Math.hypot(cx - px, cy - py)));
          r *= att;
        }
        r *= sstep(5, 11, r);
        if (r > 0.5) circles.push([px, py, r, rnd()]);
      }
    };
    const Rm = R * S;
    // 大圆：只长在云厚的地方（圆心在轮廓里够深），云里就有几个大圆弧
    const Gb = 90;
    layer(Gb, [0.55, 0.85], -1e9, ci => sstep(-0.2 * Gb, -0.65 * Gb, ci), false);
    layer(Rm, [0.6, 0.95], -1e9, ci => sstep(-0.1 * Rm, -0.7 * Rm, ci), false);
    // 云的深处圆之间不能有缝：轮廓的大圆缩一点垫在底下
    for (const [cx, cy, r] of body) if (r > 0.75 * Rm) circles.push([cx, cy, r - 0.75 * Rm, rnd()]);
    layer(34 * 0.85, [0.5, 0.9], -1.0 * Rm, ci => sstep(-0.05 * Rm, -0.35 * Rm, ci) * (1 - sstep(-0.7 * Rm, -1.0 * Rm, ci)), true);
    layer(24 * 0.85, [0.45, 0.8], -0.6 * Rm, ci => sstep(0, -0.2 * Rm, ci) * (1 - sstep(-0.4 * Rm, -0.6 * Rm, ci)), true);
    const y = 80 + rnd() * (this.H - SceneEngine.TASKBAR - 120);
    return { x, y, circles, v: 0.7 + rnd() * 0.6, grow: 0, hw: Math.max(-x0, x1) + 20, dying: false };
  }

  stepSkyClouds(dt: number): void {
    this.flowT += dt * numParam(this.params, 'flow');                   // 云自己的时钟：流动速度越快，鼓包呼吸得也越快
    const want = Math.round(numParam(this.params, 'cover') * 10);
    // 数量变少：多出来的慢慢缩小消失；变多：直接在画面里淡入（找一块别的小云不太挤的地方）
    const alive = this.skyClouds.filter(c => !c.dying);
    for (let i = want; i < alive.length; i++) { const c = alive[i]; if (c) c.dying = true; }
    for (let n = alive.length; n < want; n++) {
      let best: SkyCloud | null = null, bestD = -1;
      for (let k = 0; k < 20; k++) {
        const c = this.makeSkyCloud(Math.random() * this.W);
        const dmin = Math.min(1e9, ...this.skyClouds.map(o => Math.hypot((o.x - c.x) / 1.6, o.y - c.y)));
        if (dmin > bestD) { bestD = dmin; best = c; }
      }
      if (best) this.skyClouds.push(best);
    }
    for (let i = this.skyClouds.length - 1; i >= 0; i--) {
      const c = this.skyClouds[i];
      if (!c) continue;
      c.x += numParam(this.params, 'flow') * 10 * c.v * dt;             // 流动速度 ×1 时约 10px/秒
      c.grow = c.dying ? c.grow - dt * 0.5 : Math.min(1, c.grow + dt * 0.5);
      if (c.grow <= 0) { this.skyClouds.splice(i, 1); continue; }
      // 飘出画面：从上风那边画面外重新飘进来
      if (c.x - c.hw > this.W + 50) { const n = this.makeSkyCloud(-c.hw - 50); n.grow = 1; this.skyClouds[i] = n; }
    }
  }

  buildMassCircles(): MassList {
    const list: MassList = [];
    // 图标周围的云团：三层圆（大 / 小 / 很小），每层是一张固定的格子，每格随机放一个圆。
    // 圆的基础大小只看圆心在云团里多深，图标不动就不变；显不显示也按基础大小决定，
    // 最后才乘上很轻（±4%）、很慢（一圈 50~70 秒）的"呼吸" → 圆的大小不会忽大忽小
    const R = 95;
    // big：大圆按格子存起来（用基础大小，不含呼吸），小圆要找得到挨着的大圆
    const big = new Map<string, BodyCircle>();
    const layer = (G: number, k0: number, size: Size2, band: MassBand, isBig: boolean): void => {
      if (!this.FB) return;
      for (let cy = -Math.ceil(2 * R / G); cy <= Math.ceil((this.H + 2 * R) / G); cy++) for (let cx = -Math.ceil(2 * R / G); cx <= Math.ceil((this.W + 2 * R) / G); cx++) {
        const ox = this._hash2(cx, cy, k0), oy = this._hash2(cx, cy, k0 + 1), rr = this._hash2(cx, cy, k0 + 2), ph = this._hash2(cx, cy, k0 + 3);
        const x = (cx + 0.1 + ox * 0.8) * G, y = (cy + 0.1 + oy * 0.8) * G;
        const ci = this.curS(x, y) - numParam(this.params, 'edge');     // 圆心处离云团边多远（<0 在云团里）
        if (ci > 0 || ci < band[1] - 10) continue;
        let r = G * (size[0] + (size[1] - size[0]) * rr) * band[2](ci);
        // 要和云团连在一起：碰得到主体（主体边在 ci = -0.6R 处），或（小圆）和某个大圆叠住一截
        const gap = ci + 0.6 * R;
        let att = sstep(gap - 4, gap + 12, r);
        if (!isBig) {
          const bx = Math.floor(x / R), by = Math.floor(y / R);
          for (let j = by - 1; j <= by + 1; j++) for (let i = bx - 1; i <= bx + 1; i++) {
            const o = big.get(i + ',' + j);
            if (!o) continue;
            const ov = o[2] + r - Math.hypot(o[0] - x, o[1] - y);        // 叠住了多少
            att = Math.max(att, sstep(0.2 * r, 0.6 * r, ov));
          }
        }
        r *= att;
        r *= sstep(5, 11, r);                                   // 太小的圆慢慢缩没，不留小点
        if (r < 0.5) continue;
        if (isBig) big.set(cx + ',' + cy, [x, y, r]);
        list.push(x, y, r * (1 + 0.04 * Math.sin(this.flowT * (0.09 + 0.035 * ph) + ph * 6.283)), ph);
      }
    };
    // 大圆：圆心在云团里，越靠云边越小
    layer(R, 1, [0.55, 0.9], [0, -1e9, ci => sstep(-0.15 * R, -0.8 * R, ci)], true);
    // 小圆：靠云边的一圈（再往里会被大圆盖住，看不见）
    layer(34, 11, [0.5, 0.9], [0, -1.0 * R, ci => sstep(-0.05 * R, -0.3 * R, ci) * (1 - sstep(-0.7 * R, -1.0 * R, ci))], false);
    // 很小的圆：贴着云边一圈，让轮廓上的小鼓包更多
    layer(24, 21, [0.45, 0.8], [0, -0.6 * R, ci => sstep(0, -0.15 * R, ci) * (1 - sstep(-0.4 * R, -0.6 * R, ci))], false);
    return list;
  }

  // 云里的圆在动：每个圆绕着原来的位置慢慢转一个小圈（约 6~15px，大圆动得多一点，一圈 20~30 秒）。
  // 相邻的圆大致朝同一个方向走（整团云在轻轻翻动），每个圆再带一点自己的小动作。只动位置、不动大小
  wobX(x: number, y: number, r: number, ph: number): number { return (4.5 + 0.12 * r) * (0.85 * Math.sin(this.flowT * 0.24 + x * 0.011 + y * 0.004) + 0.3 * Math.sin(this.flowT * 0.3 + ph * 6.283)); }
  wobY(x: number, y: number, r: number, ph: number): number { return (4.5 + 0.12 * r) * (0.65 * Math.sin(this.flowT * 0.2 + y * 0.013 - x * 0.006 + 1.7) + 0.25 * Math.cos(this.flowT * 0.28 + ph * 6.283)); }

  uploadCircles(t: number): void {
    const gl = this.gl;
    if (!gl) return;
    gl.activeTexture(gl.TEXTURE3);                            // 用第 3 号纹理单元，不要动到别的纹理
    // 左、上多 GRID_PAD 格（右下方的云影要用到画面外的云），右、下多 GRID_PAD - 1 格
    const gw = Math.ceil(this.W / CELL_G) + GRID_PAD + (GRID_PAD - 1), gh = Math.ceil(this.H / CELL_G) + GRID_PAD + (GRID_PAD - 1);
    if (!this.circTex || gw !== this.cgW || gh !== this.cgH) {
      this.cgW = gw; this.cgH = gh;
      if (this.circTex) gl.deleteTexture(this.circTex);
      this.circTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.circTex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, gw * CIRC_K, gh);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      this.circBuf = new Float32Array(gw * CIRC_K * gh * 4);
    }
    const buf = this.circBuf;
    if (!buf) return;
    // 图标周围云团的圆：只在图标挪动时（场在过渡）每帧重算，平时每 0.5 秒重算一次（呼吸很慢，看不出跳）
    const morphing = this.curMix < 1 || !this.massList || this.massList.W !== this.W || this.massList.H !== this.H;
    if (morphing || t - this.massT > 0.5) { this.massList = this.buildMassCircles(); this.massList.W = this.W; this.massList.H = this.H; this.massT = t; }
    const mass = this.massList;
    if (!mass) return;
    const list = mass.slice();
    for (let i = 0; i < list.length; i += 4) {
      const x = list[i]!, y = list[i + 1]!, r = list[i + 2]!, ph = list[i + 3]!;
      list[i] = x + this.wobX(x, y, r, ph); list[i + 1] = y + this.wobY(x, y, r, ph);
    }
    // 天上的小云
    for (const c of this.skyClouds) {
      const g = c.grow * c.grow * (3 - 2 * c.grow);
      c.circles.forEach(([dx, dy, r, ph], i) => {
        const rb = r * g * (1 + 0.04 * Math.sin(this.flowT * (0.09 + 0.035 * ph) + ph * 6.283 + i));
        if (rb > 0.5) list.push(c.x + dx + this.wobX(dx, dy, r, ph), c.y + dy + this.wobY(dx, dy, r, ph), rb, ph);   // 天上的云：按云自己的坐标算，整朵飘的时候也在轻轻翻动
      });
    }
    // 分到格子里（圆盖到的每个格子都放一份；一个格子放不下就留大的）
    buf.fill(0);
    const cnt = new Uint8Array(gw * gh);
    const order: number[] = [];
    for (let i = 0; i < list.length; i += 4) order.push(i);
    order.sort((a, b) => list[b + 2]! - list[a + 2]!);
    for (const i of order) {
      const x = list[i]!, y = list[i + 1]!, r = list[i + 2]! + 6;
      const x0 = Math.max(0, Math.floor((x - r) / CELL_G) + GRID_PAD), x1 = Math.min(gw - 1, Math.floor((x + r) / CELL_G) + GRID_PAD);
      const y0 = Math.max(0, Math.floor((y - r) / CELL_G) + GRID_PAD), y1 = Math.min(gh - 1, Math.floor((y + r) / CELL_G) + GRID_PAD);
      for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) {
        const ci = gy * gw + gx;
        const nx = Math.max((gx - GRID_PAD) * CELL_G, Math.min(x, (gx - (GRID_PAD - 1)) * CELL_G)), ny = Math.max((gy - GRID_PAD) * CELL_G, Math.min(y, (gy - (GRID_PAD - 1)) * CELL_G));
        if ((nx - x) * (nx - x) + (ny - y) * (ny - y) > r * r) continue;   // 圆碰不到这个格子
        if ((cnt[ci] ?? 0) >= CIRC_K) continue;
        const o = ((gy * gw + gx) * CIRC_K + (cnt[ci] ?? 0)) * 4;
        buf[o] = x; buf[o + 1] = y; buf[o + 2] = list[i + 2]!; buf[o + 3] = list[i + 3]!;
        cnt[ci] = (cnt[ci] ?? 0) + 1;
      }
    }
    this.circStats = { circles: list.length / 4, maxPerCell: Math.max(...cnt) };
    gl.bindTexture(gl.TEXTURE_2D, this.circTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gw * CIRC_K, gh, gl.RGBA, gl.FLOAT, buf);
  }
}
