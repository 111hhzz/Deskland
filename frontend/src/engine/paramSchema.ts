// 参数规则表：把"参数键的范围、变化后触发什么、越界如何处理"收敛成一份从声明合成的规则。
//
// 数据面单一真相 = public/themes/<id>/theme.json 的 groups → scripts/build-params.mjs 编译出
// paramDefs.ts（PARAM_DEFS）。引擎只叠加表现层：fmt 函数与 act 语义（无法数据化的部分）。
// 新增主题参数只需在 theme.json 的 groups 里加一条 + 在引擎构造器声明 fmt/act。
//
// mode 语义与应用层既有行为严格一致：
//   'clamp' —— slider / enum 声明的参数：越界夹紧到 [min, max] 后写入
//   'drop'  —— displayKeys 声明的显示参数：越界直接丢弃，范围内原样写入
//
// 声明顺序：先 displayKeys 后 sliders，同键冲突时后者覆盖前者（当前各主题的声明无重叠键）。
import { PARAM_DEFS } from './paramDefs.js';
import type { ParamMeta } from './paramDefs.js';

/** 主题构造器给单个参数叠加的表现层：格式化函数与变化后的动作（'field' / 'size' / 自定义 act） */
export interface SliderView {
  fmt?: (v: number) => string;
  act?: string;
}
/** 带键参数（生成物以键为属性名，运行时统一携带 key 字段） */
export interface KeyedParam extends ParamMeta {
  key: string;
}
/** 面板滑杆 / 选项：数据面来自 PARAM_DEFS，表现面来自构造器 */
export type SliderDef = KeyedParam & SliderView;
/** 显示参数：键 + 范围（范围来自 PARAM_DEFS 或 BUILTIN_DISPLAYS） */
export type DisplayKeyDef = KeyedParam;

/**
 * 内置显示参数：不进 theme.json.groups、由产品语义固定的显示键（如自适应布局开关）。
 * 集中在此避免每个引擎各写一份 min/max。
 */
export const BUILTIN_DISPLAYS: Record<string, ParamMeta> = {
  adaptive: { type: 'bool', label: '适应图标布局', default: true },
};

const DEFS = PARAM_DEFS as Record<string, Record<string, ParamMeta>>;

function resolve(id: string, key: string): ParamMeta {
  const m = DEFS[id]?.[key] ?? BUILTIN_DISPLAYS[key];
  if (!m) throw new Error(`参数声明缺失：${id}/${key}（theme.json.groups 或 BUILTIN_DISPLAYS）`);
  return m;
}

/** 按构造器声明的视图装配面板滑杆 / 选项；键必须已在 theme.json.groups 声明（缺声明即抛错，漂移不可静默） */
export function paramSliders(id: string, views: Record<string, SliderView>): SliderDef[] {
  return Object.entries(views).map(([key, v]) => ({ ...resolve(id, key), key, ...v }));
}

/** 装配显示参数（设置下发通道的白名单 + 范围来源） */
export function paramDisplays(id: string, keys: string[]): DisplayKeyDef[] {
  return keys.map((k) => ({ ...resolve(id, k), key: k }));
}

/**
 * 覆盖断言：theme.json.groups 声明的键必须全部出现在 sliders ∪ displays 里。
 * 防止"设置页有控件、桌面面板没有"（或反之）的静默漂移；构造器末尾调用一次。
 */
export function assertParamCoverage(id: string, sliders: SliderDef[], displays: DisplayKeyDef[]): void {
  const declared = new Set(Object.keys(DEFS[id] ?? {}));
  const covered = new Set([...sliders.map((s) => s.key), ...displays.map((d) => d.key)]);
  const missing = [...declared].filter((k) => !covered.has(k));
  if (missing.length) throw new Error(`参数未在引擎声明（sliders/displayKeys）：${id} → ${missing.join(', ')}`);
}

export interface ParamRule {
  /** 参数类型（信息性：enum 走 clamp 语义，索引即值） */
  type: ParamMeta['type'];
  min: number;
  max: number;
  action: string; // '' 表示无动作；'field' / 'size' / 主题自定义 act
  mode: 'clamp' | 'drop';
}

export function buildParamRules(sliders: SliderDef[], displays: DisplayKeyDef[]): Record<string, ParamRule> {
  const rules: Record<string, ParamRule> = {};
  for (const d of displays)
    rules[d.key] = {
      type: d.type,
      min: d.min ?? 0,
      max: d.max ?? 1,
      action: '',
      mode: 'drop',
    };
  for (const s of sliders)
    rules[s.key] = {
      type: s.type,
      min: s.min ?? 0,
      max: s.max ?? 1,
      action: s.act ?? '',
      mode: 'clamp',
    };
  return rules;
}
