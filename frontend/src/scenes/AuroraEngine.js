// 夜航 · 极光 主题引擎：复用 SceneEngine 的陆地场（图标让位）与云的圆机制，
// 只替换天空部分为「夜空 + 星 + 月亮 + 极光带 + 流星」，并把云染上极光色。
//
// 过渡期约定：渲染上下文与共享状态由 DeskApp 挂到 window。

import { SceneEngine } from '../engine/SceneEngine.js';
import { GLSL_COMMON, GLSL_CLOUD } from '../engine/glsl/common.js';

// 头部：本主题自己的 uniform 声明与常量；函数体在 common.js，主体（main）在下面
const FS_HEADER = `#version 300 es
precision highp float;
uniform sampler2D uNoise, uFA, uFB, uCirc;
uniform vec2 uRes, uGrid, uCGrid;
uniform float uScale, uSeed, uStep, uMix, uTime, uEdge, uCellG;
uniform vec3 uSkyTop, uSkyBot, uAurA, uAurB, uCloudHi, uCloudBody, uCloudSh, uCloudShadow, uMoonCol;
uniform vec2 uLightDir, uShadowOff;
uniform float uAurora, uStars;
out vec4 o;
`;

const FS_BODY = `
void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y * uScale - gl_FragCoord.y) / uScale;
  float vy = clamp(p.y / uRes.y, 0.0, 1.0);

  // 夜空渐变 + 轻微水彩晕染
  vec3 col = mix(uSkyBot, uSkyTop, pow(vy, 0.9));
  float w1 = N(p, 1900.0).b, w2 = N(p + 311.0, 650.0).g;
  col = mix(col, col * 1.05, ss(0.3, 0.8, w1 * 0.7 + w2 * 0.3) * 0.5);

  // 星点（网格 hash，密度由 uStars 控制）
  vec2 cell = floor(p / 170.0);
  float h = hash2(cell);
  if (h > mix(0.90, 0.55, uStars)) {
    vec2 sp = (cell + 0.5 + 0.4 * vec2(hash2(cell + 1.3), hash2(cell + 2.7))) * 170.0;
    float d = length(p - sp);
    float tw = 0.5 + 0.5 * sin(uTime * (1.0 + h * 3.0) + h * 40.0);
    col += vec3(0.9, 0.95, 1.0) * (1.0 - smoothstep(0.2, 1.8, d)) * tw * 0.9;
  }

  // 月亮 + 光晕 + 两个暗斑
  vec2 mp = vec2(uRes.x * 0.80, uRes.y * 0.80);
  float md = length(p - mp);
  col += uMoonCol * 0.10 * (1.0 - smoothstep(20.0, 120.0, md));
  col += uMoonCol * (1.0 - smoothstep(24.0, 26.0, md));
  col = mix(col, uMoonCol * 0.80, (1.0 - smoothstep(7.0, 8.0, length(p - (mp + vec2(-6.0, -4.0))))) * 0.5);
  col = mix(col, uMoonCol * 0.80, (1.0 - smoothstep(4.0, 5.0, length(p - (mp + vec2(7.0, 6.0))))) * 0.5);

  // 三条极光波带（噪声流动，绿主紫副）
  for (int b = 0; b < 3; b++) {
    float fb = float(b);
    float baseY = uRes.y * (0.55 + fb * 0.12);
    float w = sin(p.x * 0.006 + uTime * (0.4 + fb * 0.15) + fb) * 22.0
            + sin(p.x * 0.017 - uTime * 0.6) * 10.0;
    float d = p.y - (baseY + w);
    float band = 1.0 - smoothstep(6.0, 80.0, abs(d));
    float n = N(p + vec2(0.0, uTime * 8.0), 700.0).r;
    vec3 ac = mix(uAurA, uAurB, fb * 0.5);
    col += ac * band * (0.10 + 0.55 * n) * uAurora * (1.0 - 0.25 * vy);
  }

  // 流星（每 7 秒划过一次）：尾迹在头部后方（along < 0）
  float cyc = mod(uTime, 7.0);
  float has = step(cyc, 1.1);
  vec2 mstart = vec2(uRes.x * 0.72, uRes.y * 0.16);
  vec2 mvec = normalize(vec2(-0.82, 0.42));
  vec2 mpos = mstart + mvec * (cyc * 200.0);
  vec2 rel = p - mpos;
  float side = abs(dot(rel, vec2(-mvec.y, mvec.x)));
  float along = dot(rel, mvec);
  col += vec3(1.0) * has * (1.0 - smoothstep(0.0, 2.2, length(rel))) * 0.85;
  col += vec3(1.0) * has * (1.0 - smoothstep(0.0, 120.0, side)) * step(0.0, -along) * step(-along, 160.0) * 0.22;

  // 云影（云投在天空上）
  float sd = cloudDist(p - uShadowOff);
  col = mix(col, col * uCloudShadow, ss(3.0, -3.0, sd) * 0.5);

  // 云（复用同一套圆机制；朝光一道亮边，被极光染一点绿）
  vec4 fc = vec4(0.0, -1e9, 0.0, 0.0);
  float d2 = cloudDist(p, true, fc);
  if (d2 < 1.5) {
    float hi = d2 > -21.0 ? ss(-1.0, 1.0, cloudDist(p + uLightDir * 20.0)) : 0.0;
    vec3 cc = fc.y > -1e8 ? mix(uCloudBody, uCloudSh, fc.w * 0.6) : mix(uCloudBody, uCloudSh, 0.45);
    cc = mix(cc, uAurA, 0.16 * ss(0.3, 0.9, p.y / uRes.y));
    cc = mix(cc, uCloudHi, hi);
    col = mix(col, cc, ss(1.0, -1.0, d2));
  }

  o = vec4(col, 1.0);
}`;

