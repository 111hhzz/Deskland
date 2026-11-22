import { useEffect } from 'react';
import { useSettings } from './store';
import { TopBar } from './components/TopBar';
import { ThemeList } from './components/ThemeList';
import { PreviewCard } from './components/PreviewCard';
import { Controls } from './components/Controls';
import { HelpModal, PurchaseModal } from './components/Overlays';

export function SettingsApp() {
  const { state, t, openHelp, closeHelp, closePurchase } = useSettings();

  // 语言与主题模式写在 <html> 上，CSS 变量随之切换
  useEffect(() => {
    const root = document.documentElement;
    root.lang = state.lang;
    if (state.themeMode === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', state.themeMode);
  }, [state.lang, state.themeMode]);

  // 数据就绪：撤掉骨架屏、显示真实内容，并记录首屏耗时
  useEffect(() => {
    if (!state.ready) return;
    const root = document.documentElement;
    root.classList.add('ready');
    window.__desklandReady = true;
    window.__desklandSettingsPerf = Math.round(performance.now() - state.t0);
    document.getElementById('skeleton')?.remove();
    window.dispatchEvent(new CustomEvent('settings:ready'));
  }, [state.ready, state.t0]);

  // Escape 关闭最上层的浮层
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (state.helpOpen) closeHelp();
      else if (state.purchaseId !== null) closePurchase();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [state.helpOpen, state.purchaseId, closeHelp, closePurchase]);

  return (
    <>
      <TopBar />
      <main className="layout">
        <ThemeList />
        <div className="side">
          <PreviewCard />
          <Controls />
        </div>
      </main>
      <footer className="bottom">
        <span className={`saved${state.savedFlash ? ' flash' : ''}`} id="saved">
          {t(state.savedFlash ? 'saved' : 'autosave')}
        </span>
        <button type="button" className="ghost-btn help-button" id="helpOpen"
          aria-label="Help" title={t('helpButtonTitle')} onClick={openHelp}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <circle cx="8" cy="8" r="6.4" />
            <path d="M6.3 6.2A1.8 1.8 0 0 1 9.7 7c0 1.1-1.5 1.4-1.5 2.4" />
            <path d="M8 11.2v.1" />
          </svg>
          <span className="q">?</span>
        </button>
      </footer>
      <PurchaseModal />
      <HelpModal />
    </>
  );
}
