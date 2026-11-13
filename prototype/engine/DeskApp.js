// Deskland 应用外壳：桌面图标布局 / 拖拽、面板、任务栏、时钟、宿主消息协议。
// 构造器接收一个引擎实例（渲染侧的状态与能力），本类只负责应用层逻辑。
//
// 过渡期约定：把共享状态（W/H/P/icons/seed/TASKBAR）挂到 window，
// 让 meadow-boy.js / meadow-cat.js 等旧脚本继续以全局方式读取，行为保持 100% 一致。
// 待引擎迁移稳定后，再消除这层全局污染。

const CELL_W = 76, CELL_H = 100, GRID_X0 = 4, GRID_Y0 = 6, TASKBAR = 48;
const STEP = 5;
const DISPLAY_KEYS = ['showBoy', 'showCat', 'adaptive'];
const SLIDERS = [
  { key: 'sigma',  label: '云团大小', min: 40,  max: 200, step: 1,    fmt: v => v + ' px', act: 'field' },
  { key: 'cover',  label: '草地上的云', min: 0,   max: 1,   step: 0.01, fmt: v => Math.round(v * 100) + '%' },
  { key: 'flow',   label: '流动速度', min: 0,   max: 3,   step: 0.05, fmt: v => '×' + v.toFixed(2) },
];

/* ======================================================================
   图标与布局数据
   ====================================================================== */
const PAGE = '<path d="M12 4h17l9 9v29a2 2 0 0 1-2 2H12a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="#fbfbfb" stroke="#c4c4c4"/><path d="M29 4v7a2 2 0 0 0 2 2h7z" fill="#dedede"/>';
const LINES = '<path d="M24 20h10M24 25h10M24 30h10M24 35h10" stroke="#c9c9c9" stroke-width="1.6"/>';
const badge = (color, text, size = 11) => `<rect x="4" y="21" width="19" height="19" rx="3" fill="${color}"/><text x="13.5" y="34.5" text-anchor="middle" font-family="Segoe UI,Arial" font-weight="700" font-size="${size}" fill="#fff">${text}</text>`;
const SVG = {
  folder: '<path d="M4 12a3 3 0 0 1 3-3h11l4 4h19a3 3 0 0 1 3 3v2H4z" fill="#e09b1d"/><path d="M4 17h40v20a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z" fill="#ffc83d"/><path d="M4 17h40v2.5H4z" fill="#ffd978"/>',
  docx: PAGE + LINES + badge('#185abd', 'W'),
  xlsx: PAGE + '<path d="M24 19h11v17H24zM24 24.5h11M24 30h11M29.5 19v17" stroke="#9ac9a9" stroke-width="1.3" fill="none"/>' + badge('#107c41', 'X'),
  pdf:  PAGE + LINES + badge('#d33a2c', 'PDF', 7.5),
  cad:  PAGE + LINES + badge('#2a7fd4', 'DWG', 7),
  txt:  PAGE + '<path d="M16 18h16M16 23h16M16 28h16M16 33h10" stroke="#9a9a9a" stroke-width="1.6"/>',
  png:  PAGE + '<rect x="14" y="17" width="20" height="17" rx="1.5" fill="#8fd0f5"/><path d="M14 30l6-6 5 5 3-3 6 6v1.5a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 14 34z" fill="#3fa35a"/><circle cx="29" cy="21.5" r="2" fill="#fff4b8"/>',
  shot: '<rect x="3" y="13" width="42" height="25" rx="1" fill="#1d2129" stroke="#f2f2f2" stroke-width="1.5"/><rect x="6" y="16" width="14" height="3" fill="#5b8def"/><rect x="6" y="21" width="22" height="2" fill="#6c7280"/><rect x="6" y="25" width="18" height="2" fill="#6c7280"/><rect x="31" y="16" width="11" height="18" fill="#2e3440"/>',
  zip:  PAGE + '<path d="M22 4v4h3v3h-3v3h3v3h-3v3h3v3h-3" stroke="#8a6d3b" stroke-width="2" fill="none"/><rect x="20" y="26" width="7" height="8" rx="1" fill="#8a6d3b"/>',
  bin:  '<path d="M12 14h24l-2.5 27a3 3 0 0 1-3 2.7H17.5a3 3 0 0 1-3-2.7z" fill="rgba(215,235,250,.55)" stroke="rgba(255,255,255,.9)" stroke-width="1.2"/><path d="M10 12.5h28" stroke="rgba(255,255,255,.95)" stroke-width="2.4" stroke-linecap="round"/><path d="M19 19l1 19M24 19v19M29 19l-1 19" stroke="rgba(255,255,255,.7)" stroke-width="1.2"/>',
  pc:   '<rect x="5" y="8" width="38" height="26" rx="2" fill="#1f8fe0" stroke="#bfe3ff" stroke-width="1.5"/><path d="M5 30h38" stroke="#0d5fa8" stroke-width="3"/><path d="M19 34l-2 6h14l-2-6z" fill="#9aa7b4"/>',
};
const APP_COLORS = ['#e8553e','#2f7de1','#18a058','#8b5cf6','#f59e0b','#0ea5a4','#db2777','#334155','#16a34a','#2563eb'];
function appSVG(name) {
  let h = 0; for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return `<rect x="5" y="5" width="38" height="38" rx="9" fill="${APP_COLORS[h % APP_COLORS.length]}"/><path d="M5 14a9 9 0 0 1 9-9h20a9 9 0 0 1 9 9v6H5z" fill="#fff" opacity=".14"/>` +
    `<text x="24" y="31.5" text-anchor="middle" font-family="Segoe UI,Microsoft YaHei,Arial" font-weight="700" font-size="18" fill="#fff">${[...name][0]}</text>`;
}
const glyphOf = (name, type) => type === 'app' ? appSVG(name) : SVG[type];

