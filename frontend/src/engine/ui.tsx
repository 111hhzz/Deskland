// 壁纸页的静态 DOM 外壳（任务栏 + 调试面板）。
// 这两个容器都是 position:fixed，真实壁纸模式下被 body.wall 隐藏，
// 所以用 React 渲染不会影响壁纸首帧：挂载在独立容器里，与 canvas 无关。
// 面板里的滑块 / 统计 / 时钟由 DeskApp 按需写入（这些节点只渲染一次，不会被 React 重刷）。

const APPS = [
  <svg key="a" viewBox="0 0 24 24"><rect x="2" y="2" width="9.5" height="9.5" fill="#4cc2ff" /><rect x="12.5" y="2" width="9.5" height="9.5" fill="#4cc2ff" /><rect x="2" y="12.5" width="9.5" height="9.5" fill="#4cc2ff" /><rect x="12.5" y="12.5" width="9.5" height="9.5" fill="#4cc2ff" /></svg>,
  <svg key="b" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="#fff" strokeWidth="2" /><path d="M15 15l5 5" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" /></svg>,
  <svg key="c" viewBox="0 0 24 24"><path d="M2 6a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v1H2z" fill="#e09b1d" /><path d="M2 9h20v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z" fill="#ffc83d" /></svg>,
  <svg key="d" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#1b8fd6" /><path d="M6 13c1-5 11-6 12 0-3-2-8-2-9 2 0 2 2 3 4 3-4 1-7-1-7-5z" fill="#6fe37a" opacity=".9" /></svg>,
  <svg key="e" viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2.5" fill="#2b2b2b" stroke="#777" /><path d="M6 9l3 3-3 3M11 15h6" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" /></svg>,
];

const LAYOUTS: Array<[string, string]> = [
  ['mine', '仿你的桌面'],
  ['arranged', '自动排列'],
  ['messy', '杂乱'],
  ['minimal', '极简'],
];

const TOGGLES: Array<[string, string]> = [
  ['debug', '显示云的边界'],
  ['snap', '对齐网格'],
  ['cap30', '限帧 30fps'],
];

export function WallShell() {
  return (
    <>
      <div id="taskbar">
        <div className="apps">
          {APPS.map((icon, i) => <div className="app" key={i}>{icon}</div>)}
        </div>
        <div id="clock"></div>
      </div>

      <aside id="panel">
        <header>
          <div><b>Deskland</b><span id="panelSub">引擎</span></div>
          <div><button className="ibtn" id="collapse" title="折叠">–</button></div>
        </header>
        <div className="body">
          <div className="sec">
            <div className="t">桌面布局</div>
            <div className="seg">
              {LAYOUTS.map(([v, label]) => <button key={v} data-v={v}>{label}</button>)}
            </div>
          </div>
          <div className="sec" id="sliders"></div>
          <div className="sec toggles">
            {TOGGLES.map(([k, label]) => (
              <label key={k}><input type="checkbox" data-key={k} />{label}</label>
            ))}
          </div>
          <div className="sec btns">
            <button id="btnAdd">＋ 新建文件</button>
            <button id="btnSeed">换一种云</button>
          </div>
          <div id="stats"></div>
          <div className="hint">页内热切换验证</div>
        </div>
      </aside>
    </>
  );
}
