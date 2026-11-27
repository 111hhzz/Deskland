// 草地主题引擎：只保留草地特有的部分（着色器、调色板、人物 / 小猫）。
// 共享的场景机制（噪声、陆地场、渲染骨架）在 SceneEngine，云的圆在 CloudSceneEngine，人物 / 小猫在 ActorSceneEngine。
//
// 人物 / 小猫已 TS 化（themes/meadow/legacy/boy.ts、cat.ts），由 installLegacy 注入，
// 依赖经 LegacyHost 显式传入，不再读 window 全局（P4 迁移，见 docs/2026-11-23-p4-legacy-ts-design.md）。

import { ActorSceneEngine } from '../engine/ActorSceneEngine.js';
import type { EngineOpts, EngineParams } from '../engine/BaseEngine.js';
import { paramDefaults } from '../engine/paramDefs.js';
import { assertParamCoverage, paramDisplays, paramSliders } from '../engine/paramSchema.js';
import type { ScenePalette, SceneDraw, Uniforms } from '../engine/SceneEngine.js';
import { GLSL_COMMON, GLSL_CLOUD, GLSL_MEADOW_EXTRA, withDefines } from '../engine/glsl/common.js';
import type { LegacyHost } from '../engine/LegacyHost.js';
import { isMeadowActor } from '../themes/meadow/legacy/boy.js';
import type { MeadowActor, MeadowBoyScene } from '../themes/meadow/legacy/boy.js';
import type { MeadowCat, MeadowCatScene } from '../themes/meadow/legacy/cat.js';

// 人物 / 小猫的类型由各自的 legacy 模块定义（形状对应着色器 uActor / uCat 的输入），此处转供外部引用
export type { MeadowActor, MeadowActorState } from '../themes/meadow/legacy/boy.js';
export type { MeadowCat } from '../themes/meadow/legacy/cat.js';

// 头部：本主题自己的 uniform 声明与常量；函数体在 common.ts，主体（main）在下面
const FS_HEADER = `#version 300 es
precision highp float;
uniform sampler2D uNoise, uFA, uFB;
uniform vec2 uRes, uGrid;
uniform float uScale, uSeed, uStep, uMix, uTime, uDebug, uEdge;
#ifdef MEADOW_ACTOR
uniform sampler2D uActor, uActorShadow;
uniform vec4 uActorRect;
#endif
#ifdef MEADOW_CAT
uniform sampler2D uCat;
uniform vec4 uCatRect;
uniform vec2 uCatShadow;
uniform float uCatTail;
#endif
uniform highp sampler2D uCirc;   // 云的圆（CPU 算好、按格子分好）：每格最多 CIRC_K 个，(x, y, 半径, 色调)，半径 0 = 没有了
uniform vec2 uCGrid;             // 格子数
uniform float uCellG;            // 格子大小（px）
out vec4 o;

// ---- 调色板（由主题 theme.css 的 --scene-* Token 驱动，JS 读取后传入）----
uniform vec3 uGroundLight, uGroundMid, uGroundDeep, uInk, uShadow, uCloudHi, uCloudBody, uCloudSh;
uniform vec2 uLightDir, uShadowOff;
`;

