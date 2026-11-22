// 沙滩（海边）主题引擎：海滩着色器 + 皮划艇 / 海鸟 / 涟漪。
// 没有云，所以覆写 update / render，不碰基类的圆的机制。
//
// 过渡期约定：渲染上下文与共享状态（W/H/P/icons/seed/TASKBAR/FB/sampleArr）由 DeskApp 挂到 window，
// 让 beach-palms.js 等旧脚本继续以全局方式读取，行为保持 100% 一致。

import { SceneEngine } from '../engine/SceneEngine.js';
import { GLSL_COMMON } from '../engine/glsl/common.js';

const TASKBAR = 48;

// 头部：本主题自己的 uniform 声明、常量与海滩函数；公共的 hash2 / ss / N / fieldS 在 common.js。
// FS_PRE 是「main 之前」的部分：棕榈树着色器（beach-palms.js）复用同一批声明与函数。
const FS_HEADER = `#version 300 es
precision highp float;
uniform sampler2D uNoise, uFA, uFB;
uniform vec2 uRes, uGrid;
uniform float uScale, uSeed, uStep, uMix, uTime, uSpeed, uRunup, uShallow, uShoal, uGrain, uDebug, uWave, uSigma, uSpacing, uWaves;
uniform float uKayN;
uniform vec4 uKay[4];          // x, y, 朝向, 划桨相位
uniform vec4 uRip[6];
uniform float uBirdN;
uniform vec4 uBird[8];         // x, y, 朝向, 翅膀展开程度
out vec4 o;

// ---- 调色板（由主题 theme.css 的 --scene-* Token 驱动，JS 读取后传入）----
uniform vec3 uSea0, uSea1, uSea2, uSea3, uSea4;   // 海：近岸 → 远处
uniform vec3 uSand0, uSand1, uSand2, uSand3;       // 沙：干 → 最湿（淡紫灰）
uniform vec3 uFoam;                                // 浪花
uniform vec3 uWetSand;                             // 湿沙：被水泡过的沙子，比干沙深一点、偏黄

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
`;

const FS_FUNCS = `
vec3 seaRamp(float v) {
  v = clamp(v, 0.0, 1.0) * 4.0;
  if (v < 1.0) return mix(uSea0, uSea1, v);
  if (v < 2.0) return mix(uSea1, uSea2, v - 1.0);
  if (v < 3.0) return mix(uSea2, uSea3, v - 2.0);
  return mix(uSea3, uSea4, v - 3.0);
}
vec3 sandRamp(float v) {
  v = clamp(v, 0.0, 1.0) * 3.0;
  if (v < 1.0) return mix(uSand0, uSand1, v);
  if (v < 2.0) return mix(uSand1, uSand2, v - 1.0);
  return mix(uSand2, uSand3, v - 2.0);
}
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
// Worley（细胞）噪声：x = F1，y = F2。F2 - F1 很小的地方是细胞边界 → 用来画光网、碎沫网
vec2 worley(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y)), c = i + g;
    vec2 r = g + vec2(hash(c + uSeed), hash(c + uSeed + 17.3)) * 0.8 + 0.1 - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return vec2(sqrt(d1), sqrt(d2));
}
// 皮划艇船身：两头尖的梭形，返回有符号距离（<0 在船内）
float hullSD(vec2 q) {
  float L = 22.0, Wd = 5.4;
  float t = clamp(q.x / L, -1.0, 1.0);
  float w = Wd * (1.0 - t * t);
  return max(abs(q.y) - w, abs(q.x) - L);
}
float segSD(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
// 桨：一根细杆 + 两头红色桨叶
vec2 paddleSD(vec2 q, float ph) {
  float a = 1.5708 + sin(ph) * 0.55;
  vec2 dir = vec2(cos(a), sin(a)) , c = vec2(0.5, 0.0);
  float shaft = segSD(q, c - dir * 13.0, c + dir * 13.0) - 0.7;
  vec2 b1 = q - (c + dir * 13.5), b2 = q - (c - dir * 13.5);
  mat2 r = rot(-a);
  vec2 l1 = r * b1, l2 = r * b2;
  float blade = min(length(l1 / vec2(3.6, 1.6)) - 1.0, length(l2 / vec2(3.6, 1.6)) - 1.0) * 1.6;
  return vec2(shaft, blade);
}
// 海鸥（俯视，x 朝前）：返回 (身子, 翅膀, 翅膀上的位置 0 根 → 1 尖)；span = 翅膀展开程度，扇动时变短
vec3 gullSD(vec2 q, float span) {
  float body = (length((q - vec2(0.8, 0.0)) / vec2(6.2, 1.9)) - 1.0) * 1.9;
  float tail = max(abs(q.y) - 1.4 - (-q.x - 4.0) * 0.25, max(-q.x - 8.5, q.x + 4.0));
  float y = abs(q.y), reach = 15.0 * span;
  float u = clamp((y - 1.0) / reach, 0.0, 1.0);
  float lead = 1.0 + 1.3 * sin(u * 3.14159) - 4.0 * u * u;     // 前缘：中段微微前凸，翅尖向后掠
  float chord = mix(4.4, 1.3, u);
  float wing = max(max(q.x - lead, lead - chord - q.x), y - reach - 1.0);
  return vec3(min(body, tail), wing, u);
}
`;

