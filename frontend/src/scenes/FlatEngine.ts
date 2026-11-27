// 沙滩（海边）主题引擎：海滩着色器 + 皮划艇 / 海鸟 / 涟漪。
// 没有云，所以覆写 update / render，不碰基类的圆的机制。
//
// 着色器资产在 flatShade.ts；皮划艇 / 海鸟群各自成模块（kayak.ts / bird.ts），这里只做装配与编排。
//
// 椰子树已 TS 化（themes/beach/legacy/palms.ts），由 installLegacy 注入，
// 依赖经 LegacyHost 显式传入，不再读 window 全局（P4 迁移，见 docs/2026-11-23-p4-legacy-ts-design.md）。

import { SceneEngine, numParam } from '../engine/SceneEngine.js';
import type { EngineOpts, EngineParams } from '../engine/BaseEngine.js';
import { paramDefaults } from '../engine/paramDefs.js';
import { assertParamCoverage, paramDisplays, paramSliders } from '../engine/paramSchema.js';
import type { Program, ScenePalette, Uniforms } from '../engine/SceneEngine.js';
import type { LegacyHost } from '../engine/LegacyHost.js';
import type { MaldivesPalmsScene } from '../themes/beach/legacy/palms.js';
import { FS, FS_PRE } from './flatShade.js';
import { KayakFlock } from './kayak.js';
import { BirdFlock } from './bird.js';

// 涟漪：点击水面留下的一圈圈细白圈
interface Ripple {
  x: number;
  y: number;
  t0: number;
  str: number;
}

export class FlatEngine extends SceneEngine {
  static override FS = FS; // 片元着色器（SceneEngine 约定）

  kayaks: KayakFlock;
  birds: BirdFlock;
  ripples: Ripple[] = [];
  ripBuf: Float32Array;
  kayBuf: Float32Array;
  birdBuf: Float32Array;
  palmPR: Program | null;
  private _palms: MaldivesPalmsScene | null = null;
  private _legacyHost: LegacyHost | null = null;
  private _legacyDef: {
    FS: string;
    VS: string;
    create: (host: LegacyHost) => MaldivesPalmsScene;
  } | null = null;

  // 由页面装配（installLegacyFor）在 init 之前调用：FS/VS 给 buildShaders 编译 palmPR，
  // create 在 init 末尾（gl 就绪后）创建实例。
  installLegacy(
    host: LegacyHost,
    def: { FS: string; VS: string; create: (host: LegacyHost) => MaldivesPalmsScene },
  ): void {
    this._legacyHost = host;
    this._legacyDef = def;
  }

  override async init(): Promise<boolean> {
    const ok = await super.init();
    // legacy 实例会立即建纹理，必须在 gl 就绪（super.init）之后
    if (ok && this._legacyHost && this._legacyDef) this._palms = this._legacyDef.create(this._legacyHost);
    return ok;
  }

  constructor(canvas: HTMLCanvasElement, opts: EngineOpts = {}) {
    super(canvas, opts);
    // 面板配置：数据面来自 PARAM_DEFS（theme.json.groups），此处只给 fmt / act
    this.sliders = paramSliders('beach', {
      palms: { fmt: (v) => v + ' 棵' },
      sigma: { fmt: (v) => v + ' px', act: 'field' },
      warp: { fmt: (v) => String(v), act: 'field' },
      shoal: { fmt: (v) => v + ' px' },
      shallow: { fmt: (v) => v + ' px' },
      kayaks: { fmt: (v) => v + ' 艘', act: 'kayaks' },
      birds: { fmt: (v) => v + ' 只', act: 'birds' },
    });
    this.displayKeys = paramDisplays('beach', []);
    assertParamCoverage('beach', this.sliders, this.displayKeys);
    // 皮划艇 / 海鸟 / 涟漪
    this.kayaks = new KayakFlock(this);
    this.birds = new BirdFlock(this);
    this.ripples = [];
    this.ripBuf = new Float32Array(24);
    this.kayBuf = new Float32Array(16);
    this.birdBuf = new Float32Array(32);
    this.palmPR = null;
  }

