// 夜航 · 极光 主题引擎：复用 CloudSceneEngine 的陆地场（图标让位）与云的圆机制，
// 只替换天空部分为「夜空 + 星 + 月亮 + 极光带 + 流星」，并把云染上极光色。
//
// 过渡期约定：渲染上下文与共享状态由 DeskApp 挂到 window。

import { CloudSceneEngine } from '../engine/CloudSceneEngine.js';
import { SceneEngine, numParam } from '../engine/SceneEngine.js';
import type { EngineOpts, EngineParams } from '../engine/BaseEngine.js';
import type { ScenePalette, Uniforms } from '../engine/SceneEngine.js';
import { GLSL_COMMON, GLSL_CLOUD } from '../engine/glsl/common.js';

// 头部：本主题自己的 uniform 声明与常量；函数体在 common.ts，主体（main）在下面
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

  // 星点：分层星等 + 色温微差 + 闪烁；密度由 uStars 控制
  {
    vec2 cell = floor(p / 190.0);
    float h = hash2(cell);
    if (h > mix(0.92, 0.45, uStars)) {
      vec2 sp = (cell + 0.5 + 0.4 * vec2(hash2(cell + 1.3), hash2(cell + 2.7))) * 190.0;
      float d = length(p - sp);
      float bright = step(0.90, h); // 少量亮星
      float tw = 0.65 + 0.35 * sin(uTime * (0.6 + h * 2.5) + h * 40.0);
      vec3 sc = mix(vec3(0.78, 0.87, 1.0), vec3(1.0, 0.93, 0.80), hash2(cell + 4.1)); // 色温微差
      col += sc * uStars * (0.55 + 0.45 * bright) * tw * 1.3 * (1.0 - smoothstep(0.3, 3.0, d));
      col += sc * uStars * bright * 0.7 * tw * (1.0 - smoothstep(0.6, 4.5, d)); // 亮星晕
    }
  }
  // 银河：斜向极淡亮带，不抢极光
  float gw = N(vec2((p.x + p.y * 0.55) / 780.0, 2.6), 1.0).g;
  col += vec3(0.55, 0.65, 0.9) * ss(0.30, 0.80, gw) * 0.06 * uStars;

  // 月亮：右上三分点 + 宽径向辉光 + 两个暗斑
  vec2 mp = vec2(uRes.x * 0.74, uRes.y * 0.30);
  float md = length(p - mp);
  col += uMoonCol * 0.09 * (1.0 - smoothstep(28.0, 95.0, md));
  col += uMoonCol * (1.0 - smoothstep(38.0, 40.0, md));
  col = mix(col, uMoonCol * 0.82, (1.0 - smoothstep(12.0, 14.0, length(p - (mp + vec2(-10.0, -7.0))))) * 0.5);
  col = mix(col, uMoonCol * 0.82, (1.0 - smoothstep(6.0, 8.0, length(p - (mp + vec2(13.0, 11.0))))) * 0.5);

  // 极光：地平线弧状亮带 + 竖向射线 + 上方幔（真实极光形态学结构）
  // 注意 p.y 向下（顶部 0）：弧带在中下部，射线向天空（p.y 减小方向）延伸
  float arcY = uRes.y * (0.60 + 0.045 * sin(p.x * 0.0035 + uTime * 0.05)
                             + 0.02 * sin(p.x * 0.0011 - uTime * 0.023));
  float dB = p.y - arcY;
  float bandIn = exp(-dB * dB / 1352.0);          // σ≈26px：窄而亮的地平线底边
  float bandOut = exp(-dB * dB / 32000.0) * 0.45; // σ≈126px：外溢辉光

  // 竖向射线：少而粗的光柱；x 极低频（整屏仅数个噪声平铺 → 每 200~400px 一条）
  vec2 rq = vec2(
    p.x / (520.0 + 480.0 * N(vec2(p.x / 1600.0, 8.8), 1.0).r) + uTime * 0.004,
    p.y / 700.0 - uTime * 0.006
  );
  float rn = N(rq, 1.0).r;
  // 帘幕包络：大尺度乘性组合，非帘幕区射线消失 → 几片独立的帘
  float curtain = ss(0.35, 0.75, N(vec2(p.x / 900.0, 4.2), 1.0).b);
  float rays = ss(0.42, 0.72, rn) * curtain;
  // 底部起辉 + 越往上越淡（顶端 0.22H 处消散，绝不顶到画外）
  float up = ss(arcY + 10.0, arcY - 30.0, p.y) * (1.0 - ss(uRes.y * 0.04, uRes.y * 0.22, p.y));

  float hf = ss(arcY, uRes.y * 0.12, p.y); // 底部绿 → 顶部紫
  vec3 aur = mix(uAurA, uAurB, hf * 0.75 + 0.15 * rn);

  float inten = uAurora * (1.0 - 0.15 * vy);
  col += aur * bandIn * 0.55 * inten;
  col += aur * bandOut * inten;
  // 沿程明暗：只沿纵向分段（不做横向调制，避免出现巨型斜斑）
  float rayShade = 0.75 + 0.25 * N(vec2(3.7, p.y / 480.0 - uTime * 0.012), 1.0).g;
  col += aur * rays * up * rayShade * 0.27 * inten;
  col += uAurB * up * 0.05 * (0.4 + 0.6 * rn) * inten;

  // 流星（每 7 秒划过一次）：只留头部小亮点；原先的宽尾迹会形成突兀的巨型斜带，P2 重做
  float cyc = mod(uTime, 7.0);
  float has = step(cyc, 1.1);
  vec2 mstart = vec2(uRes.x * 0.72, uRes.y * 0.16);
  vec2 mvec = normalize(vec2(-0.82, 0.42));
  vec2 mpos = mstart + mvec * (cyc * 200.0);
  vec2 rel = p - mpos;
  col += vec3(1.0) * has * (1.0 - smoothstep(0.0, 2.6, length(rel))) * 0.9;

  // 云只出现在中下部（cloudVis 从顶部向下滑入）：夜空主体留给极光与星空
  float cloudVis = ss(uRes.y * 0.22, uRes.y * 0.55, p.y);

  // 云影（云投在天空上）
  float sd = cloudDist(p - uShadowOff);
  col = mix(col, col * uCloudShadow, ss(3.0, -3.0, sd) * 0.25 * cloudVis);

  // 云（复用同一套圆机制；朝光一道亮边，被极光染一点绿）
  vec4 fc = vec4(0.0, -1e9, 0.0, 0.0);
  float d2 = cloudDist(p, true, fc);
  if (d2 < 1.5) {
    float hi = d2 > -21.0 ? ss(-1.0, 1.0, cloudDist(p + uLightDir * 20.0)) : 0.0;
    vec3 cc = fc.y > -1e8 ? mix(uCloudBody, uCloudSh, fc.w * 0.6) : mix(uCloudBody, uCloudSh, 0.45);
    cc *= mix(vec3(0.6, 0.67, 0.82), vec3(1.0), ss(uRes.y * 0.35, uRes.y * 0.85, p.y)); // 空气透视：越高（远）越暗
    cc = mix(cc, uAurA, 0.16 * ss(0.3, 0.9, p.y / uRes.y));
    cc = mix(cc, uCloudHi, hi * 0.6);
    col = mix(col, cc, ss(1.0, -1.0, d2) * cloudVis);
  }

  o = vec4(col, 1.0);
}`;

export class AuroraEngine extends CloudSceneEngine {
  static override FS = FS_HEADER + GLSL_COMMON + GLSL_CLOUD + FS_BODY;

  constructor(canvas: HTMLCanvasElement, opts: EngineOpts = {}) {
    super(canvas, opts);
    this.sliders = [
      { key: 'sigma', label: '云团大小', min: 40, max: 200, step: 1, fmt: (v) => v + ' px', act: 'field' },
      { key: 'cover', label: '云量', min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) + '%' },
      { key: 'flow', label: '流动速度', min: 0, max: 3, step: 0.05, fmt: (v) => '×' + v.toFixed(2) },
      { key: 'aurora', label: '极光强度', min: 0, max: 1.5, step: 0.01, fmt: (v) => Math.round(v * 100) + '%' },
      { key: 'stars', label: '星星密度', min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) + '%' },
    ];
    this.displayKeys = [{ key: 'adaptive', min: 0, max: 1 }];
  }

  // 云的分布与形态：只在中下部、更小、边缘碎圆更少（去“鱼鳞”感）
  protected override skyCloudTuning(): { yMin: number; yMax: number; scale: number; edgeScale: number } {
    return {
      yMin: this.H * 0.5,
      yMax: this.H - SceneEngine.TASKBAR - 40,
      scale: 0.8,
      edgeScale: 1.7,
    };
  }

  override defaultParams(): EngineParams {
    return {
      sigma: 72,
      warp: 40,
      edge: 10,
      cover: 0.12,
      flow: 1,
      aurora: 0.9,
      stars: 0.55,
      grain: 1,
      quality: 2,
      debug: false,
      snap: true,
      cap30: true,
      adaptive: 1,
    };
  }

  override buildScenePalette(): ScenePalette {
    return {
      skyTop: this.sceneToken('--scene-sky-top'),
      skyBot: this.sceneToken('--scene-sky-bottom'),
      aurA: this.sceneToken('--scene-aurora-a'),
      aurB: this.sceneToken('--scene-aurora-b'),
      cloudHi: this.sceneToken('--scene-cloud-hi'),
      cloudBody: this.sceneToken('--scene-cloud-body'),
      cloudSh: this.sceneToken('--scene-cloud-shade'),
      cloudShadow: this.sceneToken('--scene-cloud-shadow'),
      lightDir: this.sceneToken('--scene-light-dir'),
      shadowOff: this.sceneToken('--scene-shadow-offset'),
      moonCol: this.sceneToken('--scene-moon'),
    };
  }

  override applyThemeUniforms(U: Uniforms): void {
    const gl = this.gl,
      S = this.scene;
    if (!gl) return;
    if (U.uSkyTop && S.skyTop) gl.uniform3fv(U.uSkyTop, S.skyTop);
    if (U.uSkyBot && S.skyBot) gl.uniform3fv(U.uSkyBot, S.skyBot);
    if (U.uAurA && S.aurA) gl.uniform3fv(U.uAurA, S.aurA);
    if (U.uAurB && S.aurB) gl.uniform3fv(U.uAurB, S.aurB);
    if (U.uCloudShadow && S.cloudShadow) gl.uniform3fv(U.uCloudShadow, S.cloudShadow);
    if (U.uMoonCol && S.moonCol) gl.uniform3fv(U.uMoonCol, S.moonCol);
    if (U.uAurora) gl.uniform1f(U.uAurora, numParam(this.params, 'aurora'));
    if (U.uStars) gl.uniform1f(U.uStars, numParam(this.params, 'stars'));
  }
}