const FS_MAIN = `void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y * uScale - gl_FragCoord.y) / uScale;
  float t = uTime;
  // 喷绘颗粒：约 1.3px 的随机点（静止，像印刷纸面上的颗粒）
  vec2 gp = floor(p * (0.78 * max(uScale, 1.0)));   // 按屏幕的实际像素取颗粒（高分屏上不会变成一块块的小方块）
  // 用 hash2：旧 hash 对整数坐标每几十像素循环一次，最亮的颗粒会排成一格格的点阵
  float g1 = hash2(gp + 0.5), g2 = hash2(gp + 7.3);
  float gAmt = uGrain;

  float s0 = mix(fieldS(uFA, p), fieldS(uFB, p), uMix);
  float s = s0 + (N(p, 700.0).r - 0.5) * 10.0;

  // 浪的时钟：沿岸只有大尺度的先后差异，一长段海岸整齐地涌上来
  float wv = uWave;                                // 浪的大小：放大线宽、水雾
  float lam = uSpacing;                            // 浪的间距（px）
  // 沿岸的先后差异要很平缓：用最粗的一层噪声、放大尺度。原来 r 通道带 37px 的细节，
  // 沿岸走一百来像素浪的节奏就差四分之一拍，新浪的侧边从岸线陡直地立起来，两拍交界处白边戛然而止（像个缺口）
  float along = N(p, 4200.0).b * 1.2;
  float u = t * uSpeed / lam + along;             // 每 1.0 = 一道浪
  float fu = fract(u), cyc = floor(u);

  // 浪的能量：只有开阔海面才起浪。往陆地、往海各探一段：
  // 陆地太窄（探到对面的水）或水域太小（探不到深水）→ 浪减弱到平静
  vec2 gr = vec2(dFdx(s0), -dFdy(s0));
  vec2 nrm = length(gr) > 1e-4 ? normalize(gr) : vec2(0.0, 1.0);
  float sIn = mix(fieldS(uFA, p - nrm * 45.0), fieldS(uFB, p - nrm * 45.0), uMix);
  float sOut = mix(fieldS(uFA, p + nrm * 70.0), fieldS(uFB, p + nrm * 70.0), uMix);
  float energy = mix(ss(2.0, -18.0, sIn), 1.0, ss(15.0, 40.0, s)) * ss(25.0, 70.0, sOut);
  // 沙滩上（冲上来的薄水、湿沙带）用"岸线处"的能量：沿法线回到岸线上再往两边探。
  // 不能按像素自己的位置探——越往岸上离开阔水面越远、能量越小，薄水冲多远就取决于像素自己在哪，
  // 岸线一拐弯探的方向变得快，前沿就出现台阶和缺口
  // sW：薄水层用的"离岸距离"。往岸上走，岸线急拐弯处的等距线会收成尖角（湿痕、水膜前沿出现楔形），
  // 所以用周围 10px 的平均值把尖角磨圆；贴着水边时仍用原值，水膜和岸线对得上
  float shoreE = 0.0, sW = s;
  if (s < 4.0 && s > -uSigma * 0.78 - 12.0) {         // 只有薄水冲得到的那一条沙滩需要（再往里的干沙不用算）
    // 法线也用前后左右的差来算：dFdx 在场纹理每个 5px 格子边上会跳，拐角处探的位置跟着跳
    #define SF(q) mix(fieldS(uFA, q), fieldS(uFB, q), uMix)
    float fR = SF(p + vec2(10.0, 0.0)), fL = SF(p - vec2(10.0, 0.0)), fD = SF(p + vec2(0.0, 10.0)), fU = SF(p - vec2(0.0, 10.0));
    vec2 g10 = vec2(fR - fL, fD - fU);
    vec2 n10 = length(g10) > 1e-3 ? normalize(g10) : nrm;
    vec2 sp = p - n10 * s0;
    float eIn = SF(sp - n10 * 45.0), eOut = SF(sp + n10 * 70.0);
    shoreE = ss(2.0, -18.0, eIn) * ss(25.0, 70.0, eOut);
    sW = mix(s, (fR + fL + fD + fU) * 0.25 + (s - s0), ss(-2.0, -16.0, s));
  }

  vec3 col;
  if (s > 2.0) {
    // ---------- 海 ----------
    float depth = pow(clamp(max(s - uShoal * 0.45, 0.0) / (uShallow * 1.3), 0.0, 1.0), 0.62);
    col = seaRamp(depth + (g1 - 0.5) * 0.09 * gAmt);                               // 颗粒渐变

    // 斑驳光斑：扭曲后的噪声取阈值，边缘用颗粒打散；越近岸越密；缓慢流动
    vec2 drift = vec2(t * 2.2, t * 0.9);
    // 海面不画纹理：只有极淡、缓慢流动的大块明暗；深海零星闪烁的阳光反光点
    float deepK = ss(uShallow * 0.35, uShallow * 1.1, s);
    col *= 1.0 + (N(p + drift * 4.0, 1600.0).r - 0.5) * 0.07 * ss(0.0, uShoal + 40.0, s);
    // 阳光反光点：两层大小不同、互相旋转错开的格子，每格随机放一个点（位置、大小、闪烁节奏都随机），
    // 再按大尺度噪声成片聚集 → 看不出格子
    float glitter = ss(0.32, 0.72, N(p + drift * 3.0, 520.0).g) * deepK;
    float spark = 0.0;
    for (int L = 0; L < 2; L++) {
      float fl = float(L), cs = L == 0 ? 23.0 : 37.0;
      mat2 R = rot(L == 0 ? 0.62 : -1.13);
      vec2 q = R * p / cs + fl * 17.3;
      vec2 cell = floor(q), f = fract(q);
      vec2 seedc = cell + fl * 51.7 + uSeed * 0.1;
      if (hash2(seedc) > (L == 0 ? 0.11 : 0.16) * glitter) continue;
      vec2 c = 0.15 + 0.7 * vec2(hash2(seedc + 1.3), hash2(seedc + 2.9));
      float life = fract(t * (0.3 + 0.35 * hash2(seedc + 8.1)) + hash2(seedc + 5.7));
      float tw = ss(0.0, 0.1, life) * (1.0 - ss(0.2, 0.45, life));
      float r = 0.7 + 0.9 * hash2(seedc + 3.3);
      spark = max(spark, (1.0 - ss(r * 0.5, r * 1.5, length((f - c) * cs))) * tw);
    }
    col = mix(col, vec3(0.95, 1.0, 1.0), spark * 0.85);

    // 透明浅滩：水浅到能看见沙底，越往外越被青绿色盖住（过渡同样用颗粒喷出来）
    float shoal = uShoal;
    float k = clamp(ss(shoal * 0.15, shoal * 1.25, s) + (g2 - 0.5) * 0.16 * gAmt, 0.0, 1.0);
    if (k < 1.0) {
      vec3 bed = mix(vec3(0.97, 0.91, 0.79), vec3(0.88, 0.90, 0.77), ss(0.0, shoal, s));
      vec3 tint = mix(vec3(0.93, 0.99, 0.96), vec3(0.62, 0.92, 0.88), ss(0.0, shoal * 0.9, s));
      col = mix(bed * tint, col, k);
    }
    // 贴岸的一段水底是湿沙：从岸线处的湿沙色慢慢过渡到浅滩的沙底色，和沙滩那边接得上，水里没有一道边
    col = mix(col, mix(sandRamp((g1 - 0.5) * 0.1 * gAmt), uWetSand, 0.6), 1.0 - ss(2.0, 38.0, s));

    // 皮划艇的影子（清澈的水，影子落在海底）
    float shadow = 0.0;
    for (int i = 0; i < 4; i++) {
      if (float(i) >= uKayN) break;
      vec4 k = uKay[i];
      vec2 q2 = rot(-k.z) * (p - k.xy - vec2(8.0, 13.0));
      float sd = hullSD(q2);
      vec2 pd = paddleSD(q2, k.w);
      shadow = max(shadow, ss(1.6, -1.6, min(sd, min(pd.x, pd.y))));
    }
    col = mix(col, col * vec3(0.62, 0.78, 0.84), shadow * 0.7);

    // 涟漪：细白圈
    float rip = 0.0;
    for (int i = 0; i < 6; i++) {
      vec4 r = uRip[i];
      if (r.w <= 0.0) continue;
      float dist = length(p - r.xy), rad = r.z * 80.0;
      rip = max(rip, (1.0 - ss(0.8, 2.0, abs(dist - rad))) * exp(-r.z * 1.4) * r.w);
      rip = max(rip, (1.0 - ss(0.6, 1.6, abs(dist - rad * 0.6))) * exp(-r.z * 1.8) * r.w * 0.6);
    }
    col = mix(col, uFoam, step(g2, rip * 0.95));

    // ---------- 海里的浪 ----------
    float dd = s - 2.0;
    // 远一点的浪线：向岸推进，到岸的那一刻正好推出一层薄水
    float ph = (s + t * uSpeed) / lam + along;
    float fr = fract(ph);
    float dpx = min(fr, 1.0 - fr) * lam;
    // 浪从远处推进到岸边：离岸约 1.35 个浪距处淡淡出现，越近越实（海里平时只有一道浪线）；一直推到水边才消失（不提前淡出，
    // 否则浪线没到岸就没了，到岸那一下的水雾像是凭空冒出来的）
    float vis = (1.0 - ss(lam * 0.45, lam * 1.35, s)) * ss(0.0, 4.0, dd) * energy;
    // 靠近岸开始破碎：浪线变粗、更白，身后的颗粒水雾更多
    float brk = 1.0 - ss(8.0, 55.0, s);
    float cw = wv * (1.0 + 0.8 * brk);
    float crest = (1.0 - ss(0.7 * cw, 1.9 * cw, dpx)) * vis * (0.55 + 0.4 * brk);
    float crestSpray = exp(-fr * lam / (7.0 * cw)) * vis * (0.25 + 0.4 * brk);        // 浪线后方的颗粒水雾
    // 浪到岸的那一刻再轻轻迸一下水雾（只是推上来的浪的延续，不是主角）
    float burst = exp(-fu * 4.5) * ss(0.0, 0.04, fu);
    float spray = exp(-dd / (6.0 * wv)) * burst * energy * 0.45;
    float foam = max(crest, step(g2, max(spray, crestSpray)));
    col = mix(col, uFoam, foam);
  } else {
    // ---------- 沙滩（干沙 + 靠水的一窄条常湿带）----------
    float wet = ss(-7.0 - 3.0 * shoreE, 1.0, s) * 0.2;
    col = mix(sandRamp((g1 - 0.5) * 0.1 * gAmt), uWetSand, wet * 3.0);
    col *= 1.0 - 0.03 * ss(0.4, 0.8, N(p, 900.0).r) * (1.0 - wet);               // 干沙上极轻的大块明暗
  }

  // ---------- 一层层冲上沙滩的薄水 ----------
  // 同时有 3 层：各自推进 → 停住 → 回落，最高点各不相同；前沿一道颗粒白边，退去后留下慢慢消失的湿痕
  // 冲得再高也不淹到图标：图标边缘大约在 s ≈ -离岸距离 处，留出余量
  // ×0.25：开阔岸边冲浪幅度 120 时约冲上 30px，和原来（按像素位置探能量时实际达到的）一样
  float reachBase = min(uRunup * 0.25 * shoreE * (0.85 + 0.3 * N(p, 900.0).g), uSigma * 0.78);
  // 薄水、湿痕不在岸线处一刀切：往海里再延伸一段、慢慢淡出（开阔岸边才有，小水塘里没有浪）
  float wk = (1.0 - ss(2.0, 38.0, s)) * mix(1.0, energy, ss(2.0, 10.0, s));
  if ((s < 4.0 && reachBase > 0.5) || (s >= 4.0 && wk > 0.01)) {
    vec3 FILM = uWetSand, MARK = uWetSand * 0.97;
    float onSand = step(s, 4.0);                                                  // 前沿白边只画在沙滩上
    // 薄水退去时留下的网状碎沫（跟着回流的水往海里漂）
    vec2 wl = worley((p - nrm * fu * 8.0) / 7.0);
    float laceNet = (1.0 - ss(0.03, 0.1, wl.y - wl.x)) * ss(0.4, 0.62, N(p + vec2(t * 2.0, 0.0), 120.0).g);
    float wetMem = 0.0, filmA = 0.0;
    vec4 layers[3];
    for (int j = 0; j < 3; j++) {
      float a = fu + float(j);                                                    // 这一层的"年龄"（单位：一道浪的周期）
      float amp = reachBase * (0.5 + 0.5 * hash(vec2(cyc - float(j), 3.7)));
      float front = a < 0.45 ? mix(3.0, -amp, 1.0 - pow(1.0 - a / 0.45, 2.2))    // 推进：先快后慢
                             : mix(-amp, 3.0, ss(0.45, 1.4, a));                  // 回落
      float reached = ss(-amp - 4.0, -amp + 12.0, sW);                         // 边缘很软：不留一道线
      wetMem = max(wetMem, reached * (1.0 - ss(0.45, 2.8, a)) * ss(0.2, 0.45, a));
      float alpha = a < 0.45 ? 0.42 : 0.42 * (1.0 - ss(0.45, 1.4, a));
      // 回落的水边会越退越薄、没有清楚的边：上沿逐渐羽化，和后面冲上来的浪交叉时不会出现一个硬角（缺口）
      float feather = 1.0 + 16.0 * ss(0.45, 1.1, a);
      filmA = max(filmA, ss(front - 1.0, front + feather, sW) * alpha * 1.6);
      layers[j].w = feather;
      layers[j].xyz = vec3(front, a, amp);
    }
    // 湿痕：水到过的地方沙子更深一点（偏黄的湿沙色），只是淡淡一层
    col = mix(col, MARK, wetMem * 0.18 * wk);
    // 冲上来的薄水：几层重叠的地方只算最厚的那层（一层层相乘会越叠越暗）。
    // 被水盖住的沙子变成偏黄的湿沙色（一部分相乘、保留下面沙子的颗粒；一部分直接往湿沙色靠）。
    // 不能乘青绿：偏粉的沙子乘上青绿会互相抵消成灰色，岸边一圈发暗
    col = mix(col, mix(col * vec3(0.98, 0.96, 0.90), FILM, 0.6), filmA * wk);
    // 由老到新画薄水层的碎沫和白边
    for (int j = 2; j >= 0; j--) {
      float front = layers[j].x, a = layers[j].y, amp = layers[j].z;
      float cov = ss(front - 1.0, front + layers[j].w, sW);
      float lace = laceNet * cov * ss(0.4, 0.6, a) * (1.0 - ss(0.7, 1.4, a)) * wk;
      col = mix(col, uFoam, lace * 0.75);
      float edgeK = a < 0.45 ? 1.0 : 1.0 - ss(0.45, 1.05, a);
      float d = sW - front;
      float lineE = (1.0 - ss(0.8 * wv, 1.9 * wv, abs(d - 0.9 * wv))) * edgeK * onSand;    // 前沿白边
      float sprayE = exp(-max(d, 0.0) / (5.0 * wv)) * cov * edgeK * 0.5 * onSand;         // 白边身后的颗粒水雾
      col = mix(col, uFoam, max(lineE * 0.95, step(g1, sprayE)));
    }
  }

  // ---------- 皮划艇 ----------
  for (int i = 0; i < 4; i++) {
    if (float(i) >= uKayN) break;
    vec4 k = uKay[i];
    vec2 q = rot(-k.z) * (p - k.xy);
    if (dot(q, q) > 900.0) continue;
    float sd = hullSD(q);
    vec2 pd = paddleSD(q, k.w);
    // 桨在船下面的部分先画
    vec3 kc = col;
    float a = 0.0;
    float mh = ss(0.7, -0.7, sd);
    if (mh > 0.0) {
      float tt = clamp(q.x / 22.0, -1.0, 1.0);
      float wd = 5.4 * (1.0 - tt * tt);
      vec3 hull = mix(vec3(0.99, 0.84, 0.16), vec3(1.0, 0.93, 0.45), 1.0 - ss(0.2, 0.7, abs(q.y) / max(wd, 0.5)));
      hull = mix(hull, vec3(0.90, 0.64, 0.10), ss(0.78, 1.0, abs(q.y) / max(wd, 0.5)));
      // 甲板上的白色小圆点（舱口盖）
      hull = mix(hull, vec3(0.97, 0.96, 0.9), 1.0 - ss(1.0, 1.6, length(q - vec2(13.0, 0.0))));
      hull = mix(hull, vec3(0.97, 0.96, 0.9), 1.0 - ss(1.0, 1.6, length(q - vec2(-12.0, 0.0))));
      // 座舱
      hull = mix(hull, vec3(0.30, 0.24, 0.20), 1.0 - ss(0.0, 0.6, length((q - vec2(-1.0, 0.0)) / vec2(6.0, 2.8)) - 1.0));
      kc = mix(kc, hull, mh); a = max(a, mh);
    }
    // 人：橙色救生衣 + 深色头
    float body = ss(0.5, -0.5, length(q - vec2(-1.5, 0.0)) - 3.3);
    kc = mix(kc, vec3(0.96, 0.55, 0.18), body);
    float head = ss(0.5, -0.5, length(q - vec2(0.2, 0.0)) - 2.0);
    kc = mix(kc, vec3(0.22, 0.17, 0.16), head);
    // 桨
    float sh = ss(0.5, -0.5, pd.x), bl = ss(0.5, -0.5, pd.y);
    kc = mix(kc, vec3(0.28, 0.24, 0.26), sh);
    kc = mix(kc, vec3(0.90, 0.28, 0.22), bl);
    col = kc;
  }

  // ---------- 海鸟：白身子、浅灰翅膀、黑翅尖的海鸥，飞得高，影子落得远 ----------
  for (int i = 0; i < 8; i++) {
    if (float(i) >= uBirdN) break;
    vec4 b = uBird[i];
    vec2 d0 = p - b.xy, d1 = d0 - vec2(34.0, 55.0);
    if (dot(d1, d1) < 400.0) {
      vec3 g = gullSD(rot(-b.z) * d1, b.w);
      col = mix(col, col * vec3(0.70, 0.74, 0.84), ss(1.8, -1.8, min(g.x, g.y)) * 0.28);
    }
    if (dot(d0, d0) < 400.0) {
      vec3 g = gullSD(rot(-b.z) * d0, b.w);
      vec3 wingC = mix(vec3(0.80, 0.84, 0.88), vec3(0.20, 0.22, 0.26), ss(0.72, 0.8, g.z));
      col = mix(col, wingC, ss(0.6, -0.6, g.y));
      col = mix(col, vec3(0.99, 0.99, 0.98), ss(0.6, -0.6, g.x));
      col = mix(col, vec3(0.98, 0.78, 0.22), ss(0.5, -0.5, length(rot(-b.z) * d0 - vec2(7.2, 0.0)) - 0.9));   // 黄嘴
    }
  }

  if (uDebug > 0.5) col = mix(col, vec3(0.9, 0.15, 0.15), 1.0 - ss(0.0, 1.5, abs(s0)));
  // 印刷感：整体再叠一层极轻的颗粒
  col *= 1.0 + (g2 - 0.5) * 0.035 * gAmt;
  o = vec4(col, 1.0);
}`;

