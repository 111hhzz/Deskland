// 设置页布局：顶栏（产品名 + 语言 / 外观）→ 左右两栏（主题选择 | 预览 + 参数）→ 底栏（保存状态 / 开机自启 / 帮助）。
// 布局本身承担解释：卡片缩略图即主题内容，选中态靠描边；说明文字只在 hover / focus 的 tooltip 里出现。

import { useEffect } from 'react';
import { useSettings } from './store.js';
import { TopBar } from './components/TopBar.js';
import { ThemeList } from './components/ThemeList.js';
import { PreviewCard } from './components/PreviewCard.js';
import { Controls } from './components/Controls.js';
import { HelpModal, PurchaseModal } from './components/Overlays.js';

export function SettingsApp() {
  const { state, t, setAutostart, setPure, openHelp, closeHelp, closePurchase } = useSettings();

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
        <div className="themes-col">
          <ThemeList />
        </div>
        <aside className="side">
          <PreviewCard />
          <Controls />
        </aside>
      </main>
      <footer className="bottom">
        <div className="bottom-left">
          <span className={'saved' + (state.savedFlash ? ' flash' : '')} id="savedTick">
            {t('saved')}
          </span>
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
          <label className="switch-row" title={t('pureDesktopTitle')}>
            <span>{t('pureDesktop')}</span>
            <input type="checkbox" id="pureToggle" checked={state.pure} onChange={(e) => setPure(e.target.checked)} />
            <i className="switch" />
          </label>
        </div>
        <div className="bottom-actions">
          <button
            type="button"
            id="helpOpen"
            className="ghost-btn help-button"
            onClick={openHelp}
            title={t('helpButtonTitle')}
          >
            ?
          </button>
        </div>
      </footer>
      <PurchaseModal />
      <HelpModal />
    </>
  );
}
