// engine.html 的入口（Vite 打包模块）。原来内联在 engine.html 里，抽出来给打包器当 entry。
// 主题注册表：静态导入（避免动态 import 的模块加载开销）
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MeadowEngine } from '../scenes/MeadowEngine.js';
import { SkyEngine } from '../scenes/SkyEngine.js';
import { FlatEngine } from '../scenes/FlatEngine.js';
import { AuroraEngine } from '../scenes/AuroraEngine.js';
import { DeskApp } from './DeskApp.js';
import type { DeskEngine } from './DeskApp.js';
import { installLegacyFor } from './legacyInstall.js';
import '../lib/ripple.js';   // 桌面点击涟漪（只读鼠标钩子），import 即装
import { WallShell } from './ui.js';

// 静态外壳（任务栏 / 调试面板）用 React 渲染：容器是独立的 #ui，
// 与 canvas 解耦，且这两个容器在真实壁纸模式下被 body.wall 隐藏，所以挂载不影响壁纸首帧。
const uiHost = document.getElementById('ui');
if (uiHost) {
  flushSync(() => { createRoot(uiHost).render(createElement(WallShell)); });
}

// main 负责创建 / 启停 / 就绪回执 / 调试钩子；引擎的全部公共能力（含 params / seed / init /
// start / destroy / setSeed / settleAndRender / bench）由 DeskEngine 描述，DeskApp 也按它取值。
export type EngineInstance = DeskEngine;

type EngineCtor = new (
  canvas: HTMLCanvasElement,
  opts: { wallpaper: boolean; preview: boolean },
) => EngineInstance;

// 注册表以主题的 id 为键（宿主传来的 ?theme=<id>，与 _products.json / theme.json 的 id 一致）；主题样式统一 /themes/<id>/theme.css（在 public，绝对路径）。
const ENGINES: Record<string, () => EngineCtor> = {
  meadow: () => MeadowEngine,
  sky: () => SkyEngine,
  beach: () => FlatEngine,
  aurora: () => AuroraEngine,
};
const THEME_STYLE = (id: string) => '/themes/' + id + '/theme.css';   // 绝对路径：主题样式在 public，运行时按站点根解析

const QS = new URLSearchParams(location.search);
const canvas = document.getElementById('art') as HTMLCanvasElement;

let engine: EngineInstance | null = null;
let app: DeskApp | null = null;
let currentTheme: string | null = null;

// 热切换超时：销毁旧引擎 + 建引擎 + 编译着色器 + 首帧，正常几百毫秒内完成。
// 超时未回执就认定失败，让宿主回退整页导航（否则页面会停在旧引擎已销毁、新引擎没起来的空壳状态）。
// 注意：主线程真死循环时 setTimeout 也不会跑，那种情况只能靠宿主侧兜底。
const SWITCH_TIMEOUT_MS = 5000;
let switchTimer = 0;
let bootGen = 0;

function failSwitch(id: string, why: string) {
  window.__bootError = why;
  bootGen++;                       // 作废仍在途的 boot，避免它稍后再发 firstframe
  const host = window.chrome && window.chrome.webview;
  if (host) host.postMessage(JSON.stringify({ t: 'switchfailed', theme: id }));
}

async function loadTheme(id: string): Promise<EngineInstance> {
  const factory = ENGINES[id];
  const known = !!factory;
  const Cls = factory ? factory() : MeadowEngine;
  // 主题样式（热切换时换掉）
  (document.getElementById('themeCss') as HTMLLinkElement).href = THEME_STYLE(known ? id : 'meadow');
  return new Cls(canvas, { wallpaper: QS.has('wallpaper'), preview: QS.has('preview') });
}

async function boot(id: string) {
  const gen = ++bootGen;
  currentTheme = id;
  // 旧实例整个收掉（引擎销毁 + 外壳卸监听 / 定时器 / 图标），否则还会在后台响应消息
  if (app) { app.destroy(); app = null; }
  if (engine) { engine.destroy(); engine = null; }
  engine = await loadTheme(id);
  if (gen !== bootGen) { engine.destroy(); engine = null; return; }   // 已被超时作废，别再往下起
  app = new DeskApp(engine, id);
  installLegacyFor(id, app, engine);   // 主题 legacy 模块注入（必须在 init 之前）
  await engine.init();
  if (gen !== bootGen) { app.destroy(); engine.destroy(); app = engine = null; return; }
  app.start();
  engine.start();
  requestAnimationFrame(() => {
    if (gen !== bootGen) return;
    clearTimeout(switchTimer);
    window.__desklandReady = true;
    const host = window.chrome && window.chrome.webview;
    if (host) host.postMessage(JSON.stringify({ t: 'firstframe', theme: id }));
  });
}

window.__dbg = {
  get theme() { return currentTheme; },
  P: () => (engine ? engine.params : null),
  get seed() { return engine ? engine.seed : 0; },
  settle: () => { if (engine) engine.settleAndRender(); },
  bench: () => (engine ? engine.bench() : null),   // 调试：10 帧中位耗时（含每帧 readPixels 同步）
  switchTheme: (id: string) => {
    if (!ENGINES[id]) return false;   // 不支持（如海滩旧脚本）→ 交由宿主回退整页导航
    clearTimeout(switchTimer);
    // 正常会在 boot 的首帧回执里清掉；一直不回执（脚本挂起、init 卡住）就按失败处理
    switchTimer = window.setTimeout(
      () => failSwitch(id, 'switch timeout after ' + SWITCH_TIMEOUT_MS + 'ms'),
      SWITCH_TIMEOUT_MS,
    );
    boot(id).catch(e => {
      clearTimeout(switchTimer);
      failSwitch(id, String((e && (e as Error).stack) || (e && (e as Error).message) || e));
    });
    return true;
  },
};

const initial = QS.get('theme') || 'meadow';
// 初始启动同样走超时 + 失败回执：否则 loadTheme / init 失败会成为 unhandledrejection，
// 页面静默卡死（宿主等不到 firstframe，也收不到 switchfailed 去回退整页导航）。
switchTimer = window.setTimeout(
  () => failSwitch(initial, 'boot timeout after ' + SWITCH_TIMEOUT_MS + 'ms'),
  SWITCH_TIMEOUT_MS,
);
boot(initial).catch(e => {
  clearTimeout(switchTimer);
  failSwitch(initial, String((e && (e as Error).stack) || (e && (e as Error).message) || e));
});