// main 之前的部分（声明 + 公共函数 + 海滩函数）：海滩与棕榈树着色器共用
const FS_PRE = FS_HEADER + GLSL_COMMON + FS_FUNCS;
const FS = FS_PRE + FS_MAIN;

export class FlatEngine extends SceneEngine {
  static FS = FS;                                      // 片元着色器（SceneEngine 约定）

  constructor(canvas, opts = {}) {
    super(canvas, opts);
    // 面板配置：应用层 DeskApp 直接读取（主题只加配置，不改宿主代码）
    this.sliders = [
      { key: 'palms', label: '椰子树数量', min: 0, max: 10, step: 1, fmt: v => v + ' 棵' },
      { key: 'sigma', label: '离岸距离', min: 40, max: 200, step: 1, fmt: v => v + ' px', act: 'field' },
      { key: 'warp', label: '海岸曲折', min: 0, max: 80, step: 1, fmt: v => v, act: 'field' },
      { key: 'shoal', label: '透明浅滩', min: 0, max: 300, step: 1, fmt: v => v + ' px' },
      { key: 'shallow', label: '浅海宽度', min: 120, max: 700, step: 1, fmt: v => v + ' px' },
      { key: 'kayaks', label: '皮划艇', min: 0, max: 4, step: 1, fmt: v => v + ' 艘', act: 'kayaks' },
      { key: 'birds', label: '海鸟', min: 0, max: 8, step: 1, fmt: v => v + ' 只', act: 'birds' },
    ];
    this.displayKeys = [];
    // 皮划艇 / 海鸟 / 涟漪
    this.kayaks = [];
    this.birds = [];
    this.ripples = [];
    this.ripBuf = new Float32Array(24);
    this.kayBuf = new Float32Array(16);
    this.birdBuf = new Float32Array(32);
    this.palmPR = null;
  }

