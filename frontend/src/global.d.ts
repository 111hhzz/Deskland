// 全局声明：WebView2 宿主注入的对象、DeskApp 挂到 window 的共享状态、测试同步信号。

import type { EngineParams } from './engine/BaseEngine.js';
import type { MeadowActor, MeadowCat } from './scenes/MeadowEngine.js';
import type { Field, IconItem, Program, ScaledCanvas } from './engine/SceneEngine.js';

export {};

declare global {
  interface Window {
    chrome?: {
      webview?: {
        postMessage(json: string): void;
        addEventListener(type: 'message', cb: (e: { data: unknown }) => void): void;
        removeEventListener(type: 'message', cb: (e: { data: unknown }) => void): void;
      };
    };
    __desklandSettingsPerf?: number;
    __desklandReady?: boolean;
    __desklandIcons?: boolean;
    // 视觉基线注入的可重置伪随机序列（把 Math.random 换成 LCG）；未注入时不存在。
    __resetRand?: () => void;
    __dbg?: {
      readonly theme: string | null;
      P(): EngineParams | null;
      readonly seed: number;
      settle(): void;
      bench(): unknown;
      switchTheme(id: string): boolean;
    };
    __bootError?: string;
    __errors?: string[];
    // DeskApp 挂到 window 的共享状态：经典脚本（boy/cat/palms）仍以全局方式读取，
    // 迁移完成后这层会被消除（见 DeskApp.mountToWindow 的说明）。
    // 快照赋值：TASKBAR / P / gl / cv / program / sampleArr / curS / mulberry32
    TASKBAR: number;
    P: EngineParams;
    gl: WebGL2RenderingContext | null;
    cv: ScaledCanvas;
    program: (fs: string, vsSrc?: string) => Program;
    sampleArr: (a: Float32Array, x: number, y: number) => number;
    curS: (x: number, y: number) => number;
    mulberry32: (a: number) => () => number;
    // live getter（引擎尺寸随窗口变）：W / H 只读
    readonly W: number;
    readonly H: number;
    // live getter + setter（引擎侧会改写）
    icons: IconItem[];
    seed: number;
    FB: Field | null;
  }

  // 经典脚本（meadow-boy.js / meadow-cat.js）在全局暴露的人物 / 小猫准备函数。
  // 页面未加载这些脚本时它们不存在（undefined），调用方需先 typeof 判断。
  var prepareMeadowBoy: ((now: number, show: boolean) => MeadowActor | null) | undefined;
  var prepareMeadowCat: ((boy: MeadowActor | null, now: number) => MeadowCat | null) | undefined;

  // 经典脚本 beach/palms.js 暴露的棕榈树着色器与绘制函数（页面未加载时为 undefined）。
  // configurePass 由主题引擎提供（海滩引擎的 configureBeachPass）。
  var BEACH_PALM_FS: string | undefined;
  var BEACH_PALM_VS: string | undefined;
  var drawMaldivesPalms:
    | ((now: number, pass: Program, configurePass: (now: number, pass: Program) => void, context?: unknown) => void)
    | undefined;
}
