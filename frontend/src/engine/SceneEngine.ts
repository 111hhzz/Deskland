// 场景引擎：所有"场"主题（meadow / sky / aurora / beach）共用的底座。
// 共享：CPU 噪声、陆地场（图标周围的有符号距离场）、主循环渲染骨架、销毁。
// 天上的云与圆纹理在 CloudSceneEngine、人物与小猫在 ActorSceneEngine（均见各文件）；
// 海滩没有云，直接继承本类。
// 主题差异通过钩子注入，子类只写自己那部分：
//   static FS            片元着色器源码
//   defaultParams()      参数默认值
//   buildScenePalette()  从 theme.css 的 --scene-* 读出调色板
//   applyThemeUniforms(U) 主题特有的 uniform（草地的地面色 / 天空的时段）
//   prepareScene()       每帧绘制前的准备（meadow：人物 / 小猫）
//   drawScene(draw)      绘制编排（meadow：人物 + 猫；sky：只画一次）
//   sliders / displayKeys 面板配置（应用层 DeskApp 直接读取）
//
// 云钩子：uploadClouds / bindCloudUniforms / resetClouds / settleClouds / disposeClouds；
// 人物钩子：bindActorUniforms / disposeActor。默认均为空实现，由 CloudSceneEngine / ActorSceneEngine 覆盖。

import { BaseEngine } from './BaseEngine.js';
import type { EngineOpts, EngineParams, EngineStats } from './BaseEngine.js';
import { GLSL_VS } from './glsl/common.js';

const STEP = 5; // 陆地场的格子大小（px）
const MORPH_MS = 1800; // 图标挪动时、场在新旧两张之间过渡的时长
const TASKBAR = 48; // 任务栏高度（与 DeskApp 保持一致）

// ---- 类型 ----
// 画布别名：resize 时写入 _scale（CSS → 物理像素），渲染时换算 uRes
export type ScaledCanvas = HTMLCanvasElement & { _scale: number };
// 陆地场：s = 到海岸的有符号距离（<0 陆地）
export interface Field {
  s: Float32Array;
}
// 编译好的着色器程序 + uniform 表
export type Uniforms = Record<string, WebGLUniformLocation | null>;
export interface Program {
  p: WebGLProgram;
  U: Uniforms;
  cached: boolean;
}
// 图标矩形（中心 + 半宽半高），陆地场用它
export interface IconRect {
  cx: number;
  cy: number;
  hw: number;
  hh: number;
}
// 桌面图标：浏览器模式带 name/type/el，壁纸模式只有矩形
export interface IconItem {
  name?: string;
  type?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  el?: HTMLElement;
}
// 噪声场
export interface NoiseField {
  wx: Float32Array;
  wy: Float32Array;
}
// 场景调色板：theme.css 的 --scene-* 读出的 0-1 三元组，键由各主题自己定
export type ScenePalette = Record<string, number[]>;
// 面板配置（应用层 DeskApp 渲染与绑定）
export interface SliderDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  fmt: (v: number) => string;
  act?: string;
}
export interface DisplayKeyDef {
  key: string;
  min: number;
  max: number;
}
// 绘制编排回调：renderer 为要画的程序，withCat 表示是否带上小猫
export type SceneDraw = (renderer: Program, withCat: boolean) => void;
export interface SceneStats extends EngineStats {
  field: number;
  gpu: string;
  width: number;
  height: number;
}

// 数值参数读取：这些键由子类 defaultParams 保证存在且是数字（布尔开关不走这里）
export function numParam(params: EngineParams, key: string): number {
  const v = params[key];
  return typeof v === 'number' ? v : 0;
}

// ---- 纯函数助手（不依赖实例状态）----
const f32 = new Float32Array(1),
  u32 = new Uint32Array(f32.buffer);
function toHalf(v: number): number {
  f32[0] = v;
  const x = u32[0]!;
  const sign = (x >>> 16) & 0x8000,
    e = ((x >>> 23) & 0xff) - 112,
    m = x & 0x7fffff;
  if (e <= 0) return sign;
  if (e >= 31) return sign | 0x7c00;
  return sign | (e << 10) | (m >>> 13);
}

export class SceneEngine extends BaseEngine {
  static FS = ''; // 子类覆盖：片元着色器源码
  static TASKBAR = TASKBAR;
  private static _progCache?: Map<string, Program>;