const FS_BODY = `
// 画草的短线：每个 12×6 的格子里最多一笔，方向跟着大片区域走（一片片平行的排线），疏密也跟着区域变（有的地方密、有的地方空）
// 只看自己的格子和上下两格（一笔不会伸出左右的格子）
float grassInk(vec2 p) {
  const vec2 G = vec2(12.0, 6.0);
  vec2 c0 = floor(p / G);
  float ink = 0.0;
  for (int j = -1; j <= 1; j++) {
    vec2 c = c0 + vec2(0.0, float(j));
    vec2 cp = (c + 0.5) * G;
    float h = hash2(c + 3.1);
    float dens = 0.75 * ss(0.42, 0.72, N(cp, 900.0).r) * ss(0.35, 0.6, N(cp + 50.0, 380.0).g) + 0.02;   // 一片片、一簇簇地画，中间留空
    if (h > dens) continue;
    float ang = (N(cp, 1400.0).g - 0.5) * 0.7 + (hash2(c + 7.7) - 0.5) * 0.3;    // 以接近水平为主，一片里的线大致平行
    float len = 2.5 + 3.0 * hash2(c + 1.9);                                      // 半长 2.5~5.5px
    vec2 ctr = cp + (vec2(hash2(c + 4.3), hash2(c + 5.9)) - 0.5) * vec2(2.0, 3.0);
    vec2 dir = vec2(cos(ang), sin(ang)) * len;
    float d = segD(p, ctr - dir, ctr + dir);
    ink = max(ink, (1.0 - ss(0.2, 0.9, d)) * (0.35 + 0.45 * hash2(c + 9.1)));
  }
  return ink;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y * uScale - gl_FragCoord.y) / uScale;

  // ---------- 草地：黄绿和绿的大块水彩晕染，几片颜色深一点，左上（向阳）稍亮；纸的颗粒 ----------
  float w1 = N(p, 1900.0).b, w2 = N(p + 311.0, 650.0).g;
  vec3 col = mix(uGroundMid, uGroundLight, ss(0.3, 0.75, w1 * 0.7 + w2 * 0.3));
  col = mix(col, uGroundDeep, ss(0.45, 0.85, N(p + 977.0, 1300.0).r) * 0.4);       // 阈值放宽：噪声放大很多倍，卡得太陡会出现台阶状的方块
  col *= 1.0 + 0.05 * (0.5 - (p.x + p.y) / (uRes.x + uRes.y));
  col *= 1.0 + (hash2(floor(p * (0.8 * max(uScale, 1.0)))) - 0.5) * 0.035;   // 颗粒按屏幕的实际像素取
  // 画草的墨绿短线
  col = mix(col, uInk, grassInk(p) * 0.75);

#ifdef MEADOW_ACTOR
  // 人物、风筝和完整投影都先落在草地上，随后由同一层云影和白云覆盖。
  vec2 actorUV=(p-uActorRect.xy)/uActorRect.zw;
  actorUV.y=1.0-actorUV.y;
  float inActor=step(0.0,actorUV.x)*step(0.0,actorUV.y)*step(actorUV.x,1.0)*step(actorUV.y,1.0);
  vec4 actor=texture(uActor,actorUV);
  float actorShadow=texture(uActorShadow,actorUV).r*inActor;
  col=mix(col,col*uShadow,actorShadow*0.85);
  col=mix(col,actor.rgb,actor.a*inActor);
#endif

#ifdef MEADOW_CAT
  // 只在猫所在的小矩形内启用这份着色器，猫与贴地阴影同样位于云层之下。
  vec2 catUV=(p-uCatRect.xy)/uCatRect.zw;
  vec2 catShadowUV=(p-uCatShadow-uCatRect.xy)/uCatRect.zw;
  vec4 cat=catColor(catUV);
  float catShadow=catColor(catShadowUV).a;
  float inCat=step(0.,catUV.x)*step(0.,catUV.y)*step(catUV.x,1.)*step(catUV.y,1.);
  float inShadow=step(0.,catShadowUV.x)*step(0.,catShadowUV.y)*step(catShadowUV.x,1.)*step(catShadowUV.y,1.);
  col=mix(col,col*uShadow,catShadow*inShadow*.78);
  col=mix(col,cat.rgb,cat.a*inCat);
#endif

  // ---------- 云投在草地上的影子（右下方）：一整块深绿 ----------
  float sd = cloudDist(p - uShadowOff);
  col = mix(col, col * uShadow, ss(3.0, -3.0, sd) * 0.85);

  // ---------- 云：卡通画法（和大海主题一样）——一个个圆合起来，每个圆色调略有不同，
  //            只有朝光（左上）的外轮廓一道亮白，里面没有亮面；边缘干净 ----------
  vec4 fc = vec4(0.0, -1e9, 0.0, 0.0);
  float d = cloudDist(p, true, fc);
  if (d < 1.5) {
    // 往光那边走一小段就出云了 → 这里是朝光的外沿（离外轮廓超过 21px 的地方不用算）
    float hi = d > -21.0 ? ss(-1.0, 1.0, cloudDist(p + uLightDir * 20.0)) : 0.0;
    vec3 cc = fc.y > -1e8 ? mix(uCloudBody, uCloudSh, fc.w * 0.6) : mix(uCloudBody, uCloudSh, 0.45);
    cc = mix(cc, uCloudHi, hi);
    col = mix(col, cc, ss(1.0, -1.0, d));
  }
  if (uDebug > 0.5) col = mix(col, vec3(0.9, 0.15, 0.15), 1.0 - ss(0.0, 1.5, abs(d)));
  o = vec4(col, 1.0);
}`;

