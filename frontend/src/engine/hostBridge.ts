// 宿主消息协议（host → 页面）：WebView2 壁纸 / 设置预览框两条通道共用。
// ADR 0002：全局钩子注入的指针事件（{t:'ptr'}）也在这里换算合成。
import type { EngineParams, EngineParamValue } from './BaseEngine.js';
import type { DeskEngine } from './DeskEngine.js';

// 宿主消息协议（host → 页面）
export type HostMessage =
  | { t: 'pause'; v: boolean }
  | { t: 'settings'; v?: Record<string, EngineParamValue> }
  | { t: 'reset'; v?: Record<string, EngineParamValue> }
  | { t: 'icons'; vis: boolean; r: Array<[number, number, number, number]> }
  // 全局钩子注入的指针事件（ADR 0002）：x/y 是相对主屏的物理像素，p 为 move / down / up。
  // 壁纸窗口 z 序低于图标层时收不到真实命中，由宿主的 WH_MOUSE_LL 观察钩子补发。
  | { t: 'ptr'; p: 'move' | 'down' | 'up'; x: number; y: number };

export interface HostBridgeDeps {
  engine: DeskEngine;
  themeId: string;
  preview: boolean;
  defaults: EngineParams;
  applySettings(v: Record<string, EngineParamValue>): void;
  isIconsSeen(): boolean;
  markIconsSeen(): void;
}

export interface HostHandle {
  /** ready 回执：预览模式发给父窗口，壁纸模式发给宿主 */
  announce(): void;
  /** 物理像素指针注入（ADR 0002）；非托管模式下无操作 */
  injectPointer(x: number, y: number, p: 'move' | 'down' | 'up'): void;
  destroy(): void;
}

export function connectHost(deps: HostBridgeDeps): HostHandle {
  const { engine, themeId, preview } = deps;
  let firstIcons = true;
  let hostMsg: ((e: { data: unknown }) => void) | null = null;
  let winMsg: ((e: MessageEvent) => void) | null = null;

  // 预览模式下把图标位置画成虚影，便于设置页对齐
  const drawGhosts = (): void => {
    const box = document.getElementById('ghosts');
    if (!box) return;
    box.innerHTML = engine.icons
      .map(
        (ic) =>
          `<div class="ghost" style="left:${ic.x}px;top:${ic.y}px;width:${ic.w}px;height:${ic.h}px"><i></i><b></b></div>`,
      )
      .join('');
  };

  // 宿主全局钩子注入（ADR 0002）：相对主屏的物理像素换算成 CSS 像素后，合成 PointerEvent 派发到
  // window——引擎内的指针监听（installPointer）不区分真实 / 注入来源，主题零改动复用。
  // 鼠标穿透开启时宿主不发此消息，这里自然收不到。
  const injectPointer = (x: number, y: number, p: 'move' | 'down' | 'up'): void => {
    const k = window.devicePixelRatio || 1; // 物理像素 → CSS 像素（与 icons 同一换算）
    const type = p === 'down' ? 'pointerdown' : p === 'up' ? 'pointerup' : 'pointermove';
    window.dispatchEvent(new PointerEvent(type, { clientX: x / k, clientY: y / k, button: 0, bubbles: true }));
  };

  const handle = (m: HostMessage): void => {
    if (m.t === 'pause') {
      engine.paused = preview ? false : m.v;
      engine.onPausedChange?.(engine.paused);
      if (!engine.paused) engine.resume();
      return;
    }
    if (m.t === 'settings') {
      deps.applySettings(m.v || {});
      return;
    }
    if (m.t === 'reset') {
      deps.applySettings(Object.assign({}, deps.defaults, m.v || {}));
      return;
    }
    if (m.t === 'ptr') {
      injectPointer(m.x, m.y, m.p);
      return;
    }
    if (m.t !== 'icons') return;
    const k = window.devicePixelRatio || 1; // 物理像素 → CSS 像素
    engine.icons = m.vis ? m.r.map(([l, t, r, b]) => ({ x: l / k, y: t / k, w: (r - l) / k, h: (b - t) / k })) : [];
    if (preview) drawGhosts();
    deps.markIconsSeen();
    window.__desklandIcons = true; // 测试同步信号：宿主图标已到达（场已按图标重算）
    engine.commit(firstIcons); // 第一次：陆地从海里"长"出来；之后：岸线平滑移动
    if (firstIcons) engine.onSceneChanged?.('firstIcons');
    firstIcons = false;
  };

  document.body.classList.add('wall');
  if (preview) {
    document.body.classList.add('preview');
    const g = document.createElement('div');
    g.id = 'ghosts';
    document.body.appendChild(g);
  }
  // 先是一片海（还不知道图标在哪）
  engine.icons = [];
  engine.commit(true);
  engine.onSceneChanged?.('hostInit');

  const host = window.chrome && window.chrome.webview;
  if (preview) {
    winMsg = (ev) => {
      if (ev.source === parent) handle(typeof ev.data === 'string' ? JSON.parse(ev.data) : (ev.data as HostMessage));
    };
    window.addEventListener('message', winMsg);
  } else if (host) {
    hostMsg = (ev) => handle(JSON.parse(ev.data as string) as HostMessage);
    host.addEventListener('message', hostMsg);
  }

  return {
    announce(): void {
      const msg = JSON.stringify({ t: 'ready', theme: themeId });
      if (preview) parent.postMessage(msg, '*');
      else if (host) host.postMessage(msg);
    },
    injectPointer,
    destroy(): void {
      if (hostMsg) {
        const h = window.chrome && window.chrome.webview;
        if (h) h.removeEventListener('message', hostMsg);
      }
      if (winMsg) window.removeEventListener('message', winMsg);
      const g = document.getElementById('ghosts');
      if (g) g.remove();
    },
  };
}