  override defaultParams(): EngineParams {
    // 开放参数默认值来自 PARAM_DEFS（= theme.json.groups）
    // 海浪（speed、runup、wave、spacing）和 grain、quality、snap/cap30 不再开放调节，固定为这里的值
    return {
      ...paramDefaults('beach'),
      speed: 22,
      runup: 120,
      wave: 1.6,
      spacing: 70,
      grain: 1,
      quality: 2, // quality 2：按屏幕的实际像素画（150% 缩放时不再放大发糊）
      debug: false,
      snap: true,
      cap30: true,
      adaptive: 1, // 基类 commit/refresh 用它判断是否把图标矩形计入陆地场（沿用数值 1/0）
    };
  }

  override buildScenePalette(): ScenePalette {
    return {
      sea0: this.sceneToken('--scene-sea-0'),
      sea1: this.sceneToken('--scene-sea-1'),
      sea2: this.sceneToken('--scene-sea-2'),
      sea3: this.sceneToken('--scene-sea-3'),
      sea4: this.sceneToken('--scene-sea-4'),
      sand0: this.sceneToken('--scene-sand-0'),
      sand1: this.sceneToken('--scene-sand-1'),
      sand2: this.sceneToken('--scene-sand-2'),
      sand3: this.sceneToken('--scene-sand-3'),
      foam: this.sceneToken('--scene-foam'),
      wetsand: this.sceneToken('--scene-wetsand'),
    };
  }

  // 海滩特有的 uniform：海 / 沙 / 浪花 / 湿沙
  override applyThemeUniforms(U: Uniforms): void {
    const gl = this.gl,
      S = this.scene;
    if (!gl) return;
    if (U.uSea0 && S.sea0) gl.uniform3fv(U.uSea0, S.sea0);
    if (U.uSea1 && S.sea1) gl.uniform3fv(U.uSea1, S.sea1);
    if (U.uSea2 && S.sea2) gl.uniform3fv(U.uSea2, S.sea2);
    if (U.uSea3 && S.sea3) gl.uniform3fv(U.uSea3, S.sea3);
    if (U.uSea4 && S.sea4) gl.uniform3fv(U.uSea4, S.sea4);
    if (U.uSand0 && S.sand0) gl.uniform3fv(U.uSand0, S.sand0);
    if (U.uSand1 && S.sand1) gl.uniform3fv(U.uSand1, S.sand1);
    if (U.uSand2 && S.sand2) gl.uniform3fv(U.uSand2, S.sand2);
    if (U.uSand3 && S.sand3) gl.uniform3fv(U.uSand3, S.sand3);
    if (U.uFoam && S.foam) gl.uniform3fv(U.uFoam, S.foam);
    if (U.uWetSand && S.wetsand) gl.uniform3fv(U.uWetSand, S.wetsand);
  }

  /* ======================================================================
    着色器：海滩 + 棕榈树（beach palms 模块提供，复用海滩着色器的常量与函数）
     ====================================================================== */
  override buildShaders(): void {
    super.buildShaders();
    const def = this._legacyDef;
    if (def) {
      // 显式拼接：FS_PRE 是海滩着色器 main 之前的部分（声明 + 公共函数 + 海滩函数）
      this.palmPR = this.program(FS_PRE + def.FS, def.VS);
    }
  }

  override dispose(): void {
    this._palms?.dispose();
    this._palms = null;
    super.dispose();
    this.palmPR = null;
    this.ripples.length = 0;
  }

  /* ======================================================================
    主循环：场插值 + 皮划艇 + 海鸟（没有云）
     ====================================================================== */
  override update(dt: number, now: number): void {
    const e = Math.min((now - this.morphT0) / this.morphDur, 1);
    this.curMix = e < 0.5 ? 2 * e * e : 1 - Math.pow(-2 * e + 2, 2) / 2;
    this.kayaks.step(dt);
    this.birds.step(dt);
  }

