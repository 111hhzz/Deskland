// 天空主题引擎：只保留天空特有的部分（天空渐变着色器、时段调色板、云影颜色）。
// 共享的场景机制（噪声、陆地场、云的圆、渲染骨架）在 SceneEngine。
//
// 过渡期约定：渲染上下文与共享状态由 DeskApp 挂到 window，与 meadow 保持一致的实例化顺序。

import { SceneEngine } from '../engine/SceneEngine.js';
import { GLSL_COMMON, GLSL_CLOUD } from '../engine/glsl/common.js';

// 头部：本主题自己的 uniform 声明与常量；函数体在 common.js，主体（main）在下面
const FS_HEADER = `#version 300 es
precision highp float;
#define SKY_SCHEME
uniform int uScheme;   // 0 白天 / 1 傍晚 / 2 晚上
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
uniform vec3 uShadow, uCloudHi, uCloudBody, uCloudSh, uCloudShadow;
uniform vec2 uLightDir, uShadowOff;

// 天空：三种时段的上半 / 下半渐变（顶 → 地平线）
uniform vec3 uSkyDayTop, uSkyDayBot, uSkyDuskTop, uSkyDuskBot, uSkyNightTop, uSkyNightBot;
vec3 skyTop() { return uScheme == 1 ? uSkyDuskTop : (uScheme == 2 ? uSkyNightTop : uSkyDayTop); }
vec3 skyBot() { return uScheme == 1 ? uSkyDuskBot : (uScheme == 2 ? uSkyNightBot : uSkyDayBot); }
`;

const FS_BODY = `
void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y * uScale - gl_FragCoord.y) / uScale;

  // ---------- 天空：竖向渐变（顶 → 地平线），带一点大块水彩晕染让颜色不死板 ----------
  float vy = clamp(p.y / uRes.y, 0.0, 1.0);
  vec3 col = mix(skyBot(), skyTop(), pow(vy, 0.85));
  float w1 = N(p, 1900.0).b, w2 = N(p + 311.0, 650.0).g;
  col = mix(col, col * 1.06, ss(0.3, 0.75, w1 * 0.7 + w2 * 0.3) * 0.5);    // 浅色的云絮晕染
  col *= 1.0 + (hash2(floor(p * (0.8 * max(uScale, 1.0)))) - 0.5) * 0.03;   // 颗粒按屏幕的实际像素取

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

  // ---------- 云投在天空上的影子（右下方）：淡淡的蓝灰 ----------
  float sd = cloudDist(p - uShadowOff);
  col = mix(col, col * uCloudShadow, ss(3.0, -3.0, sd) * 0.5);

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

export class SkyEngine extends SceneEngine {
  static FS = FS_HEADER + GLSL_COMMON + GLSL_CLOUD + FS_BODY;   // 片元着色器（SceneEngine 约定）

  constructor(canvas, opts = {}) {
    super(canvas, opts);
    // 面板配置：应用层 DeskApp 直接读取（主题只加配置，不改宿主代码）
    this.sliders = [
      { key: 'sigma', label: '云团大小', min: 40, max: 200, step: 1,    fmt: v => v + ' px', act: 'field' },
      { key: 'cover', label: '天上的云', min: 0, max: 1,   step: 0.01, fmt: v => Math.round(v * 100) + '%' },
      { key: 'flow',  label: '流动速度', min: 0, max: 3,   step: 0.05, fmt: v => '×' + v.toFixed(2) },
    ];
    this.displayKeys = [
      { key: 'adaptive', min: 0, max: 1 },
      { key: 'scheme',   min: 0, max: 2 },   // 0 白天 / 1 傍晚 / 2 晚上
    ];
  }

  defaultParams() {
    // 默认值要和 themes.json 里天空主题的 default 保持一致；grain、quality 不开放调节
    return {
      sigma: 72, warp: 40, edge: 10, cover: 0.3, flow: 1, grain: 1, quality: 2,   // quality 2：按屏幕的实际像素画（150% 缩放时不再放大发糊）
      debug: false, snap: true, cap30: true,
      adaptive: 1, scheme: 0,
    };
  }

  buildScenePalette() {
    return {
      shadow:      this.sceneToken('--scene-shadow')         || [0.56, 0.66, 0.52],
      cloudHi:     this.sceneToken('--scene-cloud-hi')       || [1.0, 1.0, 0.99],
      cloudBody:   this.sceneToken('--scene-cloud-body')     || [0.90, 0.93, 0.96],
      cloudSh:     this.sceneToken('--scene-cloud-shade')    || [0.80, 0.85, 0.90],
      cloudShadow: this.sceneToken('--scene-cloud-shadow')   || [0.78, 0.84, 0.92],
      lightDir:    this.sceneToken('--scene-light-dir')      || [-0.6, -0.8],
      shadowOff:   this.sceneToken('--scene-shadow-offset')  || [115.0, 156.0],
      skyDayTop:    this.sceneToken('--scene-sky-day-top')    || [0.27, 0.56, 0.88],
      skyDayBot:    this.sceneToken('--scene-sky-day-bottom') || [0.62, 0.82, 0.96],
      skyDuskTop:   this.sceneToken('--scene-sky-dusk-top')   || [0.28, 0.30, 0.58],
      skyDuskBot:   this.sceneToken('--scene-sky-dusk-bottom')|| [0.98, 0.66, 0.42],
      skyNightTop:  this.sceneToken('--scene-sky-night-top')  || [0.04, 0.06, 0.16],
      skyNightBot:  this.sceneToken('--scene-sky-night-bottom')|| [0.20, 0.26, 0.44],
    };
  }

  // 天空特有的 uniform：时段、云影色、三种时段的天空渐变
  applyThemeUniforms(U) {
    const gl = this.gl, S = this.scene;
    if (U.uScheme) gl.uniform1i(U.uScheme, this.params.scheme | 0);
    if (U.uCloudShadow) gl.uniform3fv(U.uCloudShadow, S.cloudShadow);
    if (U.uSkyDayTop) gl.uniform3fv(U.uSkyDayTop, S.skyDayTop);
    if (U.uSkyDayBot) gl.uniform3fv(U.uSkyDayBot, S.skyDayBot);
    if (U.uSkyDuskTop) gl.uniform3fv(U.uSkyDuskTop, S.skyDuskTop);
    if (U.uSkyDuskBot) gl.uniform3fv(U.uSkyDuskBot, S.skyDuskBot);
    if (U.uSkyNightTop) gl.uniform3fv(U.uSkyNightTop, S.skyNightTop);
    if (U.uSkyNightBot) gl.uniform3fv(U.uSkyNightBot, S.skyNightBot);
  }
}
