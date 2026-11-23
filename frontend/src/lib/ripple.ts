// 桌面点击涟漪：宿主通过只读鼠标钩子发来主屏物理像素坐标，覆盖在主题画布上。
// 颜色 / 时长 / 层叠都从主题 Token 读取（base.css + themes/<id>/theme.css），读不到时用默认值。
// 主题切换淡入：新页面首帧准备好后，用 keyframe 动画把 body 从透明淡入到不透明。
// 淡入起点颜色 = 页面背景 Token（--color-bg），避免白闪或颜色跳变；只覆盖「从空白到首帧可见」这一段。
// 用法：模块顶层副作用（import 即装，与原来的 IIFE 行为一致）；导出供单测复用（P4 迁移）。

function token(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name);
  return v && v.trim() ? v.trim() : fallback;
}

export function installRipples(): void {
  const rippleColor = token('--color-ripple', 'rgba(255,255,255,.8)');
  const rippleGlow = token('--color-ripple-glow', 'rgba(255,255,255,.55)');
  const rippleInset = token('--color-ripple-inset', 'rgba(255,255,255,.35)');
  const rippleDuration = token('--motion-ripple', '.65s');
  const rippleEase = token('--motion-ease-out', 'ease-out');
  const rippleZ = token('--z-ripple', '45');

  const style = document.createElement('style');
  style.textContent = `
    .deskland-ripples { position: fixed; inset: 0; z-index: ${rippleZ}; overflow: hidden; pointer-events: none; }
    .deskland-ripple { position: absolute; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%;
      border: 2px solid ${rippleColor}; box-shadow: 0 0 12px ${rippleGlow}, inset 0 0 8px ${rippleInset};
      animation: deskland-ripple ${rippleDuration} ${rippleEase} forwards; }
    @keyframes deskland-ripple { from { transform: scale(.3); opacity: .9; } to { transform: scale(9); opacity: 0; } }
    @media (prefers-reduced-motion: reduce) { .deskland-ripple { animation-duration: .01ms; } }
  `;
  document.head.appendChild(style);
  const layer = document.createElement('div');
  layer.className = 'deskland-ripples';
  document.body.appendChild(layer);

  function ripple(x: number, y: number): void {
    const k = window.devicePixelRatio || 1;
    const el = document.createElement('div');
    el.className = 'deskland-ripple';
    el.style.left = (x / k) + 'px';
    el.style.top = (y / k) + 'px';
    el.addEventListener('animationend', () => el.remove(), { once: true });
    layer.appendChild(el);
    while (layer.children.length > 6) layer.firstElementChild?.remove();
  }

  // 页面预览和浏览器打开时没有宿主消息；只响应 WebView2 的 ripple 消息。
  const host = window.chrome && window.chrome.webview;
  if (!host) return;
  host.addEventListener('message', ev => {
    let m: unknown;
    try { m = JSON.parse(ev.data as string); } catch { return; }
    if (typeof m !== 'object' || m === null) return;
    const msg = m as { t?: unknown; x?: unknown; y?: unknown };
    if (msg.t === 'ripple' && typeof msg.x === 'number' && Number.isFinite(msg.x)
      && typeof msg.y === 'number' && Number.isFinite(msg.y)) ripple(msg.x, msg.y);
  });
}

export function desklandFadeIn(): void {
  const fadeDuration = getComputedStyle(document.documentElement).getPropertyValue('--motion-fade').trim() || '250ms';
  const fadeEase = getComputedStyle(document.documentElement).getPropertyValue('--motion-ease-out').trim() || 'ease-out';
  const style = document.createElement('style');
  style.textContent = `
    html { background: var(--color-bg, #1aa3c4); }
    body { opacity: 0; }
    body.deskland-ready { animation: desklandFadeIn ${fadeDuration} ${fadeEase} forwards; }
    @keyframes desklandFadeIn { from { opacity: 0; } to { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { body.deskland-ready { animation: none; opacity: 1; } }
  `;
  document.head.appendChild(style);
  // 双 rAF：等第一帧真正画完（着色器已输出首帧）再开始淡入。
  // 结束后移除注入的 <style>（body 回到默认 opacity:1）与 class，不会反向淡出。
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.body.classList.add('deskland-ready');
    setTimeout(() => { style.remove(); document.body.classList.remove('deskland-ready'); }, parseFloat(fadeDuration) + 50);
  }));
}

// 顶层副作用：import 即装。ES 模块缓存保证热切换（engine.html 同上下文换主题）不会重复安装。
installRipples();
desklandFadeIn();
