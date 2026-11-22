// GLSL 公共片段：多个主题引擎共用同一套噪声、陆地场采样与云的圆。
//
// 用法：每个主题的片元着色器 = 自己的头部（#version / precision / uniform / 常量）
//       + GLSL_COMMON（+ GLSL_CLOUD）+ 自己的主体（main）。
// 这样同一函数只存一份，改云的形状 / 魔数只需改这里，不必在 meadow / sky / aurora 之间同步。
//
// 注意：新增片段前先确认每个使用方的头部都声明了它用到的 uniform，否则编译期才会发现。

// 全屏三角形：用 gl_VertexID 直接生成，不需要顶点缓冲
export const GLSL_VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// 噪声 / 场采样：所有主题共用
export const GLSL_COMMON = `
float hash2(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float ss(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
vec4 N(vec2 p, float scale) { return texture(uNoise, p / scale + uSeed * 0.013); }
float fieldS(sampler2D t, vec2 p) { return texture(t, (p / uStep + 0.5) / uGrid).r; }
`;

// 云的布局常量：**JS 与 GLSL 的唯一事实来源**。
// 改这里，SceneEngine 的格子分配与 cloudDist 的采样会一起变；不要在任何一边单独写魔数。
export const CIRC_K = 36;      // 每格最多存多少个圆（云纹理的宽度 = 格数 × CIRC_K）
export const GRID_PAD = 4;     // 云格子比屏幕左、上多出的格数（右、下只多 GRID_PAD - 1 格）

// 云的圆：meadow / sky / aurora 共用（beach 没有云，不用）
// 依赖头部声明的 uFA / uFB / uMix / uEdge / uCirc / uCGrid / uCellG
export const GLSL_CLOUD = `
const int CIRC_K = ${CIRC_K};

float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }

// 到云的距离（<0 在云里）：图标周围云团的主体 + 自己格子里的圆
// front = true 时顺便找出盖住这个点、圆心最靠下（最前面）的那个圆：fc = (圆心 x, y, 半径, 色调)
float cloudDist(vec2 q, bool front, inout vec4 fc) {
  float sF = mix(fieldS(uFA, q), fieldS(uFB, q), uMix);
  float d = sF - uEdge + 0.6 * 95.0;                                              // 主体：把圆之间的缝填上
  ivec2 cell = ivec2(floor(q / uCellG)) + ${GRID_PAD};                               // 格子比屏幕左、上多 GRID_PAD 格（右下方的云影要用到），右、下多 GRID_PAD - 1 格
  if (cell.x < 0 || cell.y < 0 || float(cell.x) >= uCGrid.x || float(cell.y) >= uCGrid.y) return d;
  for (int k = 0; k < CIRC_K; k++) {
    vec4 c = texelFetch(uCirc, ivec2(cell.x * CIRC_K + k, cell.y), 0);
    if (c.z <= 0.0) break;
    float di = length(q - c.xy) - c.z;
    d = smin(d, di, 6.0);
    if (front && di < 0.0 && c.y > fc.y) fc = c;
  }
  return d;
}
float cloudDist(vec2 q) { vec4 fc = vec4(0.0, -1e9, 0.0, 0.0); return cloudDist(q, false, fc); }
`;

// 排线与小猫：meadow / sky 共用（sky 暂时用不上小猫，留作同一套）
export const GLSL_MEADOW_EXTRA = `
// 到一段线的距离
float segD(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }
#ifdef MEADOW_CAT
float catTailMask(vec2 uv) {
  return smoothstep(.635,.665,uv.x)*smoothstep(.715,.75,uv.y);
}
vec4 catColor(vec2 uv) {
  vec2 pivot=vec2(.68,.73),delta=uv-pivot;
  // 尾根固定，越靠尾尖摆幅越大；只变形尾巴，身体和四肢保持原位。
  float angle=-uCatTail*smoothstep(.025,.16,length(delta));
  float c=cos(angle),s=sin(angle);
  vec2 source=pivot+vec2(c*delta.x-s*delta.y,s*delta.x+c*delta.y);
  vec4 body=texture(uCat,uv),tail=texture(uCat,source);
  body.a*=1.-catTailMask(uv);tail.a*=catTailMask(source);
  float alpha=body.a+tail.a;
  return vec4((body.rgb*body.a+tail.rgb*tail.a)/max(alpha,.001),min(alpha,1.));
}
#endif
`;

// 在 #version 行后插入 #define，生成同一着色器的变体。
// 比 replace 源码文本可靠：不依赖 `void main() {` 或 `#version` 的具体写法。
export function withDefines(src, defines = []) {
  if (!defines || !defines.length) return src;
  const nl = src.indexOf('\n');
  const first = nl < 0 ? src : src.slice(0, nl);
  if (first.trim() !== '#version 300 es') throw new Error('着色器必须以 #version 300 es 开头');
  const rest = nl < 0 ? '' : src.slice(nl + 1);
  return first + '\n' + defines.map(d => '#define ' + d).join('\n') + '\n' + rest;
}
