// 场景引擎：meadow / sky 等"同一个场 + 同一套云"的主题共用这套机制。
// 共享：CPU 噪声、陆地场（图标周围的云形）、云的圆、主循环渲染骨架、销毁。
// 主题差异通过钩子注入，子类只写自己那部分：
//   static FS            片元着色器源码
//   defaultParams()      参数默认值
//   buildScenePalette()  从 theme.css 的 --scene-* 读出调色板
//   applyThemeUniforms(U) 主题特有的 uniform（草地的地面色 / 天空的时段）
//   prepareScene()       每帧绘制前的准备（meadow：人物 / 小猫）
//   drawScene(draw)      绘制编排（meadow：人物 + 猫；sky：只画一次）
//   sliders / displayKeys 面板配置（应用层 DeskApp 直接读取）
//
// 过渡期约定：渲染上下文（gl/cv/program）与共享状态由 DeskApp 挂到 window，
// 让 meadow-boy.js / meadow-cat.js 等旧脚本继续以全局方式读取。

import { BaseEngine } from './BaseEngine.js';

const STEP = 5;          // 陆地场的格子大小（px）
const MORPH_MS = 1800;   // 图标挪动时、场在新旧两张之间过渡的时长
const TASKBAR = 48;      // 任务栏高度（与 DeskApp 保持一致）
const CELL_G = 48, CIRC_K = 36;

const VS_SRC = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// ---- 纯函数助手（不依赖实例状态）----
const sstep = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
function toHalf(v) {
  f32[0] = v; const x = u32[0];
  const sign = (x >>> 16) & 0x8000, e = ((x >>> 23) & 0xff) - 112, m = x & 0x7fffff;
  if (e <= 0) return sign;
  if (e >= 31) return sign | 0x7c00;
  return sign | (e << 10) | (m >>> 13);
}

export class SceneEngine extends BaseEngine {
  static FS = '';            // 子类覆盖：片元着色器源码
  static TASKBAR = TASKBAR;

  constructor(canvas, opts = {}) {
    super(canvas, opts);
    this.icons = [];                       // 由 DeskApp 维护（引擎通过 iconRects() 读取）
    this._seed = (Math.random() * 1e6) | 0;
    this.W = innerWidth; this.H = innerHeight;
    this.Gw = 1; this.Gh = 1; this.NZ = null;
    this.fieldMs = 0;
    // 陆地场：两张纹理 from → to 之间插值
    this.ftex = [null, null];
    this.fromI = 0; this.toI = 0; this.morphT0 = -1e9; this.morphDur = MORPH_MS;
    this.FA = null; this.FB = null; this.curMix = 1;
    // 云
    this.noiseTex = null; this.circTex = null; this.circBuf = null;
    this.cgW = 0; this.cgH = 0; this.circStats = null;
    this.skyClouds = []; this.flowT = 0;
    this.massList = null; this.massT = -1e9;
    // 着色器 / GL 对象
    this.vao = null; this.PR = null;
    this._programs = new Set();            // program() 创建的所有程序（含 boy/cat 脚本创建的），dispose 时统一删除
    this.GPU = '';
    this.px = new Uint8Array(4);
    // 人物 / 小猫（meadow 用；sky 留空 → 相关 uniform 不会被绑定）
    this.actorPR = this.catPR = this.catActorPR = null;
    this.actorTex = this.actorShadowTex = null; this.actorRect = null;
    this.catTex = null; this.catRect = null; this.catShadow = null; this.catTail = 0;
    // 面板配置（应用层 DeskApp 读取；子类覆盖）
    this.sliders = [];
    this.displayKeys = [];
    // 场景调色板：从 theme.css 的 --scene-* 读取（0-1 的 r g b 或数值三元组）
    this.scene = this.buildScenePalette();
  }

  /* ---- 子类钩子 ---- */
  defaultParams() { return {}; }
  buildScenePalette() { return {}; }
  applyThemeUniforms(U) {}
  prepareScene() {}
  drawScene(draw) { draw(this.PR, false); }

  // 画布别名（迁移前页面里的 cv）
  get cv() { return this.canvas; }
  get seed() { return this._seed; }