  icons: IconItem[];
  _seed: number;
  W: number;
  H: number;
  Gw: number;
  Gh: number;
  NZ: NoiseField | null;
  fieldMs: number;
  ftex: Array<WebGLTexture | null>;
  fromI: number;
  toI: number;
  morphT0: number;
  morphDur: number;
  FA: Field | null;
  FB: Field | null;
  curMix: number;
  noiseTex: WebGLTexture | null;
  vao: WebGLVertexArrayObject | null;
  PR: Program | null;
  GPU: string;
  px: Uint8Array;
  sliders: SliderDef[];
  displayKeys: DisplayKeyDef[];
  scene: ScenePalette;
  _now: number; // 本帧的 rAF 时间戳（render 写入，主题准备阶段读取）

  constructor(canvas: HTMLCanvasElement, opts: EngineOpts = {}) {
    super(canvas, opts);
    this.icons = []; // 由 DeskApp 维护（引擎通过 iconRects() 读取）
    this._seed = (Math.random() * 1e6) | 0;
    this.W = innerWidth;
    this.H = innerHeight;
    this.Gw = 1;
    this.Gh = 1;
    this.NZ = null;
    this.fieldMs = 0;
    // 陆地场：两张纹理 from → to 之间插值
    this.ftex = [null, null];
    this.fromI = 0;
    this.toI = 0;
    this.morphT0 = -1e9;
    this.morphDur = MORPH_MS;
    this.FA = null;
    this.FB = null;
    this.curMix = 1;
    this.noiseTex = null;
    // 着色器 / GL 对象
    this.vao = null;
    this.PR = null;
    this.GPU = '';
    this.px = new Uint8Array(4);
    // 面板配置（应用层 DeskApp 读取；子类覆盖）
    this.sliders = [];
    this.displayKeys = [];
    // 场景调色板：从 theme.css 的 --scene-* 读取（0-1 的 r g b 或数值三元组）
    this.scene = this.buildScenePalette();
    this._now = 0;
  }

  /* ---- 子类钩子 ---- */
  override defaultParams(): EngineParams {
    return {};
  }
  buildScenePalette(): ScenePalette {
    return {};
  }
  applyThemeUniforms(_U: Uniforms): void {}
  prepareScene(): void {}
  drawScene(draw: SceneDraw): void {
    if (this.PR) draw(this.PR, false);
  }

  /* ---- 云钩子：由 CloudSceneEngine 覆盖；无云主题（海滩）不实现，调用为空操作 ---- */
  uploadClouds(_t: number): void {}
  bindCloudUniforms(_U: Uniforms): void {}
  resetClouds(): void {}
  settleClouds(): void {}
  disposeClouds(): void {}

  /* ---- 人物钩子：由 ActorSceneEngine 覆盖；无人物主题不实现 ---- */
  bindActorUniforms(_U: Uniforms, _withCat: boolean): void {}
  disposeActor(): void {}

  // 画布别名（迁移前页面里的 cv）
  get cv(): ScaledCanvas {
    return this.canvas as ScaledCanvas;
  }
  get seed(): number {
    return this._seed;
  }