const FILES = [
  ['回收站','bin'], ['项目资料','folder'], ['2026 报价单.xlsx','xlsx'], ['产品需求.docx','docx'],
  ['截图_0927.png','png'], ['合同扫描件.pdf','pdf'], ['新建文件夹','folder'], ['设计素材','folder'],
  ['旅行照片','folder'], ['安装包.zip','zip'], ['会议纪要.docx','docx'], ['壁纸灵感','folder'],
  ['周报.xlsx','xlsx'], ['草图.png','png'], ['旧备份','folder'], ['微信图片.png','png'], ['说明书.pdf','pdf'], ['简历.docx','docx'], ['支出表.xlsx','xlsx'], ['压缩备份.zip','zip'], ['素材图.png','png'], ['下载','folder'], ['表情包.png','png'], ['工资条.xlsx','xlsx'], ['租房合同.pdf','pdf'], ['日记.docx','docx'], ['桌面截图.png','png'],
];
const EXTRA = [
  ['新建文本文档.txt','txt'], ['新建文件夹 (2)','folder'], ['发票.pdf','pdf'], ['数据导出.xlsx','xlsx'],
  ['截图_0928.png','png'], ['备忘.txt','txt'], ['归档.zip','zip'], ['新建文件夹 (3)','folder'],
];
const APPS = ['回收站','此电脑','微信','飞书','钉钉','腾讯会议','网易云音乐','剪映','Photoshop','Obsidian','VS Code','Krita',
  'AutoCAD','Rhino','KeyShot','百度网盘','Chrome','Blender','Figma','Notion','QQ','Steam','Eagle','OBS','Kimi','PureRef','EV录屏','NX 12.0','MarkText','Codex'];
const MISC = [['projects','folder'],['游戏','folder'],['todolist','folder'],['OKR管理.xlsx','xlsx'],['固定成本.xlsx','xlsx'],
  ['pdfarrange','app'],['stp.log','txt'],['零件.stp','txt'],['零件.3dm','png'],['预览','folder']];
const RIGHT = [['plot.log','txt'],['工具','folder'],['归档.rar','zip'],['1685x128.png','png'],['微信图片.jpg','png'],['0914.png','png'],
  ['微信图片 2.jpg','png'],['images.png','png'],['目录.docx','docx'],['api.txt','txt'],['c4ef.png','png'],['0918.png','png'],
  ['板调整.pdf','pdf'],['recommend.txt','txt'],['button.stp','txt'],['新建文本 (2).txt','txt'],['ugstep21','txt'],['新建文本 (3).txt','txt'],
  ['工作计划.txt','txt'],['微信图片 3.jpg','png'],['新建 DOCX.docx','docx'],['SEO.txt','txt'],['resend.txt','txt'],['产品介绍.txt','txt'],
  ['USER.pdf','pdf'],['新建文本.txt','txt'],['餐椅.pur','png'],['PAP-20.pdf','pdf'],['演示文稿.pptx','pdf'],['问题点.txt','txt']];
