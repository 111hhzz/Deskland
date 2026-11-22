import { useEffect, useRef } from 'react';
import { useSettings } from '../store';
import { translate } from '../i18n';
import { themeById } from '../domain';

// 连接类错误码 → 界面文案键（文案在 i18n/*.json，这里只做映射）
const CONNECTION_KEYS: Record<string, string> = {
  error_connection: 'networkTimeout',
  error_timeout: 'networkTimeout',
  error_dns: 'networkDns',
  error_tls: 'networkTls',
  error_local: 'networkLocal',
  error_server_unavailable: 'serverUnavailable',
  error_server_rejected: 'serverRejected',
  error_server_invalid: 'serverInvalid',
  error_download_invalid: 'downloadInvalid',
};

const ERROR_NOTES: Record<string, string> = {
  canceled: 'updateCanceled',
  error_low_battery: 'updateLowBattery',
  error_wifi_recommended: 'updateWifiRecommended',
  error_wifi_required: 'updateWifiRequired',
  microsoft_package_required: 'updateStoreRequired',
};

export function UpdateNotice() {
  const { state, t, runUpdate } = useSettings();
  const u = state.update;
  if (!u.status) return null;
  const checking = u.status === 'checking';
  const busy = u.status === 'downloading' || u.status === 'installing';
  const percent = u.progress >= 0 && u.progress <= 1 ? Math.round(u.progress * 100) + '%' : '';
  const noteKey = ERROR_NOTES[u.error];
  let detail = u.version ? t('updateVersion', { version: u.version }) : '';
  if (checking) detail = t('updateChecking');
  else if (busy) detail = t(u.status === 'installing' ? 'updateInstalling' : 'updateDownloading', { progress: percent });
  else if (u.status === 'completed') detail = t('updateCompleted');
  else if (u.status === 'error') {
    const key = noteKey || CONNECTION_KEYS[u.error];
    detail = key ? translate(state.lang, key) : t('updateFailed');
  }
  const titleKey = u.status === 'completed'
    ? 'updateCompletedTitle'
    : checking
      ? 'updateCheckingTitle'
      : u.status === 'error' ? (u.version ? 'updateFailedTitle' : 'updateCheckFailedTitle')
        : 'updateAvailable';
  const btnKey = u.status === 'completed' ? 'updateDone' : busy || checking ? 'updateWorking' : u.status === 'error' ? 'updateRetry' : 'updateProgram';
  return (
    <div className="update-notice" id="updateNotice" role="status" aria-live="polite">
      <span className="update-symbol" aria-hidden="true">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 2.2v8.2M8 13.6v.2" />
          <path d="M8 10.4 5 7.6M8 10.4l3-2.8" />
        </svg>
      </span>
      <div className="update-copy">
        <b>{t(titleKey)}</b>
        <p>{detail}</p>
      </div>
      <button type="button" className="ghost-btn update-action" id="updateProgram"
        disabled={busy || checking || u.status === 'completed'}
        onClick={runUpdate}>{t(btnKey)}</button>
    </div>
  );
}

export function AutostartWarn() {
  const { state, t, dismissAutostartWarn } = useSettings();
  if (!state.autostartWarn) return null;
  return (
    <div className="warn" id="autostartWarn" role="alert">
      <b>{t('autostartBlocked')}</b>
      <p id="autostartWarnText">
        {state.autostartSw
          ? t('autostartWarnSw', { sw: state.autostartSw })
          : t('autostartWarnGeneric')}
      </p>
      <button type="button" id="autostartWarnOk" onClick={dismissAutostartWarn}>{t('gotIt')}</button>
    </div>
  );
}

export function PurchaseModal() {
  const { state, themes, t, closePurchase, openWebsite } = useSettings();
  const open = state.purchaseId !== null;
  const th = themeById(themes, state.purchaseId || '');
  const restoreRef = useRef<HTMLElement | null>(null);
  const siteRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      restoreRef.current = document.activeElement as HTMLElement | null;
      siteRef.current?.focus();
    } else if (restoreRef.current) {
      restoreRef.current.focus();
      restoreRef.current = null;
    }
  }, [open]);

  if (!open) return null;
  return (
    <div className="modal" id="purchaseModal" role="dialog" aria-modal="true" aria-labelledby="purchaseTitle"
      onClick={e => { if (e.target === e.currentTarget) closePurchase(); }}>
      <div className="dialog">
        <div className="dialog-symbol" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4.5" y="10" width="15" height="10" rx="2.4" /><path d="M8 10V7.6A4 4 0 0 1 16 7.6V10" />
          </svg>
        </div>
        <h2 id="purchaseTitle">{t('purchaseTitle')}</h2>
        <p className="purchase-theme" id="purchaseTheme">
          {t('purchaseLocalTheme', { name: (th?.name || '') })}
        </p>
        <p>{t('purchaseLocalMessage')}</p>
        <div className="modal-actions">
          <button type="button" id="purchaseLater" onClick={closePurchase}>{t('purchaseLater')}</button>
          <button type="button" id="purchaseWebsite" ref={siteRef} onClick={openWebsite}>{t('purchaseWebsite')}</button>
        </div>
      </div>
    </div>
  );
}

const HELP_ITEMS: Array<[string, string, string]> = [
  ['helpWallpaperQ', 'helpWallpaperA', 'helpWallpaperStep1,helpWallpaperStep2,helpWallpaperStep3'],
];

export function HelpModal() {
  const { state, t, closeHelp } = useSettings();
  const open = state.helpOpen;
  const restoreRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      restoreRef.current = document.activeElement as HTMLElement | null;
      closeRef.current?.focus();
    } else if (restoreRef.current) {
      restoreRef.current.focus();
      restoreRef.current = null;
    }
  }, [open]);

  if (!open) return null;
  return (
    <div className="modal" id="helpModal" role="dialog" aria-modal="true" aria-labelledby="helpTitle"
      onClick={e => { if (e.target === e.currentTarget) closeHelp(); }}>
      <div className="sheet">
        <div className="sheet-head">
          <div>
            <h2 id="helpTitle">{t('helpTitle')}</h2>
            <p>{t('helpSubtitle')}</p>
          </div>
          <button type="button" className="auth-close" id="helpCloseX" ref={closeRef} aria-label="close" onClick={closeHelp}>
            {t('close')}
          </button>
        </div>
        <div className="sheet-body">
          {HELP_ITEMS.map(([q, a, steps]) => (
            <article className="help-item" key={q}>
              <h3>{t(q)}</h3>
              <p>{t(a)}</p>
              <ol>{steps.split(',').map(k => <li key={k}>{t(k)}</li>)}</ol>
            </article>
          ))}
        </div>
        <div className="sheet-foot">
          <button type="button" id="helpDone" onClick={closeHelp}>{t('gotIt')}</button>
        </div>
      </div>
    </div>
  );
}