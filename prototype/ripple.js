// 桌面点击涟漪：宿主通过只读鼠标钩子发来主屏物理像素坐标，覆盖在主题画布上。
(function () {
  const style = document.createElement('style');
  style.textContent = `
    .deskland-ripples { position: fixed; inset: 0; z-index: 45; overflow: hidden; pointer-events: none; }
    .deskland-ripple { position: absolute; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%;
      border: 2px solid rgba(255,255,255,.8); box-shadow: 0 0 12px rgba(255,255,255,.55), inset 0 0 8px rgba(255,255,255,.35);
      animation: deskland-ripple .65s ease-out forwards; }
    @keyframes deskland-ripple { from { transform: scale(.3); opacity: .9; } to { transform: scale(9); opacity: 0; } }
    @media (prefers-reduced-motion: reduce) { .deskland-ripple { animation-duration: .01ms; } }
  `;
  document.head.appendChild(style);
  const layer = document.createElement('div');
  layer.className = 'deskland-ripples';
  document.body.appendChild(layer);

  function ripple(x, y) {
    const k = window.devicePixelRatio || 1;
    const el = document.createElement('div');
    el.className = 'deskland-ripple';
    el.style.left = (x / k) + 'px';
    el.style.top = (y / k) + 'px';
    el.addEventListener('animationend', () => el.remove(), { once: true });
    layer.appendChild(el);
    while (layer.children.length > 6) layer.firstElementChild.remove();
  }

  // 页面预览和浏览器打开时没有宿主消息；只响应 WebView2 的 ripple 消息。
  const host = window.chrome && window.chrome.webview;
  if (host) host.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m && m.t === 'ripple' && Number.isFinite(m.x) && Number.isFinite(m.y)) ripple(m.x, m.y);
  });
})();