function mineCells() {
  const out = []; let a = 0, m = 0, rgt = 0, sh = 0;
  for (let c = 0; c < 3; c++) for (let r = 0; r < 10; r++) {
    const name = APPS[a++];
    out.push([c, r, name, name === '回收站' ? 'bin' : name === '此电脑' ? 'pc' : 'app']);
  }
  for (let r = 0; r < 10; r++) out.push([3, r, ...MISC[m++]]);
  for (let r = 0; r < 5; r++) out.push([5, r, `零件结构 ${r + 1}.dwg`, 'cad']);
  out.push([6, 0, '腿测试.bak', 'txt']);
  for (const [c, r] of [[6,4],[6,5],[6,6],[6,7],[6,8],[7,3],[7,4],[7,5],[7,6],[7,7],[8,4],[8,5],[8,6],[9,2],[9,3],[9,4],[9,5],[9,6]])
    out.push([c, r, `ScreenShot ${++sh}.png`, 'shot']);
  for (const [c, r] of [[11,1],[11,2],[11,3],[12,1],[12,2],[12,3],[12,4],[13,1],[13,2],[13,3],[13,4],[14,1],[14,3],[14,4],[15,1],[15,6],
    [16,4],[16,6],[17,4],[17,5],[17,6],[17,7],[19,4],[19,5],[19,8],[20,0],[20,4],[20,6],[21,0],[21,5],[21,6]]) {
    const f = RIGHT[rgt++ % RIGHT.length]; out.push([c, r, f[0], f[1]]);
  }
  return out;
}

/* ======================================================================
   DeskApp
   ====================================================================== */
export class DeskApp {
  constructor(engine) {
    this.engine = engine;
    this.desktop = document.getElementById('desktop');
    this.grid = { cols: 1, rows: 1 };
    this.DW = innerWidth; this.DH = innerHeight - TASKBAR;
    this.selected = null;
    this.drag = null;
    this.extraIdx = 0;
    this.layoutCapacity = 0;
    this.layoutKind = 'mine';
    this.iconsSeen = false;
    this.ripples = [];
    this.statsEl = document.getElementById('stats');
    this.DEFAULTS = Object.assign({}, engine.params);
    this._firstIcons = true;
    this._resizeT = 0;
    const QS = new URLSearchParams(location.search);
    this.WALL = QS.has('wallpaper');
    this.PREVIEW = QS.has('preview');
    this.iconsSeen = !(this.WALL || this.PREVIEW);   // 浏览器模式一开始就有演示图标
  }

  // 共享状态的便捷访问
  get icons() { return this.engine.icons; }
  get P() { return this.engine.params; }

  start() {
    this.buildSliders();
    this.bindEvents();
    if (this.WALL || this.PREVIEW) this.setupHostMessages();
    this.engine.on('resize', () => this.onResize());
    this.engine.on('stats', () => this.updateStats());
    this.mountToWindow();
    this.tickClock();
    setInterval(() => this.tickClock(), 15000);
    if (!this.WALL && !this.PREVIEW) { this.layoutIcons('mine'); this.syncPanel(); }
  }

  // 过渡期：把共享状态挂到 window，供 boy/cat 等旧脚本以全局方式读取
  mountToWindow() {
    window.TASKBAR = TASKBAR;
    window.P = this.engine.params;
    window.gl = this.engine.gl;   // boy/cat 脚本仍直接读取渲染上下文
    window.cv = this.engine.cv;
    window.program = this.engine.program;
    Object.defineProperty(window, 'W', { get: () => this.engine.W, configurable: true });
    Object.defineProperty(window, 'H', { get: () => this.engine.H, configurable: true });
    Object.defineProperty(window, 'icons', {
      get: () => this.engine.icons, set: v => { this.engine.icons = v; }, configurable: true,
    });
    Object.defineProperty(window, 'seed', {
      get: () => this.engine.seed, set: v => { this.engine.setSeed(v); }, configurable: true,
    });
  }

  /* ---------------- 事件与面板 ---------------- */

