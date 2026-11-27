// 星尘 · 点阵球：WebGL2 gl.POINTS 点精灵引擎。
//
// 交互模型参考 DiyarDesk thinking-orbs（MIT）：指针弹簧跟随 + insideEnergy + 点击涟漪；
// 形态 registry 在 scenes/orb/designs.ts（纯函数，可单测），指针物理在 scenes/orb/pointer.ts。
// 本引擎只做三件事：
//   1) 两 pass 渲染——背景（全屏三角形，渐变 + 球后辉光 + 暗角）+ 点阵（gl.POINTS，加法混合）；
//   2) 每帧推进自转 / 视差 / 指针物理 / 形态 morph；
//   3) 维护 A/B 两份点云，切形态时逐顶点插值过渡（点数不同则瞬切）；
//      过渡完成后把 B 提交为 A，保证下一次切换从当前形态起算（不闪回旧形态）。
// autoCycle 用内部 cycleDesign 记录实际形态（params.orbDesign 保持用户设置语义，不回写）。
//
// 与 SceneEngine 的边界：orb 没有海岸场，buildNoise / allocField / commit / refresh 全部空操作；
// hasField() 仍返回 true——DeskApp.applySettings 用它作派发门槛，false 会让滑块的自定义 act
// （design / rebuild）送不进 onSliderAction。isWater() 恒 false（点击涟漪由 pointerdown 命中球体触发）。

import { SceneEngine, numParam } from '../engine/SceneEngine.js';
import type { EngineOpts, EngineParams, PointerSnapshot } from '../engine/BaseEngine.js';
import { paramDefaults } from '../engine/paramDefs.js';
import { assertParamCoverage, paramDisplays, paramSliders } from '../engine/paramSchema.js';
import type { Program, ScenePalette, Uniforms } from '../engine/SceneEngine.js';
import { ORB_DESIGNS, buildOrbCloud } from './orb/designs.js';
import type { OrbCloud } from './orb/designs.js';
import { nextCycleIndex } from './orb/cycle.js';
import { MAX_RIPPLES, PointerField, RIPPLE_LIFE } from './orb/pointer.js';
import type { PointerEnv } from './orb/pointer.js';

const MORPH_S = 1.2; // 形态切换的逐顶点过渡时长（秒）
const CYCLE_S = 18; // autoCycle 自动轮换形态的周期（秒）
// 涟漪上限/生命期单一源于 orb/pointer.ts（GLSL 数组与打包共用）