  override render(now: number): void {
    const gl = this.gl,
      pass = this.PR;
    if (!gl || !pass) return;
    this.ripBuf.fill(0);
    this.ripples.forEach((r, i) => {
      const age = (now - r.t0) / 1000;
      if (age < 3) this.ripBuf.set([r.x, r.y, age, r.str], i * 4);
    });
    this.kayBuf.fill(0);
    this.kayaks.list.forEach((k, i) => this.kayBuf.set([k.x, k.y, k.h, k.ph], i * 4));
    this.birdBuf.fill(0);
    this.birds.list.forEach((b, i) => this.birdBuf.set([b.x, b.y, b.h, 0.68 + 0.32 * Math.cos(b.ph)], i * 4));

    this.configureBeachPass(now, pass);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (this._palms && this.palmPR) this._palms.draw(now, this.palmPR, this.configureBeachPass);
    // 同 SceneEngine：不再每 20 帧 readPixels 强制同步（实测海滩 6.3ms → 0ms）
  }

  configureBeachPass = (now: number, pass: Program): void => {
    const gl = this.gl,
      cv = this.cv,
      P = this.params,
      U = pass.U;
    if (!gl) return;
    gl.useProgram(pass.p);
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
    gl.uniform1f(U.uStep ?? null, 5);
    gl.uniform1f(U.uMix ?? null, this.curMix);
    gl.uniform1f(U.uTime ?? null, this.sceneTime(now));
    gl.uniform1f(U.uSpeed ?? null, numParam(P, 'speed'));
    gl.uniform1f(U.uRunup ?? null, numParam(P, 'runup'));
    gl.uniform1f(U.uShallow ?? null, numParam(P, 'shallow'));
    gl.uniform1f(U.uShoal ?? null, numParam(P, 'shoal'));
    gl.uniform1f(U.uGrain ?? null, numParam(P, 'grain'));
    gl.uniform1f(U.uWave ?? null, numParam(P, 'wave'));
    gl.uniform1f(U.uSigma ?? null, numParam(P, 'sigma'));
    gl.uniform1f(U.uSpacing ?? null, numParam(P, 'spacing'));
    gl.uniform1f(U.uDebug ?? null, P.debug ? 1 : 0);
    gl.uniform1f(U.uKayN ?? null, this.kayaks.list.length);
    gl.uniform4fv(U.uKay ?? null, this.kayBuf);
    gl.uniform4fv(U.uRip ?? null, this.ripBuf);
    gl.uniform1f(U.uBirdN ?? null, this.birds.list.length);
    gl.uniform4fv(U.uBird ?? null, this.birdBuf);
    this.applyThemeUniforms(U);
  };

  /* ======================================================================
    数量同步（按主题声明的范围夹紧）：设置改动 / 换种子 / 重新布局时调用
     ====================================================================== */
  private syncKayaks(): void {
    this.kayaks.sync(Math.max(0, Math.min(4, Math.round(numParam(this.params, 'kayaks')))));
  }
  private syncBirds(fromEdge = true): void {
    this.birds.sync(Math.max(0, Math.min(8, Math.round(numParam(this.params, 'birds')))), fromEdge);
  }

  /* ======================================================================
    涟漪 / 场景变更钩子
     ====================================================================== */
  addRipple(x: number, y: number, str = 1): void {
    this.ripples.push({ x, y, t0: performance.now(), str });
    if (this.ripples.length > 6) this.ripples.shift();
  }

  // DeskApp 在布局 / 换种子 / 宿主首帧之后回调，主题自己决定要重排哪些动态元素
  onSceneChanged(kind: string): void {
    if (kind === 'hostInit') {
      this.syncBirds(false);
      return;
    }
    if (kind === 'reseed') {
      this.curMix = 1;
      this.kayaks.list.length = 0;
      this.syncKayaks();
      this.curMix = 0;
      return;
    }
    if (kind === 'layout' || kind === 'firstIcons') {
      this.curMix = 1;
      this.kayaks.list.length = 0;
      this.syncKayaks();
      this.curMix = 0; // 按最终海岸线挑皮划艇的出生点
      if (!this.birds.list.length) this.syncBirds(false);
    }
  }

  onSliderAction(act: string): void {
    if (act === 'kayaks') this.syncKayaks();
    else if (act === 'birds') this.syncBirds();
  }
}
