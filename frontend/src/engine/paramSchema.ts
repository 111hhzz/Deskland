// 参数规则表：把"参数键的范围、变化后触发什么、越界如何处理"收敛成一份从引擎声明合成的规则。
// 以前这些知识散落在 DeskApp.applySettings 的 find + 分支里；现在应用层只查表执行，
// 新增主题参数只需在主题的 sliders / displayKeys 声明处加一行。
//
// mode 语义与应用层既有行为严格一致：
//   'clamp' —— slider 声明的参数：越界夹紧到 [min, max] 后写入
//   'drop'  —— displayKeys 声明的显示参数：越界直接丢弃，范围内原样写入
//
// 声明顺序：先 displayKeys 后 sliders，同键冲突时后者覆盖前者（当前各主题的声明无重叠键）。
import type { SliderDef, DisplayKeyDef } from './SceneEngine.js';

export interface ParamRule {
  min: number;
  max: number;
  action: string; // '' 表示无动作；'field' / 'size' / 主题自定义 act
  mode: 'clamp' | 'drop';
}

export function buildParamRules(sliders: SliderDef[], displayKeys: DisplayKeyDef[]): Record<string, ParamRule> {
  const rules: Record<string, ParamRule> = {};
  for (const d of displayKeys) rules[d.key] = { min: d.min, max: d.max, action: '', mode: 'drop' };
  for (const s of sliders) rules[s.key] = { min: s.min, max: s.max, action: s.act ?? '', mode: 'clamp' };
  return rules;
}