const FS = FS_HEADER + GLSL_COMMON + GLSL_CLOUD + GLSL_MEADOW_EXTRA + FS_BODY;
const FS_ACTOR = withDefines(FS, ['MEADOW_ACTOR']);
const FS_CAT = withDefines(FS, ['MEADOW_CAT']);
const FS_ACTOR_CAT = withDefines(FS, ['MEADOW_ACTOR', 'MEADOW_CAT']);

export class MeadowEngine extends ActorSceneEngine {
  static override FS = FS; // 片元着色器（SceneEngine 约定）
  static FS_ACTOR = FS_ACTOR; // 带人物的变体
  static FS_CAT = FS_CAT; // 带小猫的变体
  static FS_ACTOR_CAT = FS_ACTOR_CAT; // 人物 + 小猫

  _actor: MeadowActor | null;
  _cat: MeadowCat | null;
  private _boy: MeadowBoyScene | null = null;
  private _catScene: MeadowCatScene | null = null;
  private _legacyHost: LegacyHost | null = null;
  private _legacyDef: {
    createBoy: (host: LegacyHost) => MeadowBoyScene;
    createCat: (host: LegacyHost) => MeadowCatScene;
  } | null = null;

  // 由页面在 init() 之前调用：把人物 / 小猫模块注入引擎（P4）
  installLegacy(
    host: LegacyHost,
    def: {
      createBoy: (host: LegacyHost) => MeadowBoyScene;
      createCat: (host: LegacyHost) => MeadowCatScene;
    },
  ): void {
    this._legacyHost = host;
    this._legacyDef = def;
  }

  override async init(): Promise<boolean> {
    const ok = await super.init();
    // legacy 实例会立即建纹理 / 编译 program，必须在 gl 就绪（super.init）之后
    if (ok && this._legacyHost && this._legacyDef) {
      this._boy = this._legacyDef.createBoy(this._legacyHost);
      this._catScene = this._legacyDef.createCat(this._legacyHost);
    }
    return ok;
  }

  override dispose(): void {
    // 先释放 legacy 模块自己的 GL 句柄，再走引擎统一清理
    this._boy?.dispose();
    this._catScene?.dispose();
    this._boy = null;
    this._catScene = null;
    super.dispose();
  }

  constructor(canvas: HTMLCanvasElement, opts: EngineOpts = {}) {
    super(canvas, opts);
    this._actor = null;
    this._cat = null;
    // 面板配置：数据面（范围 / 默认值 / 文案）来自 PARAM_DEFS（theme.json.groups），此处只给 fmt / act
    this.sliders = paramSliders('meadow', {
      sigma: { fmt: (v) => v + ' px', act: 'field' },
      cover: { fmt: (v) => Math.round(v * 100) + '%' },
      flow: { fmt: (v) => '×' + v.toFixed(2) },
    });
    this.displayKeys = paramDisplays('meadow', ['adaptive', 'showBoy', 'showCat']);
    assertParamCoverage('meadow', this.sliders, this.displayKeys);
  }

  override defaultParams(): EngineParams {
    // 开放参数默认值来自 PARAM_DEFS（= theme.json.groups）；warp/edge/grain/quality/snap/cap30 不开放调节
    return {
      ...paramDefaults('meadow'),
      warp: 40,
      edge: 10,
      grain: 1,
      quality: 2, // quality 2：按屏幕的实际像素画（150% 缩放时不再放大发糊）
      debug: false,
      snap: true,
      cap30: true,
      adaptive: 1, // 内置显示键：沿用数值 1/0（与宿主下发同型；`?:` 判断下与布尔等价）
    };
  }