  bindEvents() {
    document.querySelector('.seg').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      this.layoutIcons(b.dataset.v); this.syncPanel();
    });
    document.querySelectorAll('.toggles input').forEach(inp => inp.addEventListener('change', () => {
      this.P[inp.dataset.key] = inp.checked;
    }));
    document.getElementById('collapse').addEventListener('click', () => {
      const p = document.getElementById('panel');
      p.classList.toggle('collapsed');
      document.getElementById('collapse').textContent = p.classList.contains('collapsed') ? '+' : '–';
    });
    document.getElementById('btnSeed').addEventListener('click', () => this.reseed((Math.random() * 1e6) | 0));
    document.getElementById('btnAdd').addEventListener('click', () => this.addFile());
    this.desktop.addEventListener('pointerdown', e => {
      this.select(null);
      if (this.engine.isWater(e.clientX, e.clientY)) this.addRipple(e.clientX, e.clientY);
    });
    addEventListener('keydown', e => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected) {
        const ic = this.selected; this.select(null); ic.el.remove();
        this.engine.icons = this.icons.filter(x => x !== ic); this.engine.commit();
      } else if (e.key === 'h' || e.key === 'H') document.getElementById('panel').classList.toggle('hidden');
    });
  }

  buildSliders() {
    const slidersEl = document.getElementById('sliders');
    for (const s of SLIDERS) {
      const wrap = document.createElement('div');
      wrap.className = 'slider';
      wrap.innerHTML = `<div class="row"><span>${s.label}</span><span></span></div><input type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${this.P[s.key]}">`;
      const out = wrap.querySelector('.row span:last-child'), inp = wrap.querySelector('input');
      out.textContent = s.fmt(this.P[s.key]);
      inp.addEventListener('input', () => {
        this.P[s.key] = +inp.value; out.textContent = s.fmt(this.P[s.key]);
        if (s.act === 'field') this.engine.refresh();
        else if (s.act === 'size') { this.engine.resize(); this.engine.refresh(); }
      });
      slidersEl.appendChild(wrap);
    }
  }

  updateStats() {
    const s = this.engine.getStats();
    this.statsEl.innerHTML =
      `<span class="live">● 动画中 · ${s.fps.toFixed(0)} fps</span><br>GPU ${s.gpu}<br>` +
      `单帧 ${s.frame.toFixed(1)} ms · 陆地场 ${s.field.toFixed(0)} ms<br>` +
      `画布 ${s.width}×${s.height} · 图标 ${this.icons.length}`;
  }

  syncPanel() {
    document.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', b.dataset.v === this.layoutKind));
    document.querySelectorAll('.toggles input').forEach(inp => { inp.checked = this.P[inp.dataset.key]; });
  }

  tickClock() {
    const d = new Date(), z = n => String(n).padStart(2, '0');
    document.getElementById('clock').innerHTML = `${z(d.getHours())}:${z(d.getMinutes())}<br>${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  }

  onResize() {
    if (this.WALL || this.PREVIEW) return;
    this.computeGrid();
    if (this.grid.cols * this.grid.rows > this.layoutCapacity && this.layoutCapacity < 40) {
      this.layoutIcons(this.layoutKind); this.syncPanel(); return;
    }
    for (const ic of this.icons) this.setPos(ic, Math.min(ic.x, Math.max(0, this.DW - ic.w)), Math.min(ic.y, Math.max(0, this.DH - ic.h)));
    this.engine.refresh();
  }

  /* ---------------- 图标布局 / 拖拽 ---------------- */

  computeGrid() {
    this.DW = innerWidth; this.DH = innerHeight - TASKBAR;
    this.grid.cols = Math.max(1, Math.floor((this.DW - GRID_X0) / CELL_W));
    this.grid.rows = Math.max(1, Math.floor((this.DH - GRID_Y0) / CELL_H));
  }
  cellPos(c, r) { return { x: GRID_X0 + c * CELL_W, y: GRID_Y0 + r * CELL_H }; }
  occupied(x, y, self) {
    return this.icons.some(ic => ic !== self && Math.abs(ic.x - x) < CELL_W / 2 && Math.abs(ic.y - y) < CELL_H / 2);
  }
  nearestFreeCell(cx, cy, self) {
    let best = null, bd = Infinity;
    for (let c = 0; c < this.grid.cols; c++) for (let r = 0; r < this.grid.rows; r++) {
      const pos = this.cellPos(c, r);
      if (this.occupied(pos.x, pos.y, self)) continue;
      const dd = Math.hypot(pos.x + CELL_W / 2 - cx, pos.y + CELL_H / 2 - cy);
      if (dd < bd) { bd = dd; best = pos; }
    }
    return best;
  }
  addRipple(x, y, str = 1) {
    this.ripples.push({ x, y, t0: performance.now(), str });
    if (this.ripples.length > 6) this.ripples.shift();
  }
  addIcon([name, type], pos, born = false) {
    const el = document.createElement('div');
    el.className = 'icon' + (born ? ' born' : '');
    el.innerHTML = `<div class="glyph"><svg viewBox="0 0 48 48">${glyphOf(name, type)}</svg></div><div class="label">${name}</div>`;
    el.style.left = pos.x + 'px'; el.style.top = pos.y + 'px';
    this.desktop.appendChild(el);
    const ic = { name, type, x: pos.x, y: pos.y, w: el.offsetWidth, h: el.offsetHeight, el };
    this.engine.icons.push(ic); this.bindDrag(ic);
    return ic;
  }
  setPos(ic, x, y) { ic.x = x; ic.y = y; ic.el.style.left = x + 'px'; ic.el.style.top = y + 'px'; }
  select(ic) {
    if (this.selected) this.selected.el.classList.remove('sel');
    this.selected = ic;
    if (ic) ic.el.classList.add('sel');
  }
  bindDrag(ic) {
    const el = ic.el;
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.stopPropagation(); this.select(ic);
      el.setPointerCapture(e.pointerId); el.classList.remove('settle');
      this.drag = { ic, sx: e.clientX, sy: e.clientY, ox: ic.x, oy: ic.y, moved: false };
    });
    el.addEventListener('pointermove', e => {
      if (!this.drag || this.drag.ic !== ic) return;
      const dx = e.clientX - this.drag.sx, dy = e.clientY - this.drag.sy;
      if (!this.drag.moved && Math.hypot(dx, dy) < 4) return;
      this.drag.moved = true; el.classList.add('drag');
      el.style.left = this.drag.ox + dx + 'px'; el.style.top = this.drag.oy + dy + 'px';
    });
    const end = (e, cancel) => {
      if (!this.drag || this.drag.ic !== ic) return;
      const d = this.drag; this.drag = null;
      el.classList.remove('drag');
      if (!d.moved) return;
      let nx = cancel ? d.ox : d.ox + (e.clientX - d.sx), ny = cancel ? d.oy : d.oy + (e.clientY - d.sy);
      nx = Math.min(Math.max(nx, 0), this.DW - ic.w); ny = Math.min(Math.max(ny, 0), this.DH - ic.h);
      if (this.P.snap && !cancel) { const c = this.nearestFreeCell(nx + ic.w / 2, ny + ic.h / 2, ic); if (c) { nx = c.x; ny = c.y; } }
      if (Math.hypot(nx - d.ox, ny - d.oy) < 0.5) { this.setPos(ic, nx, ny); return; }
      const cx = nx + ic.w / 2, cy = ny + ic.h / 2;
      if (this.engine.isWater(cx, cy)) this.addRipple(cx, cy, 1.3);
      el.classList.add('settle'); this.setPos(ic, nx, ny);
      this.engine.commit();
    };
    el.addEventListener('pointerup', e => end(e, false));
    el.addEventListener('pointercancel', e => end(e, true));
  }
  mulberry32(a) {
    return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  layoutIcons(kind) {
    this.layoutKind = kind;
    this.icons.forEach(ic => ic.el.remove());
    this.engine.icons = [];
    this.selected = null; this.extraIdx = 0;
    this.computeGrid();
    this.layoutCapacity = this.grid.cols * this.grid.rows;
    if (kind === 'mine') {
      for (const [c, r, name, type] of mineCells()) {
        const pos = this.cellPos(Math.round(c * (this.grid.cols - 1) / 21), Math.round(r * (this.grid.rows - 1) / 9));
        if (!this.occupied(pos.x, pos.y, null)) this.addIcon([name, type], pos);
      }
    } else if (kind === 'arranged') {
      FILES.forEach((f, i) => { const c = Math.floor(i / this.grid.rows), r = i % this.grid.rows; if (c < this.grid.cols) this.addIcon(f, this.cellPos(c, r)); });
    } else if (kind === 'messy') {
      const rnd = this.mulberry32(20260928);
      for (const f of FILES) for (let t = 0; t < 300; t++) {
        const c = rnd() < 0.45 ? Math.floor(rnd() * Math.min(3, this.grid.cols)) : Math.floor(rnd() * this.grid.cols);
        const pos = this.cellPos(c, Math.floor(rnd() * this.grid.rows));
        if (!this.occupied(pos.x, pos.y, null)) { this.addIcon(f, pos); break; }
      }
    } else {
      Array.from({ length: 10 }, (_, r) => [[0, r], [1, r]]).flat().concat([[2, 0], [2, 1], [2, 2], [3, 0], [3, 1], [3, 2], [Math.floor(this.grid.cols * 0.45), Math.floor(this.grid.rows * 0.5)]])
        .forEach(([c, r], i) => this.addIcon(FILES[i], this.cellPos(Math.min(c, this.grid.cols - 1), Math.min(r, this.grid.rows - 1))));
    }
    this.engine.commit(true);
  }
  addFile() {
    const f = EXTRA[this.extraIdx++ % EXTRA.length];
    let pos = null;
    for (let t = 0; t < 300 && !pos; t++) {
      const c = this.cellPos(Math.floor(Math.random() * this.grid.cols), Math.floor(Math.random() * this.grid.rows));
      if (!this.occupied(c.x, c.y, null)) pos = c;
    }
    if (!pos) return;
    const ic = this.addIcon(f, pos, true);
    this.select(ic);
    if (this.engine.isWater(pos.x + ic.w / 2, pos.y + ic.h / 2)) this.addRipple(pos.x + ic.w / 2, pos.y + ic.h / 2, 1.3);
    this.engine.commit();
  }

  /* ---------------- 设置 / 换云 ---------------- */

  // 换一张：新的种子（设置窗口的"刷新"、面板上的"换一张"）。已经知道图标在哪了就从头再来一遍开场；
  // 壁纸 / 预览刚打开、还不知道图标在哪的时候只记下种子（等图标来了再按它画）
  reseed(v) {
    this.engine.setSeed(v);
    if (!this.iconsSeen) return;
    this.engine.commit(true);
  }

  // 应用设置：只接受面板上有的参数；云团大小要重算场
  applySettings(v) {
    if (typeof v.seed === 'number' && v.seed !== this.engine.seed) this.reseed(v.seed);
    let field = false, adaptiveChanged = false;
    for (const k in v) {
      if ((!SLIDERS.some(s => s.key === k) && !DISPLAY_KEYS.includes(k)) || typeof v[k] !== typeof this.P[k] || this.P[k] === v[k]) continue;
      if (DISPLAY_KEYS.includes(k) && v[k] !== 0 && v[k] !== 1) continue;
      this.P[k] = v[k];
      if (k === 'adaptive') adaptiveChanged = true;
      if (k === 'sigma') field = true;
    }
    if (!this.engine.hasField()) return;
    if (adaptiveChanged) this.engine.commit();
    else if (field) this.engine.refresh();
  }

  /* ---------------- 托管模式（宿主消息协议） ---------------- */

  drawGhosts() {
    const box = document.getElementById('ghosts');
    box.innerHTML = this.icons.map(ic => `<div class="ghost" style="left:${ic.x}px;top:${ic.y}px;width:${ic.w}px;height:${ic.h}px"><i></i><b></b></div>`).join('');
  }

  setupHostMessages() {
    document.body.classList.add('wall');
    if (this.PREVIEW) {
      document.body.classList.add('preview');
      const g = document.createElement('div'); g.id = 'ghosts'; document.body.appendChild(g);
    }
    this.engine.icons = [];
    this.engine.commit(true);                     // 先是一片草地（还不知道图标在哪）
    this._firstIcons = true;
    if (this.PREVIEW) {
      addEventListener('message', ev => { if (ev.source === parent) this._handle(typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data); });
      parent.postMessage(JSON.stringify({ t: 'ready' }), '*');
      return;
    }
    const host = window.chrome && window.chrome.webview;
    if (!host) return;
    host.addEventListener('message', ev => this._handle(JSON.parse(ev.data)));
    host.postMessage('ready');
  }

  _handle(m) {
    if (m.t === 'pause') { this.engine.paused = this.PREVIEW ? false : m.v; return; }
    if (m.t === 'settings') { this.applySettings(m.v || {}); return; }
    if (m.t === 'reset') { this.applySettings(Object.assign({}, this.DEFAULTS, m.v || {})); return; }
    if (m.t !== 'icons') return;
    const k = window.devicePixelRatio || 1;       // 物理像素 → CSS 像素
    this.engine.icons = m.vis ? m.r.map(([l, t, r, b]) => ({ x: l / k, y: t / k, w: (r - l) / k, h: (b - t) / k })) : [];
    if (this.PREVIEW) this.drawGhosts();
    this.iconsSeen = true;
    this.engine.commit(this._firstIcons);         // 第一次：云慢慢长出来；之后：云跟着图标平滑移动
    this._firstIcons = false;
  }
}