// ---- 背景 pass：全屏三角形（GLSL_VS 用 gl_VertexID），片元画渐变 + 辉光 ----
const BG_FS = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uScale;
uniform vec3 uBgTop, uBgBot, uHalo;
uniform vec2 uCenter;
uniform float uRadius, uInside, uHover, uPtrValid, uDebug;
uniform vec2 uPtrPos;
out vec4 o;
void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y * uScale - gl_FragCoord.y) / uScale;
  float vy = clamp(p.y / uRes.y, 0.0, 1.0);
  vec3 col = mix(uBgBot, uBgTop, pow(vy, 0.85));
  float d = length(p - uCenter);
  // 球后径向辉光：指针靠近 / 进入球内时增强
  float halo = exp(-d * d / (uRadius * uRadius * 2.8));
  col += uHalo * halo * (0.42 + 0.30 * uHover + 0.20 * uInside);
  col += uHalo * 0.10 * exp(-d * d / (uRadius * uRadius * 0.8));
  // 暗角
  vec2 q = p / uRes - 0.5;
  col *= 1.0 - 0.55 * dot(q, q);
  if (uDebug > 0.5) {
    float ring = 1.0 - smoothstep(0.0, 2.5, abs(d - uRadius));
    col = mix(col, vec3(1.0, 0.35, 0.55), ring * 0.7);
    vec2 pd = abs(p - uPtrPos);
    float cross = (1.0 - smoothstep(0.0, 1.5, min(pd.x, pd.y))) * step(max(pd.x, pd.y), 12.0);
    col = mix(col, vec3(0.4, 1.0, 0.8), cross * 0.8 * uPtrValid);
  }
  o = vec4(col, 1.0);
}`;

// ---- 点阵 pass：gl.POINTS 顶点着色器 ----
// 每个点两套属性（A=当前形态，B=目标形态），uMorph 在两者间插值；
// 位移激励（指针斥力 + 涟漪）在“屏幕平面 CSS px”空间计算，保证与分辨率无关。
const PT_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosA;
layout(location=1) in vec4 aMiscA;
layout(location=2) in vec3 aPosB;
layout(location=3) in vec4 aMiscB;
uniform mat3 uRot;
uniform vec2 uRes;
uniform vec2 uCenter;
uniform float uRadius, uTime, uMorph, uHover, uInside, uGlow, uPxScale, uPtrValid;
uniform vec2 uPtrPos;
uniform vec4 uRips[${MAX_RIPPLES}];
out vec4 vMisc;
out float vAccent;
out float vFade;
out float vBoost;
const float POINT_BASE = 2.1; // 基础点径（CSS px）
const float RIPPLE_LIFE = ${RIPPLE_LIFE}; // 与 pointer.ts 单一源
void main() {
  // pos 自带半径（见 designs.ts），这里**不做归一化**，否则环面/星轨盘会退化
  vec3 dir = mix(aPosA, aPosB, uMorph);
  vec4 misc = mix(aMiscA, aMiscB, uMorph);
  // 呼吸：沿半径的微小脉动（不改形态）
  float ph = misc.x * 6.28318 + uTime * misc.z * 0.7;
  dir *= 1.0 + 0.05 * sin(ph);
  vec3 rp = uRot * dir;
  vec2 sp = uCenter + rp.xy * uRadius;
  // 指针斥力（参考 thinking-orbs 的磁场：推开门面朝向指针的点）
  float push = 0.0;
  if (uPtrValid > 0.5) {
    vec2 rel = sp - uPtrPos;
    float rd = length(rel);
    float range = uRadius * 0.85; // 磁场推挤半径（相对球半径；超出即无推力）
    push = pow(max(0.0, 1.0 - rd / range), 1.6) * (0.30 + 0.70 * uHover);
    sp += (rel / max(rd, 1e-3)) * push * uRadius * 0.34;
  }
  // 点击涟漪：扩散环经过处把点向外推并提亮
  float rip = 0.0;
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    vec4 r = uRips[i];
    if (r.w < 0.001) continue;
    float lifeT = clamp(r.z / RIPPLE_LIFE, 0.0, 1.0);
    vec2 dv = sp - r.xy;
    float dd = length(dv);
    float rr = lifeT * uRadius * 1.6;
    float band = exp(-pow(dd - rr, 2.0) / (uRadius * 0.045));
    float f = band * (1.0 - lifeT) * r.w;
    sp += (dv / max(dd, 1e-3)) * f * uRadius * 0.12;
    rip += f;
  }
  float persp = 2.4 / (2.4 - rp.z); // 简单透视：近大远小
  float size = POINT_BASE * misc.y * (1.0 + 0.7 * push + 0.6 * rip) * persp * uPxScale * (0.7 + 0.5 * uGlow);
  gl_PointSize = clamp(size, 1.0, 64.0);
  gl_Position = vec4(sp.x / uRes.x * 2.0 - 1.0, 1.0 - sp.y / uRes.y * 2.0, 0.0, 1.0);
  vMisc = misc;
  vAccent = clamp(push * 0.9 + rip * 0.8 + uInside * 0.12, 0.0, 1.0);
  vFade = 0.30 + 0.70 * smoothstep(-1.0, 0.7, rp.z); // 背面压暗，保留体积感
  vBoost = 0.75 + 0.55 * uGlow + 0.6 * push + 0.5 * rip;
}`;

