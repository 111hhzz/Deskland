import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { useSettings } from '../store.js';
import { LANGS } from '../i18n.js';
import type { LangSetting, ThemeMode } from '../types.js';

const GLOBE = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
    <circle cx="8" cy="8" r="6.2" />
    <path d="M1.8 8h12.4M8 1.8c1.8 1.7 2.7 3.8 2.7 6.2S9.8 12.5 8 14.2C6.2 12.5 5.3 10.4 5.3 8S6.2 3.5 8 1.8z" />
  </svg>
);

const CHEVRON = (
  <svg className="chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="M4 6l4 4 4-4" />
  </svg>
);

const THEME_ICONS: Record<ThemeMode, ReactElement> = {
  auto: (
    <>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M1.8 8h12.4" />
    </>
  ),
  light: (
    <>
      <circle cx="8" cy="8" r="3.4" />
      <path d="M8 1.6v1.4M8 13v1.4M1.6 8h1.4M13 8h1.4M3.5 3.5l1 1M11.5 11.5l1 1M12.5 3.5l-1 1M4.5 11.5l-1 1" />
    </>
  ),
  dark: <path d="M13.5 9.5A5.5 5.5 0 1 1 6.5 2.5a4.4 4.4 0 0 0 7 7z" />,
};

interface MenuProps {
  wrapId: string;
  btnId: string;
  menuId: string;
  lblId: string;
  icon: ReactElement;
  label: string;
  items: { v: string; label: string }[];
  selected: string;
  onPick: (v: string) => void;
}

function PillMenu({ wrapId, btnId, menuId, lblId, icon, label, items, selected, onPick }: MenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('click', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={`menu-wrap${open ? ' open' : ''}`} id={wrapId} ref={wrapRef}>
      <button
        type="button"
        className="pill-btn"
        id={btnId}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
        <span className="lbl" id={lblId}>
          {label}
        </span>
        {CHEVRON}
      </button>
      <div className="menu" id={menuId} role="menu" hidden={!open}>
        {items.map((it) => (
          <button
            type="button"
            key={it.v}
            role="menuitemradio"
            aria-checked={it.v === selected}
            data-v={it.v}
            onClick={() => {
              onPick(it.v);
              setOpen(false);
            }}
          >
            {it.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function TopBar() {
  const { state, t, pickLang, pickThemeMode, setAutostart } = useSettings();
  const langLbl = state.langSetting === 'auto' ? t('langAuto') : LANGS[state.langSetting] || 'English';
  const modeLbl = t(
    state.themeMode === 'auto' ? 'themeModeAuto' : state.themeMode === 'light' ? 'themeModeLight' : 'themeModeDark',
  );
  return (
    <header className="top">
      <div className="top-left">
        <div className="brand">Deskland+</div>
        <div className="section-title">{t('themes')}</div>
      </div>
      <div className="spacer" aria-hidden="true" />
      <div className="top-right">
        <PillMenu
          wrapId="langWrap"
          btnId="langBtn"
          menuId="langMenu"
          lblId="langLbl"
          icon={GLOBE}
          label={langLbl}
          selected={state.langSetting in LANGS ? state.langSetting : 'auto'}
          items={[
            { v: 'auto', label: t('langAuto') },
            { v: 'zh-CN', label: '简体中文' },
            { v: 'en', label: 'English' },
          ]}
          onPick={(v) => pickLang(v as LangSetting)}
        />
        <PillMenu
          wrapId="themeModeWrap"
          btnId="themeModeBtn"
          menuId="themeModeMenu"
          lblId="themeModeLbl"
          icon={
            <svg
              id="themeModeIcon"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              aria-hidden="true"
            >
              {THEME_ICONS[state.themeMode]}
            </svg>
          }
          label={modeLbl}
          selected={state.themeMode}
          items={[
            { v: 'auto', label: t('themeModeAuto') },
            { v: 'light', label: t('themeModeLight') },
            { v: 'dark', label: t('themeModeDark') },
          ]}
          onPick={(v) => pickThemeMode(v as ThemeMode)}
        />
        <label className="switch-row" title={t('autostartTitle')}>
          <span>{t('autostart')}</span>
          <input
            type="checkbox"
            id="autostart"
            checked={state.autostart}
            onChange={(e) => setAutostart(e.target.checked)}
          />
          <i className="switch" />
        </label>
      </div>
    </header>
  );
}
