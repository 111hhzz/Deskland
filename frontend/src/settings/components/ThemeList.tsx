import { useSettings } from '../store.js';
import { AutostartWarn, UpdateNotice } from './Overlays.js';

export function ThemeList() {
  const { state, themes, t, selectTheme, setSearch, refreshThemes, deleteTheme } = useSettings();
  const q = state.search.trim().toLowerCase();
  return (
    <section className="themes">
      <div className="collection-head">
        <h1>{t('collectionTitle')}</h1>
        <p>{t('collectionSubtitle')}</p>
      </div>
      <UpdateNotice />
      <AutostartWarn />
      <div className="theme-tools">
        <input
          className="theme-search"
          id="themeSearch"
          type="search"
          placeholder={t('searchThemes')}
          autoComplete="off"
          aria-label={t('searchThemes')}
          value={state.search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          type="button"
          id="refreshThemes"
          className="ghost-btn refresh-btn"
          disabled={state.refreshing}
          onClick={refreshThemes}
          title={t('refreshThemesTitle')}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
            <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v2.6h-2.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>{state.refreshing ? t('refreshingThemes') : t('refreshThemes')}</span>
        </button>
      </div>
      <div className="theme-list" id="themes">
        {themes.map((th) => {
          const locked = th.status === 'locked';
          const ready = th.status === 'ready';
          const on = th.id === state.theme;
          const badge = t(on ? 'badgeOn' : locked ? 'badgeLocked' : ready ? 'badgeReady' : 'badgeSoon');
          const match =
            !q ||
            th.name.toLowerCase().includes(q) ||
            th.id.toLowerCase().includes(q) ||
            badge.toLowerCase().includes(q);
          return (
            <button
              key={th.id}
              type="button"
              className={`theme${on ? ' on' : ''}${locked ? ' locked' : ''}`}
              data-id={th.id}
              data-locked={locked}
              aria-pressed={on}
              disabled={!ready && !locked}
              hidden={!match}
              onClick={() => selectTheme(th.id)}
            >
              <div className="theme-copy">
                <div className="theme-meta">
                  <span className="badge" aria-hidden="true">
                    {badge}
                  </span>
                  <svg
                    className="theme-arrow"
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    aria-hidden="true"
                  >
                    <path d="M5 15 15 5M5 5h10v10" />
                  </svg>
                </div>
                <div className="name">{th.name}</div>
              </div>
              <div className="thumb" style={{ background: th.thumb || '#ccc' }}>
                {locked ? (
                  <span className="lock-mark" aria-hidden="true">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="5" y="10" width="14" height="11" rx="2.5" />
                      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                    </svg>
                  </span>
                ) : null}
                {th.product === 'user' ? (
                  <span
                    className="del-mark"
                    role="button"
                    tabIndex={0}
                    title={on ? t('deleteCurrentBlocked') : t('deleteThemeTitle')}
                    data-del={th.id}
                    aria-label={t('deleteThemeTitle')}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (on) return;
                      if (window.confirm(t('deleteConfirm'))) deleteTheme(th.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' || on) return;
                      e.stopPropagation();
                      if (window.confirm(t('deleteConfirm'))) deleteTheme(th.id);
                    }}
                  >
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                      <path d="M3 3l10 10M13 3L3 13" strokeLinecap="round" />
                    </svg>
                  </span>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
