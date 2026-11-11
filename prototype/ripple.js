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

// 主题切换淡入：新页面首帧准备好后，用 keyframe 动画在 250ms 内把 body 从透明淡入到不透明。
// 淡入起点颜色 = 页面背景（html/body 的背景色，getComputedStyle 读取），避免白闪或颜色跳变；
// 只覆盖"从空白到首帧可见"这一段，不叠加在 sky 的 2.6s morph 上。三个主题页共用此函数。
(function desklandFadeIn() {
  const bg = getComputedStyle(document.body).backgroundColor;
  const style = document.createElement('style');
  style.textContent = `
    html { background: ${bg || '#1aa3c4'}; }
    body { opacity: 0; }
    body.deskland-ready { animation: desklandFadeIn 250ms ease-out forwards; }
    @keyframes desklandFadeIn { from { opacity: 0; } to { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { body.deskland-ready { animation: none; opacity: 1; } }
  `;
  document.head.appendChild(style);
  // 双 rAF：等第一帧真正画完（着色器已输出首帧）再开始淡入。
  // 结束后移除注入的 <style>（body 回到默认 opacity:1）与 class，不会反向淡出。
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.body.classList.add('deskland-ready');
    setTimeout(() => { style.remove(); document.body.classList.remove('deskland-ready'); }, 300);
  }));
})();

// 测试信号：首帧渲染完成后通知宿主（供 Playwright 等待同步，替代 sleep）。
(function () {
  const host = window.chrome && window.chrome.webview;
  if (!host) return;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    host.postMessage(JSON.stringify({ t: 'firstframe' }));
  }));
})();