  override buildScenePalette(): ScenePalette {
    return {
      groundLight: this.sceneToken('--scene-ground-light'),
      groundMid: this.sceneToken('--scene-ground-mid'),
      groundDeep: this.sceneToken('--scene-ground-deep'),
      ink: this.sceneToken('--scene-ink'),
      shadow: this.sceneToken('--scene-shadow'),
      cloudHi: this.sceneToken('--scene-cloud-hi'),
      cloudBody: this.sceneToken('--scene-cloud-body'),
      cloudSh: this.sceneToken('--scene-cloud-shade'),
      lightDir: this.sceneToken('--scene-light-dir'),
      shadowOff: this.sceneToken('--scene-shadow-offset'),
    };
  }

  // 草地特有的 uniform：地面三色 + 草的墨绿
  override applyThemeUniforms(U: Uniforms): void {
    const gl = this.gl,
      S = this.scene;
    if (!gl) return;
    if (U.uGroundLight && S.groundLight) gl.uniform3fv(U.uGroundLight, S.groundLight);
    if (U.uGroundMid && S.groundMid) gl.uniform3fv(U.uGroundMid, S.groundMid);
    if (U.uGroundDeep && S.groundDeep) gl.uniform3fv(U.uGroundDeep, S.groundDeep);
    if (U.uInk && S.ink) gl.uniform3fv(U.uInk, S.ink);
  }

  /* ======================================================================
     人物 / 小猫（meadow 特有）：每帧先准备，再按基类的编排绘制
     ====================================================================== */
  override prepareScene(): void {
    const P = this.params,
      now = this._now;
    // 隐藏男孩时只保留路线状态，小猫仍能独立显示并避开男孩再次出现的路线。
    const boy = this._boy ? this._boy.draw(now, P.showBoy === 1) : null;
    // visible=false 时 boy 只有 state，用类型守卫区分完整帧
    const actor = isMeadowActor(boy) ? boy : null;
    const cat = P.showCat === 1 && this._catScene ? this._catScene.prepare(boy, now) : null;
    // 官网不加载人物脚本，沿用原来的草地着色器和开销。
    if (actor && !this.actorPR) this.actorPR = this.program((this.constructor as typeof MeadowEngine).FS_ACTOR);
    this._actor = actor;
    this._cat = cat;
    this.actorTex = actor ? actor.actor : null;
    this.actorShadowTex = actor ? actor.shadow : null;
    this.actorRect = actor ? actor.rect : null;
  }

  override drawScene(draw: SceneDraw): void {
    const gl = this.gl,
      cv = this.cv,
      actor = this._actor,
      cat = this._cat;
    if (!gl) return;
    const mainPR = actor ? this.actorPR : this.PR;
    if (!mainPR) return;
    draw(mainPR, false);
    if (!cat) return;
    // 人物 / 猫共用一份片的变体，按需懒编译（保持既有开销）
    if (actor && !this.catActorPR)
      this.catActorPR = this.program((this.constructor as typeof MeadowEngine).FS_ACTOR_CAT);
    if (!actor && !this.catPR) this.catPR = this.program((this.constructor as typeof MeadowEngine).FS_CAT);
    this.catTex = cat.texture;
    this.catRect = cat.rect;
    this.catShadow = cat.shadow;
    this.catTail = cat.tail;
    const k = cv._scale,
      [x, y, w, h] = cat.bounds;
    const left = Math.max(0, Math.floor(x * k)),
      top = Math.max(0, Math.floor(y * k));
    const right = Math.min(cv.width, Math.ceil((x + w) * k)),
      bottom = Math.min(cv.height, Math.ceil((y + h) * k));
    const catPR = actor ? this.catActorPR : this.catPR;
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(left, cv.height - bottom, Math.max(0, right - left), Math.max(0, bottom - top));
    try {
      if (catPR) draw(catPR, true);
    } finally {
      gl.disable(gl.SCISSOR_TEST);
    }
  }
}