// ---- 点阵 pass：片元（软边圆点，加法混合下输出预乘亮度）----
const PT_FS = `#version 300 es
precision highp float;
in vec4 vMisc;
in float vAccent;
in float vFade;
in float vBoost;
uniform vec3 uDotCol, uAccCol;
uniform float uTime;
out vec4 o;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  if (r > 1.0) discard;
  float soft = smoothstep(1.0, 0.12, r);
  float core = smoothstep(0.6, 0.0, r);
  float tw = 0.82 + 0.28 * sin(uTime * (0.7 + vMisc.z * 1.6) + vMisc.x * 6.28318);
  vec3 col = mix(uDotCol, uAccCol, vAccent) * vBoost * (0.85 + 0.45 * core) * tw;
  float a = soft * vFade;
  if (a < 0.004) discard;
  o = vec4(col * a, 1.0);
}`;

function mul3(a: ArrayLike<number>, b: ArrayLike<number>, out: Float32Array): void {
  // 3x3 列主序矩阵乘法：C = A·B
  for (let c = 0; c < 3; c++)
    for (let r = 0; r < 3; r++)
      out[c * 3 + r] = a[r]! * b[c * 3]! + a[3 + r]! * b[c * 3 + 1]! + a[6 + r]! * b[c * 3 + 2]!;
}

// updateRot 的复用矩阵（避免每帧分配）
const M3_RY = new Float32Array(9),
  M3_RX = new Float32Array(9),
  M3_RZ = new Float32Array(9),
  M3_TMP = new Float32Array(9);

export class OrbEngine extends SceneEngine {
  static override FS = BG_FS;

  private cloudA: OrbCloud | null = null;
  private bufA: WebGLBuffer | null = null;
  private bufB: WebGLBuffer | null = null;
  private ptVao: WebGLVertexArrayObject | null = null;
  private ptPR: Program | null = null;
  private pointer = new PointerField();
  private yaw = 0;
  private pitch = 0;
  private roll = 0;
  private morph = 1;
  private morphing = false;
  private orbMorphT0 = 0; // 基类已有 morphT0（陆地场用），点阵 morph 另起名字
  private morphTarget: OrbCloud | null = null; // 正在过渡的目标云；完成后提交为 cloudA
  private cycleDesign = 0; // 当前实际形态索引（autoCycle 用它推进，params.orbDesign 不回写）
  private cycleT = 0;
  private sceneT = 0; // 最近一帧的场景时间（指针事件 / 涟漪用它，免与 update 错位）
  private rot = new Float32Array(9);
  private rips = new Float32Array(MAX_RIPPLES * 4);
  private envCache: PointerEnv = { cx: 0, cy: 0, r: 0 };
  private boundPtr: Array<[EventTarget, string, EventListener]> = [];

  constructor(canvas: HTMLCanvasElement, opts: EngineOpts = {}) {
    super(canvas, opts);
    // 面板配置：数据面来自 PARAM_DEFS（theme.json.groups），此处只给 fmt / act
    this.sliders = paramSliders('orb', {
      sigma: { fmt: (v) => '×' + v.toFixed(2) },
      orbDesign: {
        fmt: (v) => ORB_DESIGNS[v]?.name ?? String(v),
        act: 'design',
      },
      density: { fmt: (v) => '×' + v.toFixed(2), act: 'rebuild' },
      speed: { fmt: (v) => '×' + v.toFixed(2) },
      hoverReaction: { fmt: (v) => '×' + v.toFixed(2) },
      glow: { fmt: (v) => Math.round(v * 100) + '%' },
    });
    this.displayKeys = paramDisplays('orb', ['autoCycle']); // 循环更换形态：设置项（theme.json）＋ orb.html 预览开关共用
    assertParamCoverage('orb', this.sliders, this.displayKeys);
  }

  override defaultParams(): EngineParams {
    // 开放参数默认值来自 PARAM_DEFS（= theme.json.groups）
    return {
      ...paramDefaults('orb'),
      quality: 2,
      debug: false,
      snap: true,
      cap30: true,
    };
  }

