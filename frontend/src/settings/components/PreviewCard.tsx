import { useEffect, useRef } from 'react';
import { useSettings } from '../store.js';
import { themeById, valuesOf, thumbUrl } from '../domain.js';

export function PreviewCard() {
  const { state, themes, t, setAdaptive, reseed } = useSettings();
  // 刷新后当前主题可能已不在清单（授权表改了）：兜底到首个可用主题，别让整张预览卡消失
  const th = themeById(themes, state.theme) || themes.find(x => x.status === 'ready') || themes[0];
  const stageRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // 预览区按屏幕比例排版；窗口尺寸变化时重算
  const screen = state.screen;
  useEffect(() => {
    if (!screen) return;
    const layout = () => {
      const stage = stageRef.current, box = boxRef.current;
      if (!stage || !box) return;
      const k = window.devicePixelRatio || 1;
      const w = Math.round(screen.w / k), h = Math.round(screen.h / k);
      const rect = stage.getBoundingClientRect();
      const maxHeight = Math.min(window.innerHeight * 0.42, Math.max(110, window.innerHeight - 520));
      const scale = Math.min(rect.width / w, maxHeight / h);
      box.style.width = Math.floor(w * scale) + 'px';
      box.style.height = Math.floor(h * scale) + 'px';
    };
    layout();
    window.addEventListener('resize', layout);
    return () => window.removeEventListener('resize', layout);
  }, [screen, state.theme]);

  const url = thumbUrl(th?.thumb || '');
  // 主预览图提前下载，避免切换主题后才开始加载
  useEffect(() => {
    if (!url) return;
    const abs = new URL(url, location.href).href;
    const links = Array.from(document.querySelectorAll('link[data-preload-image]')) as HTMLLinkElement[];
    // 只保留当前预览图：多主题来回切换时先清掉旧的，避免 <head> 累积
    for (const l of links) if (l.href !== abs) l.remove();
    if (links.some(l => l.href === abs)) return;
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.href = url;
    link.fetchPriority = 'high';
    link.setAttribute('data-preload-image', '');
    document.head.appendChild(link);
  }, [url]);

  if (!th) return null;
  const vals = valuesOf(th, state.params);
  return (
    <section className="card preview-card">
      <div className="preview-head">
        <h2 id="themeName">{th.name}</h2>
        <label className="switch-row adaptive-switch" id="adaptiveRow" hidden={!th.adaptive}>
          <span>{t('adaptive')}</span>
          <input type="checkbox" id="adaptive" role="switch" aria-label={t('adaptive')}
            checked={vals.adaptive !== 0} onChange={e => setAdaptive(e.target.checked)} />
          <i className="switch" aria-hidden="true" />
        </label>
      </div>
      <div className={`stage${state.stageLoading ? ' loading' : ''}`} id="stage" ref={stageRef}>
        <div className="preview" id="previewBox" ref={boxRef}>
          <img id="preview" title={t('themePreview')} alt={t('themePreview')}
            src={url || '/thumbs/meadow.webp'} style={{ background: th.thumb || '#ccc' }}
            decoding="async" fetchPriority="high" />
        </div>
      </div>
      <div className="theme-meta" id="themeMeta">
        <div className="name">{th.name || ''}</div>
        {th.author ? <div className="author">{th.author}</div> : null}
        {th.desc ? <div className="desc">{th.desc}</div> : null}
      </div>
      <p className="preview-foot"><span id="previewFoot">{t('themePreview')}</span></p>
      <div className="preview-actions">
        <button type="button" className="ghost-btn refresh" id="reseed" title={t('refreshTitle')} onClick={reseed}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M13.2 8a5.2 5.2 0 1 1-1.6-3.75" /><path d="M13.4 2.6v3.2h-3.2" />
          </svg>
          <span>{t('refresh')}</span>
        </button>
      </div>
    </section>
  );
}