  defaultParams() {
    // 默认值要和 themes.json 里海边主题的 default 保持一致
    // 海浪（speed、runup、wave、spacing、waves）和 grain、quality 不再开放调节，固定为这里的值
    return {
      sigma: 85, warp: 34, shallow: 260, shoal: 110,
      speed: 22, runup: 120, wave: 1.6, spacing: 70, waves: 1, grain: 1, quality: 2,   // quality 2：按屏幕的实际像素画（150% 缩放时不再放大发糊）
      kayaks: 2, birds: 3, palms: 4, debug: false, snap: true, cap30: true,
      adaptive: 1,   // 基类 commit/refresh 用它判断是否把图标矩形计入陆地场（海滩始终要计）
    };
  }

  buildScenePalette() {
    return {
      sea0: this.sceneToken('--scene-sea-0') || [0.74, 0.93, 0.87],
      sea1: this.sceneToken('--scene-sea-1') || [0.47, 0.87, 0.84],
      sea2: this.sceneToken('--scene-sea-2') || [0.17, 0.76, 0.81],
      sea3: this.sceneToken('--scene-sea-3') || [0.03, 0.66, 0.79],
      sea4: this.sceneToken('--scene-sea-4') || [0.00, 0.56, 0.73],
      sand0: this.sceneToken('--scene-sand-0') || [0.97, 0.93, 0.88],
      sand1: this.sceneToken('--scene-sand-1') || [0.91, 0.85, 0.84],
      sand2: this.sceneToken('--scene-sand-2') || [0.82, 0.76, 0.79],
      sand3: this.sceneToken('--scene-sand-3') || [0.71, 0.67, 0.75],
      foam: this.sceneToken('--scene-foam') || [0.98, 0.99, 0.98],
      wetsand: this.sceneToken('--scene-wetsand') || [0.93, 0.86, 0.72],
    };
  }