  /* ======================================================================
     着色器与资源
     ====================================================================== */
  // 编译着色器：boy/cat 脚本也通过 window.program 调用它（过渡期），因此用箭头函数保持 this
  program = (fs, vsSrc = VS_SRC) => {
    const gl = this.gl;
    // 同一 WebGL 上下文内（页内热切换）按 GLSL 复用已编译程序，省掉重复编译
    const key = vsSrc + '\n' + fs;
    if (!SceneEngine._progCache) SceneEngine._progCache = new Map();
    let cached = SceneEngine._progCache.get(key);
    if (cached) { this._programs.add(cached); return cached; }
    const mk = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(s)); throw new Error('shader'); }
      return s;
    };
    const vs = mk(gl.VERTEX_SHADER, vsSrc), fss = mk(gl.FRAGMENT_SHADER, fs);
    const p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fss);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(p));
    gl.deleteShader(vs); gl.deleteShader(fss);   // 链接完成后 shader 对象不再需要（程序已保留）
    const U = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const nm = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, ''); U[nm] = gl.getUniformLocation(p, nm); }
    const r = { p, U, cached: true };
    SceneEngine._progCache.set(key, r);
    this._programs.add(r);
    return r;
  };

  buildShaders() {
    this.PR = this.program(this.constructor.FS);
    this.vao = this.gl.createVertexArray();
    this.gl.bindVertexArray(this.vao);          // 全屏三角形用的是 gl_VertexID，不需要顶点属性
  }

  buildResources() {
    this.buildNoiseTex();
    const ext = this.gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? this.gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : this.gl.getParameter(this.gl.RENDERER);
    this.GPU = name.replace(/^ANGLE \([^,]+,\s*/, '').replace(/\s*\(0x[0-9a-f]+\).*$/i, '')
      .replace(/\s*(Direct3D|vs_|OpenGL).*$/, '').replace(/\(R\)|\(TM\)/g, '').trim();
  }

  buildNoiseTex() {
    const { S, d } = this._makeNoiseImage();
    const gl = this.gl;
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
  resize() {
    const cv = this.cv;
    this.W = innerWidth; this.H = innerHeight;
    // 预览模式：页面按整块桌面的尺寸排版、再整体缩小显示，所以画布只需要很低的分辨率
    const scale = this.opts.preview ? 0.45 : Math.min(devicePixelRatio || 1, this.params.quality);
    // 按画布实际占的大小算（带小数：2560 宽的屏幕 150% 缩放是 1706.67，innerWidth 取整成 1707），
    // 不然画布比屏幕多出一个像素，浏览器会把整幅画缩放一下贴上去，又发糊
    const box = cv.getBoundingClientRect();
    cv.width = Math.round((box.width || this.W) * scale);
    cv.height = Math.round((box.height || this.H) * scale);
    cv._scale = scale;
    this.Gw = Math.ceil(this.W / STEP) + 2; this.Gh = Math.ceil(this.H / STEP) + 2;
    this.buildNoise();
    this.allocField();
  }

  // resize 事件之后的收尾（由 BaseEngine._onResize 调用；init 时的 resize 不经过这里）
  afterResize() {
    // 壁纸 / 预览模式：图标来自宿主，场要按新的尺寸重算、天上的云也要重新摆放
    if (this.opts.wallpaper || this.opts.preview) { this.refresh(); this.skyClouds.length = 0; }
  }

  /* ======================================================================
     主循环钩子：update 只推状态，render 只画
     ====================================================================== */
  update(dt, now) {
    const e = Math.min((now - this.morphT0) / this.morphDur, 1);
    this.curMix = e < 0.5 ? 2 * e * e : 1 - Math.pow(-2 * e + 2, 2) / 2;
    this.stepSkyClouds(dt);
  }

  render(now) {
    const gl = this.gl, cv = this.cv, P = this.params;
    this._now = now;
    // 主题 preparation（meadow：人物 / 小猫）必须在上传云之前，保持既有顺序
    this.prepareScene();
    // 两次绘制共享本帧云数据，不额外重算、上传云团。
    this.uploadCircles(this.sceneTime(now));
    const draw = (renderer, withCat) => {
      const { p, U } = renderer;
      gl.useProgram(p);
      gl.viewport(0, 0, cv.width, cv.height);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.noiseTex);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.ftex[this.fromI]);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.ftex[this.toI]);
      gl.uniform1i(U.uNoise, 0); gl.uniform1i(U.uFA, 1); gl.uniform1i(U.uFB, 2);
      gl.uniform2f(U.uRes, cv.width / cv._scale, cv.height / cv._scale);   // 和画布的实际像素对齐（innerWidth、innerHeight 是取整过的）
      gl.uniform2f(U.uGrid, this.Gw, this.Gh);
      gl.uniform1f(U.uScale, cv._scale);
      gl.uniform1f(U.uSeed, (this._seed % 997) * 0.37);
      gl.uniform1f(U.uStep, STEP);
      gl.uniform1f(U.uMix, this.curMix);
      gl.uniform1f(U.uTime, this.sceneTime(now));
      gl.uniform1f(U.uDebug, P.debug ? 1 : 0);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.circTex); gl.uniform1i(U.uCirc, 3);
      gl.uniform2f(U.uCGrid, this.cgW, this.cgH); gl.uniform1f(U.uCellG, CELL_G);
      gl.uniform1f(U.uEdge, P.edge);
      this.setSceneUniforms(U);
      if (this.actorTex && U.uActor) {
        gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, this.actorTex); gl.uniform1i(U.uActor, 5);
        gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, this.actorShadowTex); gl.uniform1i(U.uActorShadow, 6);
        gl.uniform4f(U.uActorRect, ...this.actorRect);
      }
      if (withCat && U.uCat) {
        gl.activeTexture(gl.TEXTURE8); gl.bindTexture(gl.TEXTURE_2D, this.catTex); gl.uniform1i(U.uCat, 8);
        gl.uniform4f(U.uCatRect, ...this.catRect); gl.uniform2f(U.uCatShadow, ...this.catShadow);
        gl.uniform1f(U.uCatTail, this.catTail);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    this.drawScene(draw);
    // 每 20 帧（含一次 readPixels 强制同步）测一次单帧耗时，语义同迁移前的 frameMs
    if (this._frameN % 20 === 0) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.px);
  }

  setSceneUniforms(U) {
    const gl = this.gl, S = this.scene;
    if (U.uShadow) gl.uniform3fv(U.uShadow, S.shadow);
    if (U.uCloudHi) gl.uniform3fv(U.uCloudHi, S.cloudHi);
    if (U.uCloudBody) gl.uniform3fv(U.uCloudBody, S.cloudBody);
    if (U.uCloudSh) gl.uniform3fv(U.uCloudSh, S.cloudSh);
    if (U.uLightDir) gl.uniform2fv(U.uLightDir, S.lightDir);
    if (U.uShadowOff) gl.uniform2fv(U.uShadowOff, S.shadowOff);
    this.applyThemeUniforms(U);
  }

  /* ======================================================================
     陆地场（CPU）：s = 到海岸的有符号距离（<0 陆地）
     ====================================================================== */
  buildNoise() {
    const N = this.Gw * this.Gh;
    this.NZ = { wx: new Float32Array(N), wy: new Float32Array(N) };
    for (let gy = 0; gy < this.Gh; gy++) for (let gx = 0; gx < this.Gw; gx++) {
      const i = gy * this.Gw + gx, x = gx * STEP, y = gy * STEP;
      this.NZ.wx[i] = this._fbm(x * 0.0028, y * 0.0028, 1) - 0.47;
      this.NZ.wy[i] = this._fbm(x * 0.0028, y * 0.0028, 2) - 0.47;
    }
  }

  computeField(rects) {
    const t0 = performance.now();
    const N = this.Gw * this.Gh, f1 = new Float32Array(N);
    const sig = this.params.sigma, is1 = 1 / (sig * sig);
    const wa = this.params.warp * 2.2, wmax = wa * 0.5;
    for (const r of rects) {
      const R = 5.5 * sig + Math.max(r.hw, r.hh) * 0.5 + wmax;
      const gx0 = Math.max(0, Math.floor((r.cx - R) / STEP)), gx1 = Math.min(this.Gw - 1, Math.ceil((r.cx + R) / STEP));
      const gy0 = Math.max(0, Math.floor((r.cy - R) / STEP)), gy1 = Math.min(this.Gh - 1, Math.ceil((r.cy + R) / STEP));
      const chw = r.hw * 0.5, chh = r.hh * 0.5;
      for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
        const i = gy * this.Gw + gx;
        const qx = gx * STEP + this.NZ.wx[i] * wa, qy = gy * STEP + this.NZ.wy[i] * wa;
        let dx = Math.abs(qx - r.cx) - chw, dy = Math.abs(qy - r.cy) - chh;
        if (dx < 0) dx = 0; if (dy < 0) dy = 0;
        f1[i] += Math.exp(-(dx * dx + dy * dy) * is1);
      }
    }
    // 下限 = 计算范围边缘处的贡献值：范围内外算出的"离岸距离"一致，深海不会出现方框状的接缝
    const c0 = Math.sqrt(-Math.log(0.35)), s = new Float32Array(N), fMin = Math.exp(-30);
    for (let i = 0; i < N; i++) {
      const g = Math.log(Math.max(f1[i], fMin));
      s[i] = sig * (Math.sqrt(Math.max(-g, 0)) - c0) - sig * 0.6 * Math.max(g, 0);
    }
    this.fieldMs = performance.now() - t0;
    return { s };
  }

  sampleArr(a, x, y) {
    const fx = Math.min(Math.max(x / STEP, 0), this.Gw - 1.001), fy = Math.min(Math.max(y / STEP, 0), this.Gh - 1.001);
    const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy, i = iy * this.Gw + ix;
    return (a[i] * (1 - tx) + a[i + 1] * tx) * (1 - ty) + (a[i + this.Gw] * (1 - tx) + a[i + this.Gw + 1] * tx) * ty;
  }

  // 当前的场（图标挪动时在新旧两张之间过渡）
  curS(x, y) {
    return this.FB ? this.sampleArr(this.FA.s, x, y) * (1 - this.curMix) + this.sampleArr(this.FB.s, x, y) * this.curMix : 999;
  }
  isWater(x, y) { return this.curS(x, y) > 4; }

  iconRects() {
    return this.icons.map(ic => ({ cx: ic.x + ic.w / 2, cy: ic.y + ic.h / 2, hw: ic.w / 2 - 4, hh: ic.h / 2 - 2 }));
  }

  allocField() {
    const gl = this.gl;
    for (let i = 0; i < 2; i++) {
      if (this.ftex[i]) gl.deleteTexture(this.ftex[i]);
      this.ftex[i] = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.ftex[i]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, this.Gw, this.Gh, 0, gl.RED, gl.HALF_FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
  }

  uploadField(i, Fd) {
    const gl = this.gl;
    const d = new Uint16Array(this.Gw * this.Gh);
    for (let k = 0; k < d.length; k++) d[k] = toHalf(Fd.s[k]);
    gl.bindTexture(gl.TEXTURE_2D, this.ftex[i]);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); // R16F 奇数宽度行也按紧凑数据上传
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.Gw, this.Gh, gl.RED, gl.HALF_FLOAT, d);
  }

  commit(fromEmpty = false) {
    const nf = this.computeField(this.params.adaptive ? this.iconRects() : []);
    const target = 1 - this.toI;
    if (fromEmpty) { this.FA = this.computeField([]); this.uploadField(this.toI, this.FA); }
    else this.FA = this.FB;
    this.FB = nf;
    this.uploadField(target, this.FB);
    this.fromI = this.toI; this.toI = target;
    this.morphT0 = performance.now();
    this.morphDur = fromEmpty ? 2600 : MORPH_MS;
  }

  refresh() {
    this.FA = this.FB = this.computeField(this.params.adaptive ? this.iconRects() : []);
    this.uploadField(this.toI, this.FB);
    this.fromI = this.toI; this.morphT0 = -1e9;
  }

  hasField() { return !!this.FB; }
  setSeed(v) { this._seed = v; this.buildNoise(); }

  // 测试用：形态过渡直接走完并立刻画一帧。视觉基线把 performance.now 冻结了，
  // 页面只会画一帧，否则取到的可能是"图标还没就位"的那一帧。
  settleAndRender() {
    this.morphT0 = -1e9; this.curMix = 1; this.massT = -1e9;
    this.render(performance.now());
  }

  /* ======================================================================
     云的圆：每帧在 CPU 上算好所有的圆（几百个），按格子分好上传成一张小纹理，着色器只读自己格子里的几个
     - 图标周围的云团：固定的格子里各放一个圆（随机位置、随机大小），圆心要在云团里面，越靠云边圆越小
       → 边全是圆弧；圆的大小各自慢慢呼吸；图标挪动时跟着场平滑地长大 / 缩小
     - 天上的小云：一朵朵完整的云，由大小不一的圆组成（底下一排、上面堆几个，底部较平），整朵随风飘
     ====================================================================== */
  makeSkyCloud(x) {
    const rnd = Math.random, R = 95 * 1.2;                 // 轮廓大一些（云厚一些，才放得下大圆）；圆的大小还是按 95 算
    // 1) 大致的轮廓：底下一排大圆（中间大、两边小），上面再堆几个 → 底宽上窄的一团
    const n = 3 + Math.floor(rnd() * 3), w = R * (1.0 + n * 0.5);
    const body = [];
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
    const ciOf = (px, py) => { let d = 1e9; for (const [cx, cy, r] of body) d = Math.min(d, Math.hypot(px - cx, py - cy) - r); return d; };
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const [cx, cy, r] of body) { x0 = Math.min(x0, cx - r); x1 = Math.max(x1, cx + r); y0 = Math.min(y0, cy - r); y1 = Math.max(y1, cy + r); }
    // 2) 和图标下方的云一样：每层一张格子、每格随机一个圆，圆心要在轮廓里，越靠边越小；
    //    小圆、很小的圆只长在靠边的一圈，而且要和比它大的圆叠住一截（不会有飘在外面的小点）
    const circles = [];
    const S = 0.62 / 1.2;                                     // 中圆的格子和原来一样大（59px）
    const layer = (G, size, band, bandFn, attach) => {
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
    const y = 80 + rnd() * (this.H - TASKBAR - 120);
    return { x, y, circles, v: 0.7 + rnd() * 0.6, grow: 0, hw: Math.max(-x0, x1) + 20 };
  }

  stepSkyClouds(dt) {
    this.flowT += dt * this.params.flow;                   // 云自己的时钟：流动速度越快，鼓包呼吸得也越快
    const want = Math.round(this.params.cover * 10);
    // 数量变少：多出来的慢慢缩小消失；变多：直接在画面里淡入（找一块别的小云不太挤的地方）
    const alive = this.skyClouds.filter(c => !c.dying);
    for (let i = want; i < alive.length; i++) alive[i].dying = true;
    for (let n = alive.length; n < want; n++) {
      let best = null, bestD = -1;
      for (let k = 0; k < 20; k++) {
        const c = this.makeSkyCloud(Math.random() * this.W);
        const dmin = Math.min(1e9, ...this.skyClouds.map(o => Math.hypot((o.x - c.x) / 1.6, o.y - c.y)));
        if (dmin > bestD) { bestD = dmin; best = c; }
      }
      this.skyClouds.push(best);
    }
    for (let i = this.skyClouds.length - 1; i >= 0; i--) {
      const c = this.skyClouds[i];
      c.x += this.params.flow * 10 * c.v * dt;             // 流动速度 ×1 时约 10px/秒
      c.grow = c.dying ? c.grow - dt * 0.5 : Math.min(1, c.grow + dt * 0.5);
      if (c.grow <= 0) { this.skyClouds.splice(i, 1); continue; }
      // 飘出画面：从上风那边画面外重新飘进来
      if (c.x - c.hw > this.W + 50) { const n = this.makeSkyCloud(-c.hw - 50); n.grow = 1; this.skyClouds[i] = n; }
    }
  }

  buildMassCircles() {
    const list = [];
    // 图标周围的云团：三层圆（大 / 小 / 很小），每层是一张固定的格子，每格随机放一个圆。
    // 圆的基础大小只看圆心在云团里多深，图标不动就不变；显不显示也按基础大小决定，
    // 最后才乘上很轻（±4%）、很慢（一圈 50~70 秒）的"呼吸" → 圆的大小不会忽大忽小
    const R = 95;
    // big：大圆按格子存起来（用基础大小，不含呼吸），小圆要找得到挨着的大圆
    const big = new Map();
    const layer = (G, k0, size, band, isBig) => {
      if (!this.FB) return;
      for (let cy = -Math.ceil(2 * R / G); cy <= Math.ceil((this.H + 2 * R) / G); cy++) for (let cx = -Math.ceil(2 * R / G); cx <= Math.ceil((this.W + 2 * R) / G); cx++) {
        const ox = this._hash2(cx, cy, k0), oy = this._hash2(cx, cy, k0 + 1), rr = this._hash2(cx, cy, k0 + 2), ph = this._hash2(cx, cy, k0 + 3);
        const x = (cx + 0.1 + ox * 0.8) * G, y = (cy + 0.1 + oy * 0.8) * G;
        const ci = this.curS(x, y) - this.params.edge;     // 圆心处离云团边多远（<0 在云团里）
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
  wobX(x, y, r, ph) { return (4.5 + 0.12 * r) * (0.85 * Math.sin(this.flowT * 0.24 + x * 0.011 + y * 0.004) + 0.3 * Math.sin(this.flowT * 0.3 + ph * 6.283)); }
  wobY(x, y, r, ph) { return (4.5 + 0.12 * r) * (0.65 * Math.sin(this.flowT * 0.2 + y * 0.013 - x * 0.006 + 1.7) + 0.25 * Math.cos(this.flowT * 0.28 + ph * 6.283)); }

  uploadCircles(t) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE3);                            // 用第 3 号纹理单元，不要动到别的纹理
    const gw = Math.ceil(this.W / CELL_G) + 7, gh = Math.ceil(this.H / CELL_G) + 7;   // 左、上多 4 格（右下方的云影要用到画面外的云），右、下多 3 格
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
    // 图标周围云团的圆：只在图标挪动时（场在过渡）每帧重算，平时每 0.5 秒重算一次（呼吸很慢，看不出跳）
    const morphing = this.curMix < 1 || !this.massList || this.massList.W !== this.W || this.massList.H !== this.H;
    if (morphing || t - this.massT > 0.5) { this.massList = this.buildMassCircles(); this.massList.W = this.W; this.massList.H = this.H; this.massT = t; }
    const list = this.massList.slice();
    for (let i = 0; i < list.length; i += 4) {
      const x = list[i], y = list[i + 1], r = list[i + 2], ph = list[i + 3];
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
    this.circBuf.fill(0);
    const cnt = new Uint8Array(gw * gh);
    const order = [];
    for (let i = 0; i < list.length; i += 4) order.push(i);
    order.sort((a, b) => list[b + 2] - list[a + 2]);
    for (const i of order) {
      const x = list[i], y = list[i + 1], r = list[i + 2] + 6;
      const x0 = Math.max(0, Math.floor((x - r) / CELL_G) + 4), x1 = Math.min(gw - 1, Math.floor((x + r) / CELL_G) + 4);
      const y0 = Math.max(0, Math.floor((y - r) / CELL_G) + 4), y1 = Math.min(gh - 1, Math.floor((y + r) / CELL_G) + 4);
      for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) {
        const ci = gy * gw + gx;
        const nx = Math.max((gx - 4) * CELL_G, Math.min(x, (gx - 3) * CELL_G)), ny = Math.max((gy - 4) * CELL_G, Math.min(y, (gy - 3) * CELL_G));
        if ((nx - x) * (nx - x) + (ny - y) * (ny - y) > r * r) continue;   // 圆碰不到这个格子
        if (cnt[ci] >= CIRC_K) continue;
        const o = ((gy * gw + gx) * CIRC_K + cnt[ci]++) * 4;
        this.circBuf[o] = x; this.circBuf[o + 1] = y; this.circBuf[o + 2] = list[i + 2]; this.circBuf[o + 3] = list[i + 3];
      }
    }
    this.circStats = { circles: list.length / 4, maxPerCell: Math.max(...cnt) };
    gl.bindTexture(gl.TEXTURE_2D, this.circTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gw * CIRC_K, gh, gl.RGBA, gl.FLOAT, this.circBuf);
  }

  /* ======================================================================
     统计 / 调试
     ====================================================================== */
  getStats() {
    return { fps: this._fpsEMA, frame: this._frameMs, field: this.fieldMs, gpu: this.GPU, width: this.cv.width, height: this.cv.height };
  }

  bench() {
    const ts = [];
    for (let i = 0; i < 10; i++) {
      const a = performance.now();
      this.render(performance.now());
      this.gl.readPixels(0, 0, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, this.px);
      ts.push(performance.now() - a);
    }
    ts.sort((a, b) => a - b);
    return { frame: +ts[5].toFixed(1), canvas: this.cv.width + 'x' + this.cv.height, gpu: this.GPU };
  }

  /* ======================================================================
     销毁：清理本引擎创建的所有 WebGL 资源
     ====================================================================== */
  dispose() {
    const gl = this.gl;
    if (!gl) return;
    if (this.vao) { gl.deleteVertexArray(this.vao); this.vao = null; }
    if (this.noiseTex) { gl.deleteTexture(this.noiseTex); this.noiseTex = null; }
    for (let i = 0; i < 2; i++) if (this.ftex[i]) { gl.deleteTexture(this.ftex[i]); this.ftex[i] = null; }
    if (this.circTex) { gl.deleteTexture(this.circTex); this.circTex = null; }
    // program() 记录的所有程序（含 boy/cat 脚本通过 window.program 创建的）；缓存的程序跨引擎复用，不删
    for (const r of this._programs) if (r && r.p && !r.cached) gl.deleteProgram(r.p);
    this._programs.clear();
    this.PR = this.actorPR = this.catPR = this.catActorPR = null;
    this.actorTex = this.actorShadowTex = null; this.actorRect = null;
    this.catTex = null; this.catRect = null; this.catShadow = null; this.catTail = 0;
    this.circBuf = null; this.massList = null; this.NZ = null; this.FA = this.FB = null;
    this.skyClouds.length = 0;
  }

  /* ======================================================================
     CPU 噪声（hash2 / vnoise / fbm / tileNoise / tileFbm / makeNoiseImage）
     ====================================================================== */
  _hash2(x, y, k = 0) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(this._seed + k, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  _vnoise(x, y, k = 0) {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const a = this._hash2(ix, iy, k), b = this._hash2(ix + 1, iy, k), c = this._hash2(ix, iy + 1, k), d = this._hash2(ix + 1, iy + 1, k);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  }
  _fbm(x, y, k = 0) {
    let a = 0.5, s = 0;
    for (let i = 0; i < 4; i++) { s += a * this._vnoise(x, y, k + i * 7); x = x * 2.03 + 17.1; y = y * 2.03 + 17.1; a *= 0.5; }
    return s;
  }
  _tileNoise(x, y, px, py, k) {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const m = (v, p) => ((v % p) + p) % p;
    const x0 = m(ix, px), x1 = m(ix + 1, px), y0 = m(iy, py), y1 = m(iy + 1, py);
    const a = this._hash2(x0, y0, k), b = this._hash2(x1, y0, k), c = this._hash2(x0, y1, k), d = this._hash2(x1, y1, k);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  }
  _tileFbm(u, v, periods, k) {
    let s = 0, w = 0.5, tw = 0;
    for (let i = 0; i < periods.length; i++) { s += w * this._tileNoise(u * periods[i], v * periods[i], periods[i], periods[i], k + i * 13); tw += w; w *= 0.5; }
    return s / tw;
  }
  _makeNoiseImage() {
    const S = 256, d = new Uint8Array(S * S * 4);
    const chans = [[8, 16, 32, 64], [8, 16, 32, 64], [8, 16, 32], [16, 32, 64, 128]];
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S, i = (y * S + x) * 4;
      for (let c = 0; c < 4; c++) {
        let n = this._tileFbm(u, v, chans[c], 100 + c * 50);
        d[i + c] = Math.min(Math.max((n - 0.5) * 1.9 + 0.5, 0), 1) * 255;
      }
    }
    return { S, d };
  }
}
