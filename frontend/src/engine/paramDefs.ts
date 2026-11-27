// 本文件由 scripts/build-params.mjs 生成，请勿手改。源：public/themes/*/theme.json（groups）
/** 参数数据面（唯一源 = theme.json.groups）。引擎只叠加表现层：fmt 函数与 act 语义。 */
export interface ParamMeta {
  type: 'number' | 'bool' | 'enum';
  label: string;
  hint?: string;
  unit?: string;
  format?: 'times' | 'percent';
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  default: number | boolean;
}

export const PARAM_DEFS = {
  "aurora": {
    "sigma": { type: "number", label: "云团大小", hint: "图标周围的云铺多远", unit: "px", min: 40, max: 200, step: 1, default: 72 },
    "cover": { type: "number", label: "云量", hint: "天上的云有多少", format: "percent", min: 0, max: 1, step: 0.01, default: 0.12 },
    "flow": { type: "number", label: "流动速度", hint: "云与极光流动多快", format: "times", min: 0, max: 3, step: 0.05, default: 1 },
    "aurora": { type: "number", label: "极光强度", hint: "极光的亮度", format: "percent", min: 0, max: 1.5, step: 0.01, default: 0.9 },
    "stars": { type: "number", label: "星星密度", hint: "天上星星的多少", format: "percent", min: 0, max: 1, step: 0.01, default: 0.55 },
  },
  "beach": {
    "sigma": { type: "number", label: "离岸距离", hint: "海岸线离图标多远", unit: "px", min: 40, max: 200, step: 1, default: 85 },
    "warp": { type: "number", label: "海岸曲折", hint: "岸线弯弯绕绕的程度", min: 0, max: 80, step: 1, default: 34 },
    "shoal": { type: "number", label: "透明浅滩", hint: "能看见沙底的浅水有多宽", unit: "px", min: 0, max: 300, step: 1, default: 110 },
    "shallow": { type: "number", label: "浅海宽度", hint: "从青绿过渡到深蓝的距离", unit: "px", min: 120, max: 700, step: 1, default: 260 },
    "palms": { type: "number", label: "椰子树数量", hint: "沿岸椰子树的数量，设为 0 可隐藏；沙地不足时会减少显示", unit: "棵", min: 0, max: 10, step: 1, default: 4 },
    "kayaks": { type: "number", label: "皮划艇", unit: "艘", min: 0, max: 4, step: 1, default: 2 },
    "birds": { type: "number", label: "海鸟", hint: "在上空滑翔、盘旋的海鸥", unit: "只", min: 0, max: 8, step: 1, default: 3 },
  },
  "meadow": {
    "sigma": { type: "number", label: "云团大小", hint: "图标所在的云从图标往外铺多远", unit: "px", min: 40, max: 200, step: 1, default: 72 },
    "cover": { type: "number", label: "草地上的云", hint: "空旷的草地上空零星飘着的云有多少", format: "percent", min: 0, max: 1, step: 0.01, default: 0.3 },
    "flow": { type: "number", label: "流动速度", hint: "云飘多快、云团的鼓包变化多快", format: "times", min: 0, max: 3, step: 0.05, default: 1 },
    "showBoy": { type: "enum", label: "显示男孩", hint: "男孩和他手中的风筝一起显示或隐藏", options: ["隐藏","显示"], min: 0, max: 1, step: 1, default: 1 },
    "showCat": { type: "enum", label: "显示小猫", hint: "躺在草地上的小黑猫", options: ["隐藏","显示"], min: 0, max: 1, step: 1, default: 1 },
  },
  "orb": {
    "sigma": { type: "number", label: "球体大小", hint: "点阵球的整体尺寸", format: "times", min: 0.5, max: 1.5, step: 0.01, default: 1 },
    "orbDesign": { type: "enum", label: "形态", hint: "点云的几何排布", options: ["球体","环面","双旋臂","星轨盘","晶格壳"], min: 0, max: 4, step: 1, default: 0 },
    "autoCycle": { type: "bool", label: "循环更换形态", hint: "每隔一段时间自动切换点云形态；关掉后停留在当前形态", default: true },
    "density": { type: "number", label: "点密度", hint: "同一形态下的点数", format: "times", min: 0.3, max: 2, step: 0.05, default: 1 },
    "speed": { type: "number", label: "旋转速度", hint: "自转快慢；指针靠近时会加速", format: "times", min: 0, max: 3, step: 0.05, default: 1 },
    "hoverReaction": { type: "number", label: "指针响应", hint: "指针进入球内时自转加速的强度", format: "times", min: 0, max: 2, step: 0.05, default: 1 },
    "glow": { type: "number", label: "辉光强度", hint: "点光的亮度（背景辉光不受此项控制）", format: "percent", min: 0, max: 1.5, step: 0.05, default: 0.8 },
  },
  "sky": {
    "sigma": { type: "number", label: "云团大小", hint: "图标所在的云从图标往外铺多远", unit: "px", min: 40, max: 200, step: 1, default: 72 },
    "cover": { type: "number", label: "天上的云", hint: "飘在空中的云有多少", format: "percent", min: 0, max: 1, step: 0.01, default: 0.3 },
    "flow": { type: "number", label: "流动速度", hint: "云飘多快、云团的鼓包变化多快", format: "times", min: 0, max: 3, step: 0.05, default: 1 },
    "scheme": { type: "number", label: "时段", hint: "白天 / 傍晚 / 晚上", min: 0, max: 2, step: 1, default: 0 },
  },
} as const satisfies Record<string, Record<string, ParamMeta>>;

/** 主题开放参数的默认值表：引擎 defaultParams 与设置页 defaultsOf 共用，避免两处各写一份 */
export function paramDefaults(id: string): Record<string, number | boolean> {
  const defs = (PARAM_DEFS as Record<string, Record<string, ParamMeta>>)[id];
  if (!defs) return {};
  const out: Record<string, number | boolean> = {};
  for (const [k, m] of Object.entries(defs)) out[k] = m.default;
  return out;
}