  // 海滩特有的 uniform：海 / 沙 / 浪花 / 湿沙
  applyThemeUniforms(U) {
    const gl = this.gl, S = this.scene;
    if (U.uSea0) gl.uniform3fv(U.uSea0, S.sea0);
    if (U.uSea1) gl.uniform3fv(U.uSea1, S.sea1);
    if (U.uSea2) gl.uniform3fv(U.uSea2, S.sea2);
    if (U.uSea3) gl.uniform3fv(U.uSea3, S.sea3);
    if (U.uSea4) gl.uniform3fv(U.uSea4, S.sea4);
    if (U.uSand0) gl.uniform3fv(U.uSand0, S.sand0);
    if (U.uSand1) gl.uniform3fv(U.uSand1, S.sand1);
    if (U.uSand2) gl.uniform3fv(U.uSand2, S.sand2);
    if (U.uSand3) gl.uniform3fv(U.uSand3, S.sand3);
    if (U.uFoam) gl.uniform3fv(U.uFoam, S.foam);
    if (U.uWetSand) gl.uniform3fv(U.uWetSand, S.wetsand);
  }

  /* ======================================================================
     着色器：海滩 + 棕榈树（beach-palms.js 提供，复用海滩着色器的常量与函数）
     ====================================================================== */
  buildShaders() {
    super.buildShaders();
    if (typeof BEACH_PALM_FS === 'string' && typeof BEACH_PALM_VS === 'string') {
      // 显式拼接：FS_PRE 是海滩着色器 main 之前的部分（声明 + 公共函数 + 海滩函数）
      this.palmPR = this.program(FS_PRE + BEACH_PALM_FS, BEACH_PALM_VS);
    }
  }

