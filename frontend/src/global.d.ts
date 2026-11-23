// 全局声明：WebView2 宿主注入的对象、DeskApp 挂到 window 的共享状态、测试同步信号。

import type { EngineParams } from './engine/BaseEngine.js';
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
    // DeskApp 挂到 window 的共享状态：目前只剩 beach palms 经典脚本在读取，
    // 第 2/3 步迁完后这层会整体删除（见 DeskApp.mountToWindow 的说明）。
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
}
