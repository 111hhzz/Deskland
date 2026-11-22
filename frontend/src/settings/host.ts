// 宿主桥接：设置页与桌面宿主之间的消息通道。
// 有宿主（WebView2）时走 chrome.webview；没有时（浏览器里调界面）用 mock 数据。

import type { InMessage, InitPayload, OutMessage, ThemeDef } from './types';
import { browserLang } from './i18n';

export interface HostBridge {
  send(msg: OutMessage): void;
  onMessage(cb: (m: InMessage) => void): () => void;
}

export function createWebViewHost(): HostBridge | null {
  const host = window.chrome?.webview;
  if (!host) return null;
  return {
    send(msg) { host.postMessage(JSON.stringify(msg)); },
    onMessage(cb) {
      const fn = (e: { data: unknown }) => {
        // WebView2 只会给字符串；非字符串直接忽略，避免 JSON.parse 抛错打断整条消息通道
        if (typeof e.data !== 'string') return;
        cb(JSON.parse(e.data) as InMessage);
      };
      host.addEventListener('message', fn);
      return () => host.removeEventListener('message', fn);
    },
  };
}

// 浏览器里打开时的模拟清单：与宿主同一套读法（_products.json + 各 theme.json），
// 只是把「扫目录」换成逐个 fetch，省得预览环境去搭目录扫描。
export async function mockThemes(): Promise<ThemeDef[]> {
  const out: ThemeDef[] = [];
  try {
    const r = await fetch('/themes/_products.json', { cache: 'no-store' });
    const products = (await r.json()) as { themes: { id: string; status: string; product: string }[] };
    for (const p of products.themes || []) {
      const tr = await fetch('/themes/' + p.id + '/theme.json', { cache: 'no-store' });
      if (!tr.ok) continue;
      const t = (await tr.json()) as ThemeDef;
      out.push({ ...t, status: p.status, product: p.product });
    }
  } catch {
    // 预览目录里没有 themes 时退回空清单，界面其余部分仍可看
  }
  return out;
}

// 浏览器里打开时的模拟 init：屏幕按常见分辨率，语言跟随浏览器
export async function mockInit(): Promise<InitPayload> {
  const k = window.devicePixelRatio || 1;
  const bl = browserLang();
  return {
    t: 'init',
    theme: 'beach',
    params: {},
    themes: await mockThemes(),
    screen: { w: 1707 * k, h: 1067 * k },
    autostart: false,
    autostartWarn: false,
    autostartSw: '',
    lang: 'auto',
    themeMode: 'auto',
    langEff: bl,
    langSys: bl,
  };
}