  dispose() {
    super.dispose();
    this.palmPR = null;
    this.ripples.length = 0;
  }

  /* ======================================================================
     主循环：场插值 + 皮划艇 + 海鸟（没有云）
     ====================================================================== */
  update(dt, now) {
    const e = Math.min((now - this.morphT0) / this.morphDur, 1);
    this.curMix = e < 0.5 ? 2 * e * e : 1 - Math.pow(-2 * e + 2, 2) / 2;
    this.stepKayaks(dt, now);
    this.stepBirds(dt);
  }

  render(now) {
    const gl = this.gl;
    this.ripBuf.fill(0);
    this.ripples.forEach((r, i) => { const age = (now - r.t0) / 1000; if (age < 3) this.ripBuf.set([r.x, r.y, age, r.str], i * 4); });
    this.kayBuf.fill(0);
    this.kayaks.forEach((k, i) => this.kayBuf.set([k.x, k.y, k.h, k.ph], i * 4));
    this.birdBuf.fill(0);
    this.birds.forEach((b, i) => this.birdBuf.set([b.x, b.y, b.h, 0.68 + 0.32 * Math.cos(b.ph)], i * 4));

    this.configureBeachPass(now, this.PR);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (this.palmPR && typeof drawMaldivesPalms === 'function') drawMaldivesPalms(now, this.palmPR, this.configureBeachPass);
    // 同 SceneEngine：不再每 20 帧 readPixels 强制同步（实测海滩 6.3ms → 0ms）
  }

