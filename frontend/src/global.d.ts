// 全局声明：WebView2 宿主注入的对象与测试同步信号（P4 第 3 步起不再有 window 桥接）。

import type { EngineParams } from './engine/BaseEngine.js';

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
      /** 测试入口：模拟宿主钩子注入一条指针事件（x/y 为相对主屏物理像素） */
      injectPointer(x: number, y: number, p?: string): void;
      /** 引擎内部指针场快照（仅 orb 等有 pointer 的引擎）；否则 null */
      ptr(): { active: boolean; down: boolean; inside: number; energy: number; x: number; y: number } | null;
    };
    __bootError?: string;
    __errors?: string[];
  }
}
