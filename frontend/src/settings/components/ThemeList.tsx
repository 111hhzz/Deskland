import { useState } from 'react';
import type { DragEvent } from 'react';
import { useSettings } from '../store.js';
import { thumbUrl } from '../domain.js';
import type { ThemeDef } from '../types.js';
import { AutostartWarn, UpdateNotice } from './Overlays.js';
import { ImportCard } from './ImportCard.js';

export function ThemeList() {
  const { state, themes, t, selectTheme, setSearch, refreshThemes, deleteTheme, importFiles } = useSettings();
  const [over, setOver] = useState(false);
  const q = state.search.trim().toLowerCase();

  // 拖拽导入的热区就是这条工具行：点「+ 导入」走原生对话框，拖文件到行内直传
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length) importFiles(files);
  };

  return (
    <section className="themes">
      <div className="collection-head">
        <h1>{t('collectionTitle')}</h1>
      </div>
      <UpdateNotice />
      <AutostartWarn />
      <div
        className={`theme-tools${over ? ' over' : ''}`}
        id="importCard"
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
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
        <ImportCard />
        {state.notice ? (
          <p className="import-notice" id="importNotice" role="status">
            {t(state.notice.key, state.notice.vars)}
          </p>
        ) : null}
        <button
          type="button"
          id="refreshThemes"
          className="icon-btn refresh-btn"
          disabled={state.refreshing}
          onClick={refreshThemes}
          title={t('refreshThemesTitle')}
          aria-label={t('refreshThemes')}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
            <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v2.6h-2.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="sr-text">{state.refreshing ? t('refreshingThemes') : t('refreshThemes')}</span>
        </button>
      </div>
      <div className="theme-list" id="themes">
        {themes.map((th) => {
          const locked = th.status === 'locked';
          const ready = th.status === 'ready';
          const on = th.id === state.theme;
          // 默认态不占版面：只有「使用中 / 未解锁 / 即将推出」才挂徽章
          const badge = on ? t('badgeOn') : locked ? t('badgeLocked') : ready ? null : t('badgeSoon');
          const match =
            !q ||
            th.name.toLowerCase().includes(q) ||
            th.id.toLowerCase().includes(q) ||
            (badge ?? '').toLowerCase().includes(q);
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
              {badge ? (
                <span className="badge" aria-hidden="true">
                  {on ? <i className="dot" /> : null}
                  {badge}
                </span>
              ) : null}
              <div className="thumb" style={{ background: th.thumb || '#ccc' }}>
                {thumbImg(th)}
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
                <span className="name">{th.name}</span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

// 缩略图优先：<Img> 复用主题清单下发的 thumb；无图时保留渐变底
function thumbImg(th: ThemeDef) {
  const src = thumbUrl(th.thumb || '');
  return src ? <img src={src} alt="" draggable={false} /> : null;
}
