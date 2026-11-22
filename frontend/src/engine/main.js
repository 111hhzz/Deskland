// engine.html 的入口（Vite 打包模块）。原来内联在 engine.html 里，抽出来给打包器当 entry。
// 主题注册表：静态导入（避免动态 import 的模块加载开销）
import { MeadowEngine } from '../scenes/MeadowEngine.js';
import { SkyEngine } from '../scenes/SkyEngine.js';
import { FlatEngine } from '../scenes/FlatEngine.js';
import { AuroraEngine } from '../scenes/AuroraEngine.js';
import { DeskApp } from './DeskApp.js';

// 注册表以 themes.json 的 theme id 为键（宿主传来的 ?theme=<id>）；主题样式统一 /themes/<id>/theme.css（在 public，绝对路径）。
const ENGINES = {
  meadow: () => MeadowEngine,
  sky:    () => SkyEngine,
  beach:  () => FlatEngine,
  aurora: () => AuroraEngine,
};
const THEME_STYLE = id => '/themes/' + id + '/theme.css';   // 绝对路径：主题样式在 public，运行时按站点根解析
const EXTRAS = {
  meadow: ['engine/legacy/meadow-boy.js', 'engine/legacy/meadow-cat.js'],
  beach:  ['engine/legacy/beach-palms.js'],
};

const QS = new URLSearchParams(location.search);
const canvas = document.getElementById('art');

let engine = null, app = null, currentTheme = null;

// 热切换超时：销毁旧引擎 + 建引擎 + 编译着色器 + 首帧，正常几百毫秒内完成。
// 超时未回执就认定失败，让宿主回退整页导航（否则页面会停在旧引擎已销毁、新引擎没起来的空壳状态）。
// 注意：主线程真死循环时 setTimeout 也不会跑，那种情况只能靠宿主侧兜底。
const SWITCH_TIMEOUT_MS = 5000;
let switchTimer = 0, bootGen = 0;

function failSwitch(id, why) {
  window.__bootError = why;
  bootGen++;                       // 作废仍在途的 boot，避免它稍后再发 firstframe
  const host = window.chrome && window.chrome.webview;
  if (host) host.postMessage(JSON.stringify({ t: 'switchfailed', theme: id }));
}

async function loadTheme(id) {
  const known = !!ENGINES[id];
  const Cls = known ? ENGINES[id]() : MeadowEngine;
  // 主题样式（热切换时换掉）
  document.getElementById('themeCss').href = THEME_STYLE(known ? id : 'meadow');
  // 附加脚本（经典脚本，只加载一次）
  const loadScript = src => new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej;
    document.body.appendChild(s);
  });
  for (const s of EXTRAS[id] || []) {
    if (!document.querySelector(`script[src="${s}"]`)) await loadScript(s);
  }
  const e = new Cls(canvas, { wallpaper: QS.has('wallpaper'), preview: QS.has('preview') });
  return e;
}

async function boot(id) {
  const gen = ++bootGen;
  currentTheme = id;
  // 旧实例整个收掉（引擎销毁 + 外壳卸监听 / 定时器 / 图标），否则还会在后台响应消息
  if (app) { app.destroy(); app = null; }
  if (engine) { engine.destroy(); engine = null; }
  engine = await loadTheme(id);
  if (gen !== bootGen) { engine.destroy(); engine = null; return; }   // 已被超时作废，别再往下起
  app = new DeskApp(engine, id);
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
  P: () => engine && engine.params,
  get seed() { return engine && engine.seed; },
  settle: () => engine && engine.settleAndRender(),
  bench: () => engine && engine.bench(),   // 调试：10 帧中位耗时（含每帧 readPixels 同步）
  switchTheme: id => {
    if (!ENGINES[id]) return false;   // 不支持（如海滩旧脚本）→ 交由宿主回退整页导航
    clearTimeout(switchTimer);
    // 正常会在 boot 的首帧回执里清掉；一直不回执（脚本挂起、init 卡住）就按失败处理
    switchTimer = setTimeout(() => failSwitch(id, 'switch timeout after ' + SWITCH_TIMEOUT_MS + 'ms'), SWITCH_TIMEOUT_MS);
    boot(id).catch(e => { clearTimeout(switchTimer); failSwitch(id, String((e && e.stack) || (e && e.message) || e)); });
    return true;
  },
};

const initial = QS.get('theme') || 'meadow';
boot(initial);
