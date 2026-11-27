// 右栏详情面板：名称（唯一一处）→ 预览画面 → 作者 / 一句话描述。
// 「重新生成」收成预览图右上角的图标钮；名称与描述构成主题的全部自我说明，不再加常驻标注。

import { useSettings } from '../store.js';
import { thumbUrl, themeById } from '../domain.js';

export function PreviewCard() {
  const { state, themes, t, reseed, setAdaptive } = useSettings();
  const th = themeById(themes, state.theme);
  if (!th) return null;
  const src = thumbUrl(th.thumb || '');
  return (
    <section className="card preview-card" id="preview">
      <div className="preview-head">
        <h2>{th.name}</h2>
        {!th.adaptive ? null : (
          <label className="switch-row adaptive-switch" title={t('adaptive')}>
            <input
              type="checkbox"
              id="adaptive"
              data-key="adaptive"
              checked={state.params[th.id]?.adaptive === 1}
              onChange={() => setAdaptive(state.params[th.id]?.adaptive !== 1)}
            />
            <i className="switch" />
            <span className="adapt-lbl">{t('adaptive')}</span>
          </label>
        )}
      </div>
      <div className={`stage${state.stageLoading ? ' loading' : ''}`}>
        <div className="preview">
          {src ? <img src={src} alt="" draggable={false} /> : null}
          <button
            type="button"
            className="icon-btn stage-refresh"
            id="previewRefresh"
            onClick={() => reseed()}
            title={t('refreshTitle')}
            aria-label={t('refreshTitle')}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v2.6h-2.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
      <p className="theme-meta" id="previewMeta">
        {th.author ? <span className="author">{t('byAuthor', { name: th.author })}</span> : null}
        <span className="desc">{th.desc}</span>
      </p>
    </section>
  );
}
