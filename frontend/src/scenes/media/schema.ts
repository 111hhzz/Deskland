// 媒体主题（image / video）参数声明 schema。
//
// 用户导入的主题不在构建期扫描范围内，其 theme.json.groups 由宿主生成（M1b）、页面启动时
// registerRuntimeDefs 注册。这里的常量表是「生成 theme.json 的规范」：宿主 C# 与前端测试
// 都以此为准，任何一侧改动都要同步（见 docs/specs/2026-11-27-theme-extension-and-import-plan.md §5.1）。
import type { ParamMeta } from '../../engine/paramSchema.js';

/** 填充方式选项（object-fit）：cover = 铺满裁切，contain = 完整留边 */
export const FIT_OPTIONS = ['cover', 'contain'] as const;

const fit: ParamMeta = {
  type: 'enum',
  label: '填充方式',
  hint: '铺满屏幕（裁切）或完整显示（留边）',
  options: [...FIT_OPTIONS],
  min: 0,
  max: FIT_OPTIONS.length - 1,
  step: 1,
  default: 0,
};

const veil: ParamMeta = {
  type: 'number',
  label: '暗色遮罩',
  hint: '压暗背景以保证图标与面板可读',
  format: 'percent',
  min: 0,
  max: 0.8,
  step: 0.01,
  default: 0,
};

export const IMAGE_PARAMS: Record<string, ParamMeta> = { fit, veil };

export const VIDEO_PARAMS: Record<string, ParamMeta> = {
  fit,
  veil,
  speed: {
    type: 'number',
    label: '播放速度',
    hint: '倍速播放',
    format: 'times',
    min: 0.25,
    max: 2,
    step: 0.05,
    default: 1,
  },
  muted: { type: 'bool', label: '静音', hint: '关闭后可播放视频原声', default: true },
  loop: { type: 'bool', label: '循环', hint: '播放结束后从头开始', default: true },
};

/** 供宿主生成 theme.json 的组结构（单组，参数顺序即面板顺序） */
export const MEDIA_GROUP_NAME = '媒体';