  /* ======================================================================
     着色器与资源
     ====================================================================== */
  // 编译着色器：legacy 模块经 LegacyHost.program 调用它，因此用箭头函数保持 this
  program = (fs: string, vsSrc: string = GLSL_VS): Program => {
    const gl = this.gl;
    if (!gl) throw new Error('SceneEngine.program: WebGL2 上下文尚未初始化');
    // 同一 WebGL 上下文内（页内热切换）按 GLSL 复用已编译程序，省掉重复编译
    const key = vsSrc + '\n' + fs;
    if (!SceneEngine._progCache) SceneEngine._progCache = new Map();
    const cached = SceneEngine._progCache.get(key);
    if (cached) return cached;
    const mk = (type: number, src: string): WebGLShader => {
      const s = gl.createShader(type);
      if (!s) throw new Error('SceneEngine.program: createShader 失败');
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(s));
        throw new Error('shader');
      }
      return s;
    };
    const vs = mk(gl.VERTEX_SHADER, vsSrc),
      fss = mk(gl.FRAGMENT_SHADER, fs);
    const p = gl.createProgram();
    if (!p) throw new Error('SceneEngine.program: createProgram 失败');
    gl.attachShader(p, vs);
    gl.attachShader(p, fss);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(p));
    gl.deleteShader(vs);
    gl.deleteShader(fss); // 链接完成后 shader 对象不再需要（程序已保留）
    const U: Uniforms = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      if (!info) continue;
      const nm = info.name.replace(/\[0\]$/, '');
      U[nm] = gl.getUniformLocation(p, nm);
    }
    const r: Program = { p, U, cached: true };
    SceneEngine._progCache.set(key, r);
    return r;
  };

  override buildShaders(): void {
    const gl = this.gl;
    if (!gl) return;
    this.PR = this.program((this.constructor as typeof SceneEngine).FS);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao); // 全屏三角形用的是 gl_VertexID，不需要顶点属性
  }

  override buildResources(): void {
    const gl = this.gl;
    if (!gl) return;
    this.buildNoiseTex();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    this.GPU = String(name)
      .replace(/^ANGLE \([^,]+,\s*/, '')
      .replace(/\s*\(0x[0-9a-f]+\).*$/i, '')
      .replace(/\s*(Direct3D|vs_|OpenGL).*$/, '')
      .replace(/\(R\)|\(TM\)/g, '')
      .trim();
  }

  buildNoiseTex(): void {
    const { S, d } = this._makeNoiseImage();
    const gl = this.gl;
    if (!gl) return;
    this.noiseTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.noiseTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, S, S, 0, gl.RGBA, gl.UNSIGNED_BYTE, d);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  }

  /* ======================================================================
     尺寸
     ====================================================================== */
  override resize(): void {
    const cv = this.cv;
    this.W = innerWidth;
    this.H = innerHeight;
    // 预览模式：页面按整块桌面的尺寸排版、再整体缩小显示，所以画布只需要很低的分辨率
    const scale = this.opts.preview ? 0.45 : Math.min(devicePixelRatio || 1, numParam(this.params, 'quality'));
    // 按画布实际占的大小算（带小数：2560 宽的屏幕 150% 缩放是 1706.67，innerWidth 取整成 1707），
    // 不然画布比屏幕多出一个像素，浏览器会把整幅画缩放一下贴上去，又发糊
    const box = cv.getBoundingClientRect();
    cv.width = Math.round((box.width || this.W) * scale);
    cv.height = Math.round((box.height || this.H) * scale);
    cv._scale = scale;
    this.Gw = Math.ceil(this.W / STEP) + 2;
    this.Gh = Math.ceil(this.H / STEP) + 2;
    this.buildNoise();
    this.allocField();
  }

  // resize 事件之后的收尾（由 BaseEngine._onResize 调用；init 时的 resize 不经过这里）
  override afterResize(): void {
    // 壁纸 / 预览模式：图标来自宿主，场要按新的尺寸重算；云引擎同时重摆天上的云
    if (this.opts.wallpaper || this.opts.preview) {
      this.refresh();
      this.resetClouds();
    }
  }

  /* ======================================================================
     主循环钩子：update 只推状态，render 只画
     ====================================================================== */
  override update(_dt: number, now: number): void {
    const e = Math.min((now - this.morphT0) / this.morphDur, 1);
    this.curMix = e < 0.5 ? 2 * e * e : 1 - Math.pow(-2 * e + 2, 2) / 2;
  }

  override render(now: number): void {
    const gl = this.gl,
      cv = this.cv,
      P = this.params;
    if (!gl) return;
    this._now = now;
    // 主题 preparation（meadow：人物 / 小猫）必须在上传云之前，保持既有顺序
    this.prepareScene();
    // 云引擎在这里上传本帧的圆（两次绘制共享同一份数据，不额外重算）
    this.uploadClouds(this.sceneTime(now));
    const draw = (renderer: Program, withCat: boolean): void => {
      const { p, U } = renderer;
      gl.useProgram(p);
      gl.viewport(0, 0, cv.width, cv.height);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.noiseTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.ftex[this.fromI] ?? null);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.ftex[this.toI] ?? null);
      gl.uniform1i(U.uNoise ?? null, 0);
      gl.uniform1i(U.uFA ?? null, 1);
      gl.uniform1i(U.uFB ?? null, 2);
      gl.uniform2f(U.uRes ?? null, cv.width / cv._scale, cv.height / cv._scale); // 和画布的实际像素对齐（innerWidth、innerHeight 是取整过的）
      gl.uniform2f(U.uGrid ?? null, this.Gw, this.Gh);
      gl.uniform1f(U.uScale ?? null, cv._scale);
      gl.uniform1f(U.uSeed ?? null, (this._seed % 997) * 0.37);
      gl.uniform1f(U.uStep ?? null, STEP);
      gl.uniform1f(U.uMix ?? null, this.curMix);
      gl.uniform1f(U.uTime ?? null, this.sceneTime(now));
      gl.uniform1f(U.uDebug ?? null, P.debug ? 1 : 0);
      this.bindCloudUniforms(U);
      this.setSceneUniforms(U);
      this.bindActorUniforms(U, withCat);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    this.drawScene(draw);
    // 这里原来每 20 帧 readPixels 强制同步去测单帧耗时。实测（1920×1200）：
    // 同步使每帧从 ~1.7ms 涨到 ~18ms（meadow 18.3 / sky 17.8 / aurora 20.9），
    // 相当于每 20 帧卡一次，已移除。单帧耗时改用 bench()（含同步，仅调试用）。
  }

  setSceneUniforms(U: Uniforms): void {
    this.applyThemeUniforms(U);
  }

  /* ======================================================================
     陆地场（CPU）：s = 到海岸的有符号距离（<0 陆地）
     ====================================================================== */
  buildNoise(): void {
    const N = this.Gw * this.Gh;
    const NZ: NoiseField = { wx: new Float32Array(N), wy: new Float32Array(N) };
    this.NZ = NZ;
    for (let gy = 0; gy < this.Gh; gy++)
      for (let gx = 0; gx < this.Gw; gx++) {
        const i = gy * this.Gw + gx,
          x = gx * STEP,
          y = gy * STEP;
        NZ.wx[i] = this._fbm(x * 0.0028, y * 0.0028, 1) - 0.47;
        NZ.wy[i] = this._fbm(x * 0.0028, y * 0.0028, 2) - 0.47;
      }
  }

  computeField(rects: IconRect[]): Field {
    const t0 = performance.now();
    const N = this.Gw * this.Gh,
      f1 = new Float32Array(N);
    const NZ = this.NZ!;
    const sig = numParam(this.params, 'sigma'),
      is1 = 1 / (sig * sig);
    const wa = numParam(this.params, 'warp') * 2.2,
      wmax = wa * 0.5;
    for (const r of rects) {
      const R = 5.5 * sig + Math.max(r.hw, r.hh) * 0.5 + wmax;
      const gx0 = Math.max(0, Math.floor((r.cx - R) / STEP)),
        gx1 = Math.min(this.Gw - 1, Math.ceil((r.cx + R) / STEP));
      const gy0 = Math.max(0, Math.floor((r.cy - R) / STEP)),
        gy1 = Math.min(this.Gh - 1, Math.ceil((r.cy + R) / STEP));
      const chw = r.hw * 0.5,
        chh = r.hh * 0.5;
      for (let gy = gy0; gy <= gy1; gy++)
        for (let gx = gx0; gx <= gx1; gx++) {
          const i = gy * this.Gw + gx;
          const qx = gx * STEP + NZ.wx[i]! * wa,
            qy = gy * STEP + NZ.wy[i]! * wa;
          let dx = Math.abs(qx - r.cx) - chw,
            dy = Math.abs(qy - r.cy) - chh;
          if (dx < 0) dx = 0;
          if (dy < 0) dy = 0;
          f1[i] = f1[i]! + Math.exp(-(dx * dx + dy * dy) * is1);
        }
    }
    // 下限 = 计算范围边缘处的贡献值：范围内外算出的"离岸距离"一致，深海不会出现方框状的接缝
    const c0 = Math.sqrt(-Math.log(0.35)),
      s = new Float32Array(N),
      fMin = Math.exp(-30);
    for (let i = 0; i < N; i++) {
      const g = Math.log(Math.max(f1[i]!, fMin));
      s[i] = sig * (Math.sqrt(Math.max(-g, 0)) - c0) - sig * 0.6 * Math.max(g, 0);
    }
    this.fieldMs = performance.now() - t0;
    return { s };
  }

  sampleArr(a: Float32Array, x: number, y: number): number {
    const fx = Math.min(Math.max(x / STEP, 0), this.Gw - 1.001),
      fy = Math.min(Math.max(y / STEP, 0), this.Gh - 1.001);
    const ix = Math.floor(fx),
      iy = Math.floor(fy),
      tx = fx - ix,
      ty = fy - iy,
      i = iy * this.Gw + ix;
    return (
      (a[i]! * (1 - tx) + a[i + 1]! * tx) * (1 - ty) + (a[i + this.Gw]! * (1 - tx) + a[i + this.Gw + 1]! * tx) * ty
    );
  }

  // 当前的场（图标挪动时在新旧两张之间过渡）
  curS(x: number, y: number): number {
    return this.FB
      ? this.sampleArr(this.FA!.s, x, y) * (1 - this.curMix) + this.sampleArr(this.FB.s, x, y) * this.curMix
      : 999;
  }
  isWater(x: number, y: number): boolean {
    return this.curS(x, y) > 4;
  }

  iconRects(): IconRect[] {
    return this.icons.map((ic) => ({ cx: ic.x + ic.w / 2, cy: ic.y + ic.h / 2, hw: ic.w / 2 - 4, hh: ic.h / 2 - 2 }));
  }

  allocField(): void {
    const gl = this.gl;
    if (!gl) return;
    for (let i = 0; i < 2; i++) {
      const t = this.ftex[i];
      if (t) gl.deleteTexture(t);
      this.ftex[i] = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.ftex[i] ?? null);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, this.Gw, this.Gh, 0, gl.RED, gl.HALF_FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
  }

  uploadField(i: number, Fd: Field): void {
    const gl = this.gl;
    if (!gl) return;
    const d = new Uint16Array(this.Gw * this.Gh);
    for (let k = 0; k < d.length; k++) d[k] = toHalf(Fd.s[k]!);
    gl.bindTexture(gl.TEXTURE_2D, this.ftex[i] ?? null);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); // R16F 奇数宽度行也按紧凑数据上传
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.Gw, this.Gh, gl.RED, gl.HALF_FLOAT, d);
  }

  commit(fromEmpty = false): void {
    const nf = this.computeField(this.params.adaptive ? this.iconRects() : []);
    const target = 1 - this.toI;
    if (fromEmpty) {
      this.FA = this.computeField([]);
      this.uploadField(this.toI, this.FA);
    } else this.FA = this.FB;
    this.FB = nf;
    this.uploadField(target, this.FB);
    this.fromI = this.toI;
    this.toI = target;
    this.morphT0 = performance.now();
    this.morphDur = fromEmpty ? 2600 : MORPH_MS;
  }

  refresh(): void {
    this.FA = this.FB = this.computeField(this.params.adaptive ? this.iconRects() : []);
    this.uploadField(this.toI, this.FB);
    this.fromI = this.toI;
    this.morphT0 = -1e9;
  }

  hasField(): boolean {
    return !!this.FB;
  }
  setSeed(v: number): void {
    this._seed = v;
    this.buildNoise();
  }

  // 测试用：形态过渡直接走完并立刻画一帧。视觉基线把 performance.now 冻结了，
  // 页面只会画一帧，否则取到的可能是"图标还没就位"的那一帧。
  // 云（天上的云、图标云团的呼吸）由主循环的帧数决定，而冻结后到底跑了几帧并不确定
  // （同一份代码在隔离跑与整套跑里会落在两个状态）：云引擎用 settleClouds 把随机序列
  // 归位并重建一次云，让这一帧恒等于"正好跑了一帧"的状态，与帧数无关。
  settleAndRender(): void {
    window.__resetRand?.();
    this.morphT0 = -1e9;
    this.curMix = 1;
    this.settleClouds();
    this.render(performance.now());
  }

  /* ======================================================================
     统计 / 调试
     ====================================================================== */
  override getStats(): SceneStats {
    return {
      fps: this._fpsEMA,
      frame: this._frameMs,
      field: this.fieldMs,
      gpu: this.GPU,
      width: this.cv.width,
      height: this.cv.height,
    };
  }

  bench(): { frame: number; canvas: string; gpu: string } {
    const gl = this.gl;
    if (!gl) return { frame: 0, canvas: '0x0', gpu: this.GPU };
    const ts: number[] = [];
    for (let i = 0; i < 10; i++) {
      const a = performance.now();
      this.render(performance.now());
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.px);
      ts.push(performance.now() - a);
    }
    ts.sort((a, b) => a - b);
    return { frame: +ts[5]!.toFixed(1), canvas: this.cv.width + 'x' + this.cv.height, gpu: this.GPU };
  }

  /* ======================================================================
     销毁：清理本引擎创建的所有 WebGL 资源
     ====================================================================== */
  override dispose(): void {
    const gl = this.gl;
    if (!gl) return;
    if (this.vao) {
      gl.deleteVertexArray(this.vao);
      this.vao = null;
    }
    if (this.noiseTex) {
      gl.deleteTexture(this.noiseTex);
      this.noiseTex = null;
    }
    for (let i = 0; i < 2; i++) {
      const t = this.ftex[i];
      if (t) {
        gl.deleteTexture(t);
        this.ftex[i] = null;
      }
    }
    // program() 记录的所有程序（含 legacy 模块经 host.program 创建的）；缓存的程序跨引擎复用，不删
    // program 由静态 _progCache 持有（页内热切换跨引擎复用），不随引擎 dispose 释放；
    // 整页卸载时随 JS 堆与 WebGL 上下文一起回收。
    this.PR = null;
    this.NZ = null;
    this.FA = this.FB = null;
    this.disposeActor();
    this.disposeClouds();
  }

  /* ======================================================================
     CPU 噪声（hash2 / vnoise / fbm / tileNoise / tileFbm / makeNoiseImage）
     ====================================================================== */
  _hash2(x: number, y: number, k = 0): number {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(this._seed + k, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  _vnoise(x: number, y: number, k = 0): number {
    const ix = Math.floor(x),
      iy = Math.floor(y),
      fx = x - ix,
      fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx),
      uy = fy * fy * (3 - 2 * fy);
    const a = this._hash2(ix, iy, k),
      b = this._hash2(ix + 1, iy, k),
      c = this._hash2(ix, iy + 1, k),
      d = this._hash2(ix + 1, iy + 1, k);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  }
  _fbm(x: number, y: number, k = 0): number {
    let a = 0.5,
      s = 0;
    for (let i = 0; i < 4; i++) {
      s += a * this._vnoise(x, y, k + i * 7);
      x = x * 2.03 + 17.1;
      y = y * 2.03 + 17.1;
      a *= 0.5;
    }
    return s;
  }
  _tileNoise(x: number, y: number, px: number, py: number, k: number): number {
    const ix = Math.floor(x),
      iy = Math.floor(y),
      fx = x - ix,
      fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx),
      uy = fy * fy * (3 - 2 * fy);
    const m = (v: number, p: number): number => ((v % p) + p) % p;
    const x0 = m(ix, px),
      x1 = m(ix + 1, px),
      y0 = m(iy, py),
      y1 = m(iy + 1, py);
    const a = this._hash2(x0, y0, k),
      b = this._hash2(x1, y0, k),
      c = this._hash2(x0, y1, k),
      d = this._hash2(x1, y1, k);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  }
  _tileFbm(u: number, v: number, periods: number[], k: number): number {
    let s = 0,
      w = 0.5,
      tw = 0;
    for (let i = 0; i < periods.length; i++) {
      const p = periods[i]!;
      s += w * this._tileNoise(u * p, v * p, p, p, k + i * 13);
      tw += w;
      w *= 0.5;
    }
    return s / tw;
  }
  _makeNoiseImage(): { S: number; d: Uint8Array } {
    const S = 256,
      d = new Uint8Array(S * S * 4);
    const chans: number[][] = [
      [8, 16, 32, 64],
      [8, 16, 32, 64],
      [8, 16, 32],
      [16, 32, 64, 128],
    ];
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const u = x / S,
          v = y / S,
          i = (y * S + x) * 4;
        for (let c = 0; c < 4; c++) {
          let n = this._tileFbm(u, v, chans[c]!, 100 + c * 50);
          d[i + c] = Math.min(Math.max((n - 0.5) * 1.9 + 0.5, 0), 1) * 255;
        }
      }
    return { S, d };
  }
}