  override buildScenePalette(): ScenePalette {
    return {
      bgTop: this.sceneToken('--scene-bg-top'),
      bgBot: this.sceneToken('--scene-bg-bottom'),
      halo: this.sceneToken('--scene-halo'),
      dotCol: this.sceneToken('--scene-dot-core'),
      accCol: this.sceneToken('--scene-dot-accent'),
    };
  }

  override applyThemeUniforms(U: Uniforms): void {
    const gl = this.gl,
      S = this.scene;
    if (!gl) return;
    if (U.uBgTop && S.bgTop) gl.uniform3fv(U.uBgTop, S.bgTop);
    if (U.uBgBot && S.bgBot) gl.uniform3fv(U.uBgBot, S.bgBot);
    if (U.uHalo && S.halo) gl.uniform3fv(U.uHalo, S.halo);
    if (U.uDotCol && S.dotCol) gl.uniform3fv(U.uDotCol, S.dotCol);
    if (U.uAccCol && S.accCol) gl.uniform3fv(U.uAccCol, S.accCol);
  }

  /* ======================================================================
     orb 无场：这四个钩子是 DeskApp 的既有调用点，保持空实现 + hasField 恒 true
     ====================================================================== */
  override buildNoise(): void {}
  override allocField(): void {}
  override commit(_fromEmpty = false): void {}
  override refresh(): void {}
  override isWater(_x: number, _y: number): boolean {
    return false;
  }
  override hasField(): boolean {
    return true; // 见文件头说明：让 applySettings 的自定义 act 能派发到 onSliderAction
  }

  override setSeed(v: number): void {
    super.setSeed(v);
    // 换种子保持当前实际形态（autoCycle 可能已推进），并重置自动轮换计时
    this.rebuildCloud(this.cycleDesign);
    this.cycleT = 0;
  }

  // 面板 / 设置页的自定义动作：切形态、按新密度重建（DeskEngine 的可选钩子，非基类成员）
  onSliderAction(act: string): void {
    // 手动操作重置自动轮换计时；rebuild 保持当前实际形态（cycleDesign），不回跳 params.orbDesign
    this.cycleT = 0;
    if (act === 'design') this.morphTo(numParam(this.params, 'orbDesign') | 0, numParam(this.params, 'density'));
    else if (act === 'rebuild') this.rebuildCloud(this.cycleDesign);
  }

  /** 指针能力接口：快照结构与 __dbg.ptr() 既有输出一致（downFlag 映射为 down）；其他主题无此能力（返回 null） */
  override get pointerState(): PointerSnapshot | null {
    const p = this.pointer;
    return { active: p.active, down: p.downFlag, inside: p.inside, energy: p.energy, x: p.x, y: p.y };
  }