export class AuroraEngine extends SceneEngine {
  static FS = FS_HEADER + GLSL_COMMON + GLSL_CLOUD + FS_BODY;

  constructor(canvas, opts = {}) {
    super(canvas, opts);
    this.sliders = [
      { key: 'sigma',  label: '云团大小', min: 40, max: 200, step: 1,    fmt: v => v + ' px', act: 'field' },
      { key: 'cover',  label: '云量',     min: 0,  max: 1,   step: 0.01, fmt: v => Math.round(v * 100) + '%' },
      { key: 'flow',   label: '流动速度', min: 0,  max: 3,   step: 0.05, fmt: v => '×' + v.toFixed(2) },
      { key: 'aurora', label: '极光强度', min: 0,  max: 1.5, step: 0.01, fmt: v => Math.round(v * 100) + '%' },
      { key: 'stars',  label: '星星密度', min: 0,  max: 1,   step: 0.01, fmt: v => Math.round(v * 100) + '%' },
    ];
    this.displayKeys = [
      { key: 'adaptive', min: 0, max: 1 },
    ];
  }

  defaultParams() {
    return {
      sigma: 72, warp: 40, edge: 10, cover: 0.3, flow: 1, aurora: 0.9, stars: 0.55,
      grain: 1, quality: 2, debug: false, snap: true, cap30: true, adaptive: 1,
    };
  }

  buildScenePalette() {
    return {
      skyTop:      this.sceneToken('--scene-sky-top')       || [0.03, 0.05, 0.14],
      skyBot:      this.sceneToken('--scene-sky-bottom')    || [0.08, 0.12, 0.26],
      aurA:        this.sceneToken('--scene-aurora-a')      || [0.24, 0.86, 0.59],
      aurB:        this.sceneToken('--scene-aurora-b')      || [0.48, 0.38, 1.00],
      cloudHi:     this.sceneToken('--scene-cloud-hi')      || [0.75, 0.92, 0.86],
      cloudBody:   this.sceneToken('--scene-cloud-body')    || [0.30, 0.42, 0.62],
      cloudSh:     this.sceneToken('--scene-cloud-shade')   || [0.20, 0.28, 0.46],
      cloudShadow: this.sceneToken('--scene-cloud-shadow')  || [0.16, 0.22, 0.40],
      lightDir:    this.sceneToken('--scene-light-dir')     || [-0.6, -0.8],
      shadowOff:   this.sceneToken('--scene-shadow-offset') || [115.0, 156.0],
      moonCol:     this.sceneToken('--scene-moon')          || [0.91, 0.89, 0.82],
    };
  }

  applyThemeUniforms(U) {
    const gl = this.gl, S = this.scene;
    if (U.uSkyTop) gl.uniform3fv(U.uSkyTop, S.skyTop);
    if (U.uSkyBot) gl.uniform3fv(U.uSkyBot, S.skyBot);
    if (U.uAurA) gl.uniform3fv(U.uAurA, S.aurA);
    if (U.uAurB) gl.uniform3fv(U.uAurB, S.aurB);
    if (U.uCloudShadow) gl.uniform3fv(U.uCloudShadow, S.cloudShadow);
    if (U.uMoonCol) gl.uniform3fv(U.uMoonCol, S.moonCol);
    if (U.uAurora) gl.uniform1f(U.uAurora, this.params.aurora);
    if (U.uStars) gl.uniform1f(U.uStars, this.params.stars);
  }
}