  configureBeachPass = (now, pass) => {
    const gl = this.gl, cv = this.cv, P = this.params, U = pass.U;
    gl.useProgram(pass.p);
    gl.viewport(0, 0, cv.width, cv.height);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.noiseTex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.ftex[this.fromI]);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.ftex[this.toI]);
    gl.uniform1i(U.uNoise, 0); gl.uniform1i(U.uFA, 1); gl.uniform1i(U.uFB, 2);
    gl.uniform2f(U.uRes, cv.width / cv._scale, cv.height / cv._scale);   // 和画布的实际像素对齐（innerWidth、innerHeight 是取整过的）
    gl.uniform2f(U.uGrid, this.Gw, this.Gh);
    gl.uniform1f(U.uScale, cv._scale);
    gl.uniform1f(U.uSeed, (this._seed % 997) * 0.37);
    gl.uniform1f(U.uStep, 5);
    gl.uniform1f(U.uMix, this.curMix);
    gl.uniform1f(U.uTime, this.sceneTime(now));
    gl.uniform1f(U.uSpeed, P.speed); gl.uniform1f(U.uRunup, P.runup);
    gl.uniform1f(U.uShallow, P.shallow); gl.uniform1f(U.uShoal, P.shoal); gl.uniform1f(U.uGrain, P.grain);
    gl.uniform1f(U.uWave, P.wave); gl.uniform1f(U.uSigma, P.sigma);
    gl.uniform1f(U.uSpacing, P.spacing); gl.uniform1f(U.uWaves, P.waves);
    gl.uniform1f(U.uDebug, P.debug ? 1 : 0);
    gl.uniform1f(U.uKayN, this.kayaks.length);
    gl.uniform4fv(U.uKay, this.kayBuf);
    gl.uniform4fv(U.uRip, this.ripBuf);
    gl.uniform1f(U.uBirdN, this.birds.length); gl.uniform4fv(U.uBird, this.birdBuf);
    this.applyThemeUniforms(U);
  };

  /* ======================================================================
     皮划艇：在深水里慢慢划，提前避开陆地和其他船
     ====================================================================== */
  spawnKayak() {
    for (let t = 0; t < 400; t++) {
      const x = 60 + Math.random() * (this.W - 120), y = 60 + Math.random() * (this.H - TASKBAR - 120);
      if (this.curS(x, y) > 170 && this.kayaks.every(k => Math.hypot(k.x - x, k.y - y) > 160))
        return { x, y, h: Math.random() * Math.PI * 2, v: 7 + Math.random() * 4, ph: Math.random() * 6, wander: Math.random() * 100, fade: 0 };
    }
    return null;
  }
  syncKayaks() {
    const want = Math.max(0, Math.min(4, Math.round(this.params.kayaks)));
    while (this.kayaks.length > want) this.kayaks.pop();
    while (this.kayaks.length < want) { const k = this.spawnKayak(); if (!k) break; this.kayaks.push(k); }
  }
  stepKayaks(dt, now) {
    const clearance = 64; // 船身长 44px，连同划桨留出安全间距。
    const plans = [];
    for (let i = 0; i < this.kayaks.length; i++) {
      const k = this.kayaks[i];
      let heading = k.h;
      const ax = k.x + Math.cos(k.h) * 70, ay = k.y + Math.sin(k.h) * 70;
      const margin = ax < 40 || ay < 40 || ax > this.W - 40 || ay > this.H - TASKBAR - 40;
      if (this.curS(ax, ay) < 150 || margin) {
        // 转向更深的水 / 画面中间
        let gx = this.curS(k.x + 10, k.y) - this.curS(k.x - 10, k.y), gy = this.curS(k.x, k.y + 10) - this.curS(k.x, k.y - 10);
        if (margin) { gx += (this.W / 2 - k.x) * 0.02; gy += ((this.H - TASKBAR) / 2 - k.y) * 0.02; }
        let d = Math.atan2(gy, gx) - k.h;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        heading += Math.sign(d) * Math.min(Math.abs(d), 0.7 * dt);
      } else {
        k.wander += dt * 0.3;
        heading += (this._vnoise(k.wander, i * 10) - 0.5) * 0.25 * dt;
      }
      const fx = Math.cos(k.h), fy = Math.sin(k.h);
      let steerX = Math.cos(heading), steerY = Math.sin(heading), speed = 1, avoiding = false;
      for (let j = 0; j < this.kayaks.length; j++) {
        if (i === j) continue;
        const other = this.kayaks[j], dx = other.x - k.x, dy = other.y - k.y;
        const distance = Math.hypot(dx, dy);
        if (distance > 210) continue;
        const rvx = Math.cos(other.h) * other.v - fx * k.v;
        const rvy = Math.sin(other.h) * other.v - fy * k.v;
        const closing = dx * rvx + dy * rvy;
        const ahead = Math.max(0, Math.min(7, -closing / Math.max(.01, rvx * rvx + rvy * rvy)));
        const closest = Math.hypot(dx + rvx * ahead, dy + rvy * ahead);
        const risk = Math.max(0, Math.min(1, (110 - distance) / 46),
          closing < 0 ? (1 - Math.min(1, closest / 90)) * (1 - ahead / 8) : 0);
        if (risk <= 0) continue;
        avoiding = true;
        // 相向时都向自己的右侧绕行；交叉或追尾时同时远离另一艘船。
        const awayX = distance > .001 ? -dx / distance : -fy;
        const awayY = distance > .001 ? -dy / distance : fx;
        steerX += (awayX * 2 - fy * 1.6) * risk;
        steerY += (awayY * 2 + fx * 1.6) * risk;
        if (dx * fx + dy * fy > 0 && closing < 0)
          speed = Math.min(speed, .25 + .75 * Math.max(0, Math.min(1, (distance - clearance) / 50)));
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
    for (let pass = 0; pass < this.kayaks.length; pass++) {
      for (let i = 0; i < this.kayaks.length; i++) for (let j = i + 1; j < this.kayaks.length; j++) {
        const a = plans[i], b = plans[j], dx = this.kayaks[j].x - this.kayaks[i].x, dy = this.kayaks[j].y - this.kayaks[i].y;
        const vx = b.dx - a.dx, vy = b.dy - a.dy, vv = vx * vx + vy * vy;
        const dot = dx * vx + dy * vy;
        if (dot >= 0 || vv < 1e-12) continue;
        const closestAt = Math.max(0, Math.min(1, -dot / vv));
        if (Math.hypot(dx + vx * closestAt, dy + vy * closestAt) >= clearance) continue;
        const gap = dx * dx + dy * dy - clearance * clearance;
        const fraction = gap <= 0 ? 0 : Math.max(0, Math.min(1, gap / (-dot + Math.sqrt(Math.max(0, dot * dot - vv * gap))) - .001));
        a.dx *= fraction; a.dy *= fraction; b.dx *= fraction; b.dy *= fraction;
      }
    }
    for (let i = this.kayaks.length - 1; i >= 0; i--) {
      const k = this.kayaks[i], plan = plans[i];
      k.h = plan.h; k.x += plan.dx; k.y += plan.dy;
      if (this.curS(k.x, k.y) < 40) { const n = this.spawnKayak(); if (n) this.kayaks[i] = n; else this.kayaks.splice(i, 1); }   // 被陆地"吞掉"就换个地方出现
    }
  }

  /* ======================================================================
    海鸟：在画面上空滑翔，时而盘旋、时而扇几下翅膀；飞出画面会兜回来
     ====================================================================== */
  spawnBird(fromEdge) {
    const H2 = this.H - TASKBAR;
    let x = Math.random() * this.W, y = Math.random() * H2;
    if (fromEdge) {                                    // 从画面外飞进来
      const side = Math.floor(Math.random() * 4);
      if (side === 0) x = -40; else if (side === 1) x = this.W + 40; else if (side === 2) y = -40; else y = H2 + 40;
    }
    const h = Math.atan2(H2 / 2 - y, this.W / 2 - x) + (Math.random() - 0.5) * 1.2;
    return { x, y, h, v: 36 + Math.random() * 16, mode: 0, modeT: 2 + Math.random() * 4, ph: 0, flap: false, flapT: Math.random() * 3, wander: Math.random() * 100 };
  }
  syncBirds(fromEdge = true) {
    const want = Math.max(0, Math.min(8, Math.round(this.params.birds)));
    while (this.birds.length > want) this.birds.pop();
    while (this.birds.length < want) this.birds.push(this.spawnBird(fromEdge));
  }
  stepBirds(dt) {
    const H2 = this.H - TASKBAR, m = 90;
    const turnToward = (h, target, rate) => { let d = target - h; d = Math.atan2(Math.sin(d), Math.cos(d)); return h + Math.sign(d) * Math.min(Math.abs(d), rate); };
    this.birds.forEach((b, i) => {
      if ((b.modeT -= dt) <= 0) {                       // 换一种飞法：直飞 / 向左或向右盘旋
        b.mode = Math.random() < 0.4 ? (Math.random() < 0.5 ? -1 : 1) : 0;
        b.modeT = b.mode ? 4 + Math.random() * 6 : 3 + Math.random() * 5;
      }
      b.wander += dt * 0.4;
      if (b.x < -m || b.x > this.W + m || b.y < -m || b.y > H2 + m)
        b.h = turnToward(b.h, Math.atan2(H2 / 2 - b.y, this.W / 2 - b.x), 1.3 * dt);
      else b.h += (b.mode * 0.55 + (this._vnoise(b.wander, i * 7.3) - 0.5) * 0.8) * dt;
      if ((b.flapT -= dt) <= 0) { b.flap = !b.flap; b.flapT = b.flap ? 0.8 + Math.random() * 1.2 : 2.5 + Math.random() * 4; }
      if (b.flap || Math.cos(b.ph) < 0.97) b.ph = (b.ph + dt * 9) % (Math.PI * 2);   // 停下时把这一下扇完
      const v = b.v * (b.flap ? 1.15 : 1);
      b.x += Math.cos(b.h) * v * dt; b.y += Math.sin(b.h) * v * dt;
    });
  }

  /* ======================================================================
    涟漪 / 场景变更钩子
     ====================================================================== */
  addRipple(x, y, str = 1) {
    this.ripples.push({ x, y, t0: performance.now(), str });
    if (this.ripples.length > 6) this.ripples.shift();
  }

  // DeskApp 在布局 / 换种子 / 宿主首帧之后回调，主题自己决定要重排哪些动态元素
  onSceneChanged(kind) {
    if (kind === 'hostInit') { this.syncBirds(false); return; }
    if (kind === 'reseed') { this.curMix = 1; this.kayaks.length = 0; this.syncKayaks(); this.curMix = 0; return; }
    if (kind === 'layout' || kind === 'firstIcons') {
      this.curMix = 1; this.kayaks.length = 0; this.syncKayaks(); this.curMix = 0;   // 按最终海岸线挑皮划艇的出生点
      if (!this.birds.length) this.syncBirds(false);
    }
  }

  onSliderAction(act) {
    if (act === 'kayaks') this.syncKayaks();
    else if (act === 'birds') this.syncBirds();
  }
}
