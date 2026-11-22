// 全局声明：WebView2 宿主注入的对象与测试同步信号。

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
  }
}