  /* ======================================================================
     资源：着色器程序 / VBO / 点云初建 / 指针监听
     ====================================================================== */
  override buildShaders(): void {
    super.buildShaders(); // 背景 program + 空 VAO（全屏三角形）
    const gl = this.gl;
    if (!gl) return;
    this.ptPR = this.program(PT_FS, PT_VS);
    this.ptVao = gl.createVertexArray();
    this.bufA = gl.createBuffer();
    this.bufB = gl.createBuffer();
    // 点阵 VAO：A / B 两套属性各自从一个缓冲读（morph 在着色器里插值）
    gl.bindVertexArray(this.ptVao);
    const bindPts = (buf: WebGLBuffer, locPos: number, locMisc: number): void => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(locPos);
      gl.vertexAttribPointer(locPos, 3, gl.FLOAT, false, 28, 0);
      gl.enableVertexAttribArray(locMisc);
      gl.vertexAttribPointer(locMisc, 4, gl.FLOAT, false, 28, 12);
    };
    bindPts(this.bufA, 0, 1);
    bindPts(this.bufB, 2, 3);
    gl.bindVertexArray(null);
  }

  override buildResources(): void {
    const gl = this.gl;
    if (!gl) return;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    this.GPU = String(name)
      .replace(/^ANGLE \([^,]+,\s*/, '')
      .replace(/\s*\(0x[0-9a-f]+\).*$/i, '')
      .replace(/\s*(Direct3D|vs_|OpenGL).*$/, '')
      .replace(/\(R\)|\(TM\)/g, '')
      .trim();
    this.installPointer();
    this.rebuildCloud();
  }

  private installPointer(): void {
    const on = (t: EventTarget, ty: string, fn: EventListener): void => {
      t.addEventListener(ty, fn);
      this.boundPtr.push([t, ty, fn]);
    };
    on(window, 'pointermove', ((e: PointerEvent) => this.pointer.move(e.clientX, e.clientY)) as EventListener);
    on(window, 'pointerdown', this.onPtrDown as EventListener);
    on(window, 'pointerup', ((e: PointerEvent) => {
      // 触摸没有 hover / leave 补发：抬起即视同离开，否则 inside 锁存会让自转一直加速
      if (e.pointerType === 'touch') this.pointer.leave();
      else this.pointer.release();
    }) as EventListener);
    // 系统手势取消 / 窗口失焦同样按离开处理（防 downFlag 与 inside 锁存）
    on(window, 'pointercancel', (() => this.pointer.leave()) as EventListener);
    on(window, 'blur', (() => this.pointer.leave()) as EventListener);
    on(document, 'pointerleave', (() => this.pointer.leave()) as EventListener);
  }

  private onPtrDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    // 点在图标 / 面板 / 任务栏上不当作球面交互（拖拽图标不会误触涟漪）
    const t = e.target as HTMLElement | null;
    if (t && typeof t.closest === 'function' && t.closest('.icon, #panel, #taskbar')) return;
    this.pointer.press(e.clientX, e.clientY);
    const env = this.env();
    if (Math.hypot(e.clientX - env.cx, e.clientY - env.cy) <= env.r * 1.15)
      this.pointer.addRipple(e.clientX, e.clientY, this.sceneT);
  };

  /** 球心 / 半径（CSS px）：以可用桌面区域（去掉任务栏）为基准，sigma 作尺寸系数 */
  private env(): PointerEnv {
    const sigma = numParam(this.params, 'sigma');
    const e = this.envCache;
    e.r = Math.max(40, Math.min(this.W, this.H - SceneEngine.TASKBAR) * 0.3 * sigma);
    e.cx = this.W / 2;
    e.cy = (this.H - SceneEngine.TASKBAR) / 2;
    return e;
  }

  /* ======================================================================
     点云：构建 / 上传 / 切换（morph）
     ====================================================================== */
  /** 按密度/种子重建点云（保持形态语义）。design 省略时取 params.orbDesign（仅首建路径）。 */
  private rebuildCloud(design = numParam(this.params, 'orbDesign') | 0): void {
    if (this.morphing && this.morphTarget) this.finishMorph(); // 先提交进行中的目标，避免回闪
    const gl = this.gl;
    const c = buildOrbCloud(design, numParam(this.params, 'density'), this._seed);
    this.cloudA = c;
    this.cycleDesign = design;
    this.morphTarget = null;
    this.morph = 1;
    this.morphing = false;
    if (gl && this.bufA && this.bufB) {
      this.uploadCloud(c, this.bufA);
      this.uploadCloud(c, this.bufB);
    }
  }

  /** 切到某形态：点数一致走逐顶点 morph，不一致直接瞬切（A←B←新云） */
  private morphTo(design: number, density: number): void {
    const gl = this.gl;
    if (!gl || !this.bufA || !this.bufB) return;
    if (this.morphing && this.morphTarget) this.finishMorph(); // 上一过渡未完成：先提交，避免回闪旧形态
    const c = buildOrbCloud(design | 0, density, this._seed);
    this.cycleDesign = design | 0;
    this.morphTarget = c;
    const cur = this.cloudA;
    if (cur && c.count === cur.count) {
      this.uploadCloud(c, this.bufB);
      this.orbMorphT0 = this.sceneT;
      this.morph = 0;
      this.morphing = true;
    } else {
      this.cloudA = c;
      this.morphTarget = null;
      this.uploadCloud(c, this.bufA);
      this.uploadCloud(c, this.bufB);
      this.morph = 1;
      this.morphing = false;
    }
  }

  /** 过渡结束：把目标云提交为 A，下次切换从当前形态起算 */
  private finishMorph(): void {
    this.morphing = false;
    this.morph = 1;
    const t = this.morphTarget;
    if (t && this.cloudA !== t) {
      this.cloudA = t;
      const gl = this.gl;
      if (gl && this.bufA) this.uploadCloud(t, this.bufA);
    }
    this.morphTarget = null;
  }

  private uploadCloud(c: OrbCloud, buf: WebGLBuffer): void {
    const gl = this.gl;
    if (!gl) return;
    const n = c.count,
      data = new Float32Array(n * 7);
    for (let i = 0; i < n; i++) {
      data[i * 7] = c.pos[i * 3]!;
      data[i * 7 + 1] = c.pos[i * 3 + 1]!;
      data[i * 7 + 2] = c.pos[i * 3 + 2]!;
      data[i * 7 + 3] = c.misc[i * 4]!;
      data[i * 7 + 4] = c.misc[i * 4 + 1]!;
      data[i * 7 + 5] = c.misc[i * 4 + 2]!;
      data[i * 7 + 6] = c.misc[i * 4 + 3]!;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  }

  private packRipples(): void {
    this.rips.fill(0);
    this.pointer.ripples.forEach((r, i) => {
      this.rips[i * 4] = r.x;
      this.rips[i * 4 + 1] = r.y;
      this.rips[i * 4 + 2] = Math.max(0, this.sceneT - r.t0);
      this.rips[i * 4 + 3] = r.str;
    });
  }

  /* ======================================================================
     主循环
     ====================================================================== */
  override update(dt: number, now: number): void {
    const P = this.params;
    this.sceneT = this.sceneTime(now);
    const env = this.env();
    this.pointer.step(dt, env, this.sceneT);

    // 自转：指针进入球内时按 hoverReaction 加速
    const react = numParam(P, 'hoverReaction');
    this.yaw += numParam(P, 'speed') * (0.35 + this.pointer.inside * react * 1.5) * dt;

    // 视差：指针相对球心的偏移 → pitch / roll 弹簧
    const pt = this.pointer.active ? clamp((this.pointer.ty - env.cy) / (env.cy * 1.6), -1, 1) * 0.4 : 0;
    const rl = this.pointer.active ? clamp(-(this.pointer.tx - env.cx) / (env.cx * 1.6), -1, 1) * 0.4 : 0;
    const k = 1 - Math.exp(-6 * dt);
    this.pitch += (pt - this.pitch) * k;
    this.roll += (rl - this.roll) * k;

    if (P.autoCycle === true) {
      this.cycleT += dt;
      if (this.cycleT >= CYCLE_S) {
        this.cycleT = 0;
        const next = nextCycleIndex(this.cycleDesign, ORB_DESIGNS.length);
        this.morphTo(next, numParam(P, 'density'));
      }
    } else this.cycleT = 0;

    if (this.morphing) {
      this.morph = Math.min((this.sceneT - this.orbMorphT0) / MORPH_S, 1);
      if (this.morph >= 1) this.finishMorph();
    }
    this.updateRot();
  }

  private updateRot(): void {
    const cy = Math.cos(this.yaw),
      sy = Math.sin(this.yaw),
      cp = Math.cos(this.pitch),
      sp = Math.sin(this.pitch),
      cr = Math.cos(this.roll),
      sr = Math.sin(this.roll);
    const ry = M3_RY,
      rx = M3_RX,
      rz = M3_RZ;
    ry.set([cy, 0, -sy, 0, 1, 0, sy, 0, cy]);
    rx.set([1, 0, 0, 0, cp, sp, 0, -sp, cp]);
    rz.set([cr, sr, 0, -sr, cr, 0, 0, 0, 1]);
    mul3(rx, ry, M3_TMP);
    mul3(rz, M3_TMP, this.rot);
  }

  override render(now: number): void {
    const gl = this.gl,
      cv = this.cv,
      P = this.params,
      bg = this.PR,
      pt = this.ptPR;
    if (!gl || !bg || !pt || !this.cloudA || !this.ptVao) return;
    const env = this.env(),
      W = cv.width / cv._scale,
      H = cv.height / cv._scale;

    // ---- 背景 ----
    gl.useProgram(bg.p);
    gl.bindVertexArray(this.vao);
    gl.viewport(0, 0, cv.width, cv.height);
    const ub = bg.U;
    gl.uniform2f(ub.uRes ?? null, W, H);
    gl.uniform1f(ub.uScale ?? null, cv._scale);
    this.applyThemeUniforms(ub);
    gl.uniform2f(ub.uCenter ?? null, env.cx, env.cy);
    gl.uniform1f(ub.uRadius ?? null, env.r);
    gl.uniform1f(ub.uInside ?? null, this.pointer.inside);
    gl.uniform1f(ub.uHover ?? null, this.pointer.energy);
    gl.uniform1f(ub.uPtrValid ?? null, this.pointer.active ? 1 : 0);
    gl.uniform2f(ub.uPtrPos ?? null, this.pointer.x, this.pointer.y);
    gl.uniform1f(ub.uDebug ?? null, P.debug ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // ---- 点阵 ----
    gl.useProgram(pt.p);
    gl.bindVertexArray(this.ptVao);
    const ut = pt.U;
    this.applyThemeUniforms(ut); // uDotCol / uAccCol（漏掉会让点色恒 0，加法混合下完全不可见）
    gl.uniformMatrix3fv(ut.uRot ?? null, false, this.rot);
    gl.uniform2f(ut.uRes ?? null, W, H);
    gl.uniform2f(ut.uCenter ?? null, env.cx, env.cy);
    gl.uniform1f(ut.uRadius ?? null, env.r);
    gl.uniform1f(ut.uTime ?? null, this.sceneTime(now));
    gl.uniform1f(ut.uMorph ?? null, this.morph);
    gl.uniform1f(ut.uHover ?? null, this.pointer.energy);
    gl.uniform1f(ut.uInside ?? null, this.pointer.inside);
    gl.uniform1f(ut.uGlow ?? null, numParam(P, 'glow'));
    gl.uniform1f(ut.uPxScale ?? null, cv._scale);
    gl.uniform1f(ut.uPtrValid ?? null, this.pointer.active ? 1 : 0);
    gl.uniform2f(ut.uPtrPos ?? null, this.pointer.x, this.pointer.y);
    this.packRipples();
    gl.uniform4fv(ut.uRips ?? null, this.rips);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArrays(gl.POINTS, 0, this.cloudA.count);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  /** 视觉基线用：过渡直接走完并立刻画一帧（冻结环境下恒等于“正好一帧”的状态） */
  override settleAndRender(): void {
    window.__resetRand?.();
    this.finishMorph();
    this.render(performance.now());
  }

  override dispose(): void {
    for (const [t, ty, fn] of this.boundPtr) {
      try {
        t.removeEventListener(ty, fn);
      } catch {
        /* 文档已卸载：忽略 */
      }
    }
    this.boundPtr = [];
    const gl = this.gl;
    if (gl) {
      if (this.ptVao) gl.deleteVertexArray(this.ptVao);
      if (this.bufA) gl.deleteBuffer(this.bufA);
      if (this.bufB) gl.deleteBuffer(this.bufB);
    }
    this.ptVao = null;
    this.bufA = this.bufB = null;
    this.ptPR = null;
    this.cloudA = null;
    super.dispose();
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}
