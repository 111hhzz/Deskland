// legacy 脚本（草地人物 / 小猫、海滩棕榈）的显式依赖入口。
// 这些脚本原本是 public/ 下的经典脚本，靠 DeskApp.mountToWindow() 挂到 window 的裸全局名读引擎状态；
// 现在是 src/themes/<id>/legacy/ 下的 TS 模块，由页面把 host 传进来（P4 迁移，见 docs/2026-11-23-p4-legacy-ts-design.md）。
import type { EngineParams } from './BaseEngine.js';
import type { Field, IconItem, Program, ScaledCanvas } from './SceneEngine.js';

export interface LegacyHost {
  // 全部走 getter：gl 延迟解析，host 在 engine.init() 之前也能安全构建
  readonly gl: WebGL2RenderingContext;
  readonly cv: ScaledCanvas;
  readonly program: (fs: string, vsSrc?: string) => Program;
  readonly W: number;
  readonly H: number;
  readonly TASKBAR: number;
  readonly icons: IconItem[];
  readonly seed: number;
  readonly P: EngineParams;
  readonly FB: Field | null;
  readonly sampleArr: (a: Float32Array, x: number, y: number) => number;
  readonly curS: (x: number, y: number) => number;
  readonly mulberry32: (a: number) => () => number;
  readonly themeBase: string;   // '/themes/<id>/'：素材按主题根相对引用
}
