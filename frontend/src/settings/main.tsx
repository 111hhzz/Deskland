import { createRoot } from 'react-dom/client';
import { SettingsProvider } from './store';
import { SettingsApp } from './SettingsApp';
import { createWebViewHost } from './host';

// 直接挂到 body：顶栏 / 两栏 / 底栏要成为 body grid 的直接子项，
// #root 包一层会破坏 body 的 grid-template-rows 布局。
// 主题清单不在这里取：由宿主扫 themes/ 后经 init 消息下发（浏览器预览走 host.ts 的 mock）。
createRoot(document.body).render(
  <SettingsProvider host={createWebViewHost()}>
    <SettingsApp />
  </SettingsProvider>
);
