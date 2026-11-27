// DeskApp 需要的引擎能力：SceneEngine 的公共成员 + 各主题可选实现的扩展钩子。
// 独立成文件，供 DeskApp / IconLayer / hostBridge 共同引用，避免模块间循环依赖。
import type { SceneEngine } from './SceneEngine.js';

export interface DeskEngine extends SceneEngine {
  addRipple?(x: number, y: number, str?: number): void; // 主题自己的着色器涟漪（海滩）
  onSliderAction?(act: string): void;
  onSceneChanged?(kind: string): void;
  /** 宿主暂停 / 恢复（hostBridge）：视频等有声媒体据此停播音画 */
  onPausedChange?(paused: boolean): void;
}
