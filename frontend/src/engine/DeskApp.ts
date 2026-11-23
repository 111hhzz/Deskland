// Deskland 应用外壳：桌面图标布局 / 拖拽、面板、任务栏、时钟、宿主消息协议。
// 构造器接收一个引擎实例（渲染侧的状态与能力），本类只负责应用层逻辑。
//
// 过渡期约定：把共享状态（W/H/P/icons/seed/TASKBAR）挂到 window，
// 让 meadow-boy.js / meadow-cat.js 等旧脚本继续以全局方式读取，行为保持 100% 一致。
// 待引擎迁移稳定后，再消除这层全局污染。

import type { EngineParams, EngineParamValue } from './BaseEngine.js';
import type { IconItem, SceneEngine } from './SceneEngine.js';
import { numParam } from './SceneEngine.js';
import type { LegacyHost } from './LegacyHost.js';

// DeskApp 需要的引擎能力：SceneEngine 的公共成员 + 各主题可选实现的扩展钩子
export interface DeskEngine extends SceneEngine {
  addRipple?(x: number, y: number, str?: number): void;   // 主题自己的着色器涟漪（海滩）
  onSliderAction?(act: string): void;
  onSceneChanged?(kind: string): void;
}

// 宿主消息协议（host → 页面）
type HostMessage =
  | { t: 'pause'; v: boolean }
  | { t: 'settings'; v?: Record<string, EngineParamValue> }
  | { t: 'reset'; v?: Record<string, EngineParamValue> }
  | { t: 'icons'; vis: boolean; r: Array<[number, number, number, number]> };

type Cell = [number, number];       // 网格坐标（列, 行）
interface DragState { ic: IconItem; sx: number; sy: number; ox: number; oy: number; moved: boolean; }
interface Point { x: number; y: number; }

const CELL_W = 76, CELL_H = 100, GRID_X0 = 4, GRID_Y0 = 6, TASKBAR = 48;
// 面板配置（滑块 / 分段开关）由各主题引擎自己声明，DeskApp 只负责渲染与绑定：
//   engine.sliders     [{ key, label, min, max, step, fmt, act }]
//   engine.displayKeys [{ key, min, max }]
// 新主题只加配置，不改这里。

// 取静态控件：这些元素由 WallShell（React）渲染，缺失即页面结构出错
function el(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error('缺少元素 #' + id);
  return node;
}

/* ======================================================================
   图标与布局数据
   ====================================================================== */
const PAGE = '<path d="M12 4h17l9 9v29a2 2 0 0 1-2 2H12a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="#fbfbfb" stroke="#c4c4c4"/><path d="M29 4v7a2 2 0 0 0 2 2h7z" fill="#dedede"/>';
const LINES = '<path d="M24 20h10M24 25h10M24 30h10M24 35h10" stroke="#c9c9c9" stroke-width="1.6"/>';
const badge = (color: string, text: string, size = 11): string =>
  `<rect x="4" y="21" width="19" height="19" rx="3" fill="${color}"/><text x="13.5" y="34.5" text-anchor="middle" font-family="Segoe UI,Arial" font-weight="700" font-size="${size}" fill="#fff">${text}</text>`;
const SVG: Record<string, string> = {
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
function appSVG(name: string): string {
  let h = 0; for (const ch of name) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return `<rect x="5" y="5" width="38" height="38" rx="9" fill="${APP_COLORS[h % APP_COLORS.length]}"/><path d="M5 14a9 9 0 0 1 9-9h20a9 9 0 0 1 9 9v6H5z" fill="#fff" opacity=".14"/>` +
    `<text x="24" y="31.5" text-anchor="middle" font-family="Segoe UI,Microsoft YaHei,Arial" font-weight="700" font-size="18" fill="#fff">${[...name][0]}</text>`;
}
const glyphOf = (name: string, type: string): string => type === 'app' ? appSVG(name) : (SVG[type] ?? '');

const FILES: Array<[string, string]> = [
  ['回收站','bin'], ['项目资料','folder'], ['2026 报价单.xlsx','xlsx'], ['产品需求.docx','docx'],
  ['截图_0927.png','png'], ['合同扫描件.pdf','pdf'], ['新建文件夹','folder'], ['设计素材','folder'],
  ['旅行照片','folder'], ['安装包.zip','zip'], ['会议纪要.docx','docx'], ['壁纸灵感','folder'],
  ['周报.xlsx','xlsx'], ['草图.png','png'], ['旧备份','folder'], ['微信图片.png','png'], ['说明书.pdf','pdf'], ['简历.docx','docx'], ['支出表.xlsx','xlsx'], ['压缩备份.zip','zip'], ['素材图.png','png'], ['下载','folder'], ['表情包.png','png'], ['工资条.xlsx','xlsx'], ['租房合同.pdf','pdf'], ['日记.docx','docx'], ['桌面截图.png','png'],
];
const EXTRA: Array<[string, string]> = [
  ['新建文本文档.txt','txt'], ['新建文件夹 (2)','folder'], ['发票.pdf','pdf'], ['数据导出.xlsx','xlsx'],
  ['截图_0928.png','png'], ['备忘.txt','txt'], ['归档.zip','zip'], ['新建文件夹 (3)','folder'],
];
const APPS = ['回收站','此电脑','微信','飞书','钉钉','腾讯会议','网易云音乐','剪映','Photoshop','Obsidian','VS Code','Krita',
  'AutoCAD','Rhino','KeyShot','百度网盘','Chrome','Blender','Figma','Notion','QQ','Steam','Eagle','OBS','Kimi','PureRef','EV录屏','NX 12.0','MarkText','Codex'];
const MISC: Array<[string, string]> = [['projects','folder'],['游戏','folder'],['todolist','folder'],['OKR管理.xlsx','xlsx'],['固定成本.xlsx','xlsx'],
  ['pdfarrange','app'],['stp.log','txt'],['零件.stp','txt'],['零件.3dm','png'],['预览','folder']];
const RIGHT: Array<[string, string]> = [['plot.log','txt'],['工具','folder'],['归档.rar','zip'],['1685x128.png','png'],['微信图片.jpg','png'],['0914.png','png'],
  ['微信图片 2.jpg','png'],['images.png','png'],['目录.docx','docx'],['api.txt','txt'],['c4ef.png','png'],['0918.png','png'],
  ['板调整.pdf','pdf'],['recommend.txt','txt'],['button.stp','txt'],['新建文本 (2).txt','txt'],['ugstep21','txt'],['新建文本 (3).txt','txt'],
  ['工作计划.txt','txt'],['微信图片 3.jpg','png'],['新建 DOCX.docx','docx'],['SEO.txt','txt'],['resend.txt','txt'],['产品介绍.txt','txt'],
  ['USER.pdf','pdf'],['新建文本.txt','txt'],['餐椅.pur','png'],['PAP-20.pdf','pdf'],['演示文稿.pptx','pdf'],['问题点.txt','txt']];
// 「我的桌面」布局：列 0-2 是常用应用，列 3 是杂项，列 5 是图纸，其余是截图与文件
const SHOT_CELLS: Cell[] = [[6,4],[6,5],[6,6],[6,7],[6,8],[7,3],[7,4],[7,5],[7,6],[7,7],[8,4],[8,5],[8,6],[9,2],[9,3],[9,4],[9,5],[9,6]];
const RIGHT_CELLS: Cell[] = [[11,1],[11,2],[11,3],[12,1],[12,2],[12,3],[12,4],[13,1],[13,2],[13,3],[13,4],[14,1],[14,3],[14,4],[15,1],[15,6],
  [16,4],[16,6],[17,4],[17,5],[17,6],[17,7],[19,4],[19,5],[19,8],[20,0],[20,4],[20,6],[21,0],[21,5],[21,6]];
function mineCells(): Array<[number, number, string, string]> {
  const out: Array<[number, number, string, string]> = [];
  let a = 0, m = 0, rgt = 0, sh = 0;
  for (let c = 0; c < 3; c++) for (let r = 0; r < 10; r++) {
    const name = APPS[a++] ?? '';
    out.push([c, r, name, name === '回收站' ? 'bin' : name === '此电脑' ? 'pc' : 'app']);
  }
  for (let r = 0; r < 10; r++) {
    const item = MISC[m++];
    if (!item) break;
    out.push([3, r, item[0], item[1]]);
  }
  for (let r = 0; r < 5; r++) out.push([5, r, `零件结构 ${r + 1}.dwg`, 'cad']);
  out.push([6, 0, '腿测试.bak', 'txt']);
  for (const [c, r] of SHOT_CELLS) out.push([c, r, `ScreenShot ${++sh}.png`, 'shot']);
  for (const [c, r] of RIGHT_CELLS) {
    const f = RIGHT[rgt++ % RIGHT.length];
    if (!f) continue;
    out.push([c, r, f[0], f[1]]);
  }
  return out;
}

/* ======================================================================
   DeskApp
   ====================================================================== */
export class DeskApp {
  engine: DeskEngine;
  themeId: string;
  desktop: HTMLElement;
  grid: { cols: number; rows: number };
  DW: number; DH: number;
  selected: IconItem | null;
  drag: DragState | null;
  extraIdx: number;
  layoutCapacity: number;
  layoutKind: string;
  iconsSeen: boolean;
  ripples: Array<{ x: number; y: number; t0: number; str: number }>;
  statsEl: HTMLElement;
  DEFAULTS: EngineParams;
  WALL: boolean;
  PREVIEW: boolean;
  _firstIcons: boolean;
  _resizeT: number;
  // 销毁时要用到的句柄：DOM 监听、定时器、引擎事件、宿主消息
  _bound: Array<[EventTarget, string, EventListener]>;
  _clockT: number;
  _engineResize: (() => void) | null;
  _engineStats: (() => void) | null;
  _hostMsg: ((e: { data: unknown }) => void) | null;
  _winMsg: ((e: MessageEvent) => void) | null;

  constructor(engine: DeskEngine, themeId = '') {
    this.engine = engine;
    this.themeId = themeId;                              // 所属主题 id：回执与销毁时辨认实例
    this.desktop = el('desktop');
    this.grid = { cols: 1, rows: 1 };
    this.DW = innerWidth; this.DH = innerHeight - TASKBAR;
    this.selected = null;
    this.drag = null;
    this.extraIdx = 0;
    this.layoutCapacity = 0;
    this.layoutKind = 'mine';
    this.iconsSeen = false;
    this.ripples = [];
    this.statsEl = el('stats');
    this.DEFAULTS = Object.assign({}, engine.params);
    this._firstIcons = true;
    this._resizeT = 0;
    this._bound = [];
    this._clockT = 0;
    this._engineResize = this._engineStats = null;
    this._hostMsg = this._winMsg = null;
    const QS = new URLSearchParams(location.search);
    this.WALL = QS.has('wallpaper');
    this.PREVIEW = QS.has('preview');
    this.iconsSeen = !(this.WALL || this.PREVIEW);   // 浏览器模式一开始就有演示图标
  }

  // 共享状态的便捷访问
  get icons(): IconItem[] { return this.engine.icons; }
  get P(): EngineParams { return this.engine.params; }

  start(): void {
    this.buildSliders();
    this.bindEvents();
    if (this.WALL || this.PREVIEW) this.setupHostMessages();
    this._engineResize = () => this.onResize();
    this._engineStats = () => this.updateStats();
    this.engine.on('resize', this._engineResize);
    this.engine.on('stats', this._engineStats);
    this.mountToWindow();
    this.tickClock();
    this._clockT = window.setInterval(() => this.tickClock(), 15000);
    if (!this.WALL && !this.PREVIEW) { this.layoutIcons('mine'); this.syncPanel(); }
  }

  // 过渡期：把共享状态挂到 window，供 boy/cat 等旧脚本以全局方式读取
  mountToWindow(): void {
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
    // 旧脚本还会直接读场数组 / 双线性采样 / 场的动态值 / 确定性随机（beach-palms.js）
    Object.defineProperty(window, 'FB', { get: () => this.engine.FB, configurable: true });
    window.sampleArr = this.engine.sampleArr.bind(this.engine);
    window.curS = this.engine.curS.bind(this.engine);
    window.mulberry32 = this.mulberry32.bind(this);
  }

  // P4：legacy TS 模块（boy/cat/palms）的显式依赖入口；第 3 步起取代 mountToWindow 的全局桥接
  legacyHost(themeBase: string): LegacyHost {
    const e = this.engine, self = this;
    // 预先绑定一次，避免每帧新建函数
    const sampleArr = e.sampleArr.bind(e);
    const curS = e.curS.bind(e);
    const mulberry32 = self.mulberry32.bind(self);
    return {
      get gl() { return e.gl as WebGL2RenderingContext; },
      get cv() { return e.cv; },
      get program() { return e.program; },
      get W() { return e.W; },
      get H() { return e.H; },
      get TASKBAR() { return TASKBAR; },
      get icons() { return e.icons; },
      get seed() { return e.seed; },
      get P() { return e.params; },
      get FB() { return e.FB; },
      sampleArr,
      curS,
      mulberry32,
      get themeBase() { return themeBase; },
    };
  }

  /* ---------------- 事件与面板 ---------------- */

  bindEvents(): void {
    // 静态控件在热切换时会重复绑定，所以统一记录、销毁时逐个卸下
    this._bound = [];
    const on = <E extends Event>(target: EventTarget, type: string, fn: (e: E) => void): void => {
      const listener = fn as EventListener;
      target.addEventListener(type, listener);
      this._bound.push([target, type, listener]);
    };
    // 所有分段按钮：data-v = 布局，data-scheme = 时段（天空主题）等主题特有的开关
    document.querySelectorAll<HTMLElement>('.seg').forEach(seg => on<MouseEvent>(seg, 'click', e => {
      const b = e.target instanceof Element ? e.target.closest('button') : null;
      if (!b) return;
      if (b.dataset.v !== undefined) { this.layoutIcons(b.dataset.v); this.syncPanel(); }
      else if (b.dataset.scheme !== undefined) { this.P.scheme = +b.dataset.scheme; this.syncPanel(); }
    }));
    document.querySelectorAll<HTMLInputElement>('.toggles input').forEach(inp => on(inp, 'change', () => {
      const key = inp.dataset.key;
      if (key !== undefined) this.P[key] = inp.checked;
    }));
    on<MouseEvent>(el('collapse'), 'click', () => {
      const p = el('panel');
      p.classList.toggle('collapsed');
      el('collapse').textContent = p.classList.contains('collapsed') ? '+' : '–';
    });
    on<MouseEvent>(el('btnSeed'), 'click', () => this.reseed((Math.random() * 1e6) | 0));
    on<MouseEvent>(el('btnAdd'), 'click', () => this.addFile());
    on<PointerEvent>(this.desktop, 'pointerdown', e => {
      this.select(null);
      if (this.engine.isWater(e.clientX, e.clientY)) this.addRipple(e.clientX, e.clientY);
    });
    on<KeyboardEvent>(window, 'keydown', e => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected) {
        const ic = this.selected; this.select(null); if (ic.el) ic.el.remove();
        this.engine.icons = this.icons.filter(x => x !== ic); this.engine.commit();
      } else if (e.key === 'h' || e.key === 'H') el('panel').classList.toggle('hidden');
    });
  }

  buildSliders(): void {
    const slidersEl = el('sliders');
    for (const s of this.engine.sliders) {
      const wrap = document.createElement('div');
      wrap.className = 'slider';
      const val = numParam(this.P, s.key);
      wrap.innerHTML = `<div class="row"><span>${s.label}</span><span></span></div><input type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${val}">`;
      const out = wrap.querySelector<HTMLSpanElement>('.row span:last-child');
      const inp = wrap.querySelector<HTMLInputElement>('input');
      if (!out || !inp) continue;
      out.textContent = s.fmt(val);
      inp.addEventListener('input', () => {
        this.P[s.key] = +inp.value; out.textContent = s.fmt(numParam(this.P, s.key));
        if (s.act === 'field') this.engine.refresh();
        else if (s.act === 'size') { this.engine.resize(); this.engine.refresh(); }
        else if (s.act && this.engine.onSliderAction) this.engine.onSliderAction(s.act);
      });
      slidersEl.appendChild(wrap);
    }
  }

  updateStats(): void {
    const s = this.engine.getStats();
    this.statsEl.innerHTML =
      `<span class="live">● 动画中 · ${s.fps.toFixed(0)} fps</span><br>GPU ${s.gpu}<br>` +
      `CPU 提交 ${s.frame.toFixed(1)} ms · 陆地场 ${s.field.toFixed(0)} ms<br>` +
      `画布 ${s.width}×${s.height} · 图标 ${this.icons.length}`;
  }

  syncPanel(): void {
    document.querySelectorAll<HTMLButtonElement>('.seg button').forEach(b => b.classList.toggle('on', b.dataset.v === this.layoutKind));
    const scheme = numParam(this.P, 'scheme') | 0;
    document.querySelectorAll<HTMLButtonElement>('.seg button[data-scheme]').forEach(b => b.classList.toggle('on', +(b.dataset.scheme ?? '') === scheme));
    document.querySelectorAll<HTMLInputElement>('.toggles input').forEach(inp => {
      const key = inp.dataset.key;
      if (key !== undefined) inp.checked = !!this.P[key];
    });
  }

  tickClock(): void {
    const d = new Date(), z = (n: number) => String(n).padStart(2, '0');
    el('clock').innerHTML = `${z(d.getHours())}:${z(d.getMinutes())}<br>${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  }

  onResize(): void {
    if (this.WALL || this.PREVIEW) return;
    this.computeGrid();
    if (this.grid.cols * this.grid.rows > this.layoutCapacity && this.layoutCapacity < 40) {
      this.layoutIcons(this.layoutKind); this.syncPanel(); return;
    }
    for (const ic of this.icons) this.setPos(ic, Math.min(ic.x, Math.max(0, this.DW - ic.w)), Math.min(ic.y, Math.max(0, this.DH - ic.h)));
    this.engine.refresh();
  }

  /* ---------------- 图标布局 / 拖拽 ---------------- */

  computeGrid(): void {
    this.DW = innerWidth; this.DH = innerHeight - TASKBAR;
    this.grid.cols = Math.max(1, Math.floor((this.DW - GRID_X0) / CELL_W));
    this.grid.rows = Math.max(1, Math.floor((this.DH - GRID_Y0) / CELL_H));
  }
  cellPos(c: number, r: number): Point { return { x: GRID_X0 + c * CELL_W, y: GRID_Y0 + r * CELL_H }; }
  occupied(x: number, y: number, self: IconItem | null): boolean {
    return this.icons.some(ic => ic !== self && Math.abs(ic.x - x) < CELL_W / 2 && Math.abs(ic.y - y) < CELL_H / 2);
  }
  nearestFreeCell(cx: number, cy: number, self: IconItem | null): Point | null {
    let best: Point | null = null, bd = Infinity;
    for (let c = 0; c < this.grid.cols; c++) for (let r = 0; r < this.grid.rows; r++) {
      const pos = this.cellPos(c, r);
      if (this.occupied(pos.x, pos.y, self)) continue;
      const dd = Math.hypot(pos.x + CELL_W / 2 - cx, pos.y + CELL_H / 2 - cy);
      if (dd < bd) { bd = dd; best = pos; }
    }
    return best;
  }
  addRipple(x: number, y: number, str = 1): void {
    this.engine.addRipple?.(x, y, str);   // 主题自己的着色器涟漪（海滩）
    this.ripples.push({ x, y, t0: performance.now(), str });
    if (this.ripples.length > 6) this.ripples.shift();
  }
  addIcon([name, type]: [string, string], pos: Point, born = false): IconItem {
    const node = document.createElement('div');
    node.className = 'icon' + (born ? ' born' : '');
    node.innerHTML = `<div class="glyph"><svg viewBox="0 0 48 48">${glyphOf(name, type)}</svg></div><div class="label">${name}</div>`;
    node.style.left = pos.x + 'px'; node.style.top = pos.y + 'px';
    this.desktop.appendChild(node);
    const ic: IconItem = { name, type, x: pos.x, y: pos.y, w: node.offsetWidth, h: node.offsetHeight, el: node };
    this.engine.icons.push(ic); this.bindDrag(ic);
    return ic;
  }
  setPos(ic: IconItem, x: number, y: number): void {
    ic.x = x; ic.y = y;
    if (ic.el) { ic.el.style.left = x + 'px'; ic.el.style.top = y + 'px'; }
  }
  select(ic: IconItem | null): void {
    if (this.selected && this.selected.el) this.selected.el.classList.remove('sel');
    this.selected = ic;
    if (ic && ic.el) ic.el.classList.add('sel');
  }
  bindDrag(ic: IconItem): void {
    const node = ic.el;
    if (!node) return;
    node.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.stopPropagation(); this.select(ic);
      node.setPointerCapture(e.pointerId); node.classList.remove('settle');
      this.drag = { ic, sx: e.clientX, sy: e.clientY, ox: ic.x, oy: ic.y, moved: false };
    });
    node.addEventListener('pointermove', e => {
      const d = this.drag;
      if (!d || d.ic !== ic) return;
      const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
      if (!d.moved && Math.hypot(dx, dy) < 4) return;
      d.moved = true; node.classList.add('drag');
      node.style.left = d.ox + dx + 'px'; node.style.top = d.oy + dy + 'px';
    });
    const end = (e: PointerEvent, cancel: boolean): void => {
      const d = this.drag;
      if (!d || d.ic !== ic) return;
      this.drag = null;
      node.classList.remove('drag');
      if (!d.moved) return;
      let nx = cancel ? d.ox : d.ox + (e.clientX - d.sx), ny = cancel ? d.oy : d.oy + (e.clientY - d.sy);
      nx = Math.min(Math.max(nx, 0), this.DW - ic.w); ny = Math.min(Math.max(ny, 0), this.DH - ic.h);
      if (this.P.snap && !cancel) { const c = this.nearestFreeCell(nx + ic.w / 2, ny + ic.h / 2, ic); if (c) { nx = c.x; ny = c.y; } }
      if (Math.hypot(nx - d.ox, ny - d.oy) < 0.5) { this.setPos(ic, nx, ny); return; }
      const cx = nx + ic.w / 2, cy = ny + ic.h / 2;
      if (this.engine.isWater(cx, cy)) this.addRipple(cx, cy, 1.3);
      node.classList.add('settle'); this.setPos(ic, nx, ny);
      this.engine.commit();
    };
    node.addEventListener('pointerup', e => end(e, false));
    node.addEventListener('pointercancel', e => end(e, true));
  }
  mulberry32(a: number): () => number {
    return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  layoutIcons(kind: string): void {
    this.layoutKind = kind;
    this.icons.forEach(ic => { if (ic.el) ic.el.remove(); });
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
      // 其余布局：左两列 + 中间一簇（列数随屏幕宽度变化）
      const cells: Cell[] = [];
      for (let r = 0; r < 10; r++) cells.push([0, r], [1, r]);
      cells.push([2, 0], [2, 1], [2, 2], [3, 0], [3, 1], [3, 2], [Math.floor(this.grid.cols * 0.45), Math.floor(this.grid.rows * 0.5)]);
      cells.forEach(([c, r], i) => {
        const f = FILES[i];
        if (!f) return;
        this.addIcon(f, this.cellPos(Math.min(c, this.grid.cols - 1), Math.min(r, this.grid.rows - 1)));
      });
    }
    this.engine.commit(true);
    this.engine.onSceneChanged?.('layout');
  }
  addFile(): void {
    const f = EXTRA[this.extraIdx++ % EXTRA.length];
    if (!f) return;
    let pos: Point | null = null;
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
  reseed(v: number): void {
    this.engine.setSeed(v);
    if (!this.iconsSeen) return;
    this.engine.commit(true);
    this.engine.onSceneChanged?.('reseed');
  }

  // 应用设置：只接受引擎声明过的参数；云团大小要重算场
  applySettings(v: Record<string, EngineParamValue>): void {
    if (typeof v.seed === 'number' && v.seed !== this.engine.seed) this.reseed(v.seed);
    const sliders = this.engine.sliders, keys = this.engine.displayKeys;
    let field = false, adaptiveChanged = false;
    const actions: string[] = [];
    for (const k in v) {
      const val = v[k];
      if (val === undefined) continue;
      const cur = this.P[k];
      const slider = sliders.find(s => s.key === k);
      const key = keys.find(d => d.key === k);
      if (!slider && !key) continue;
      if (typeof val !== typeof cur || cur === val) continue;
      // 数值比较前先把类型收窄到 number：走到这里 val 与当前值同型（见上一行），
      // 而 displayKeys / sliders 声明的都是数值键，所以布尔值不会进入这两个分支。
      if (key && typeof val === 'number' && (val < key.min || val > key.max)) continue;   // 超出主题声明范围的值不接受
      this.P[k] = slider && typeof val === 'number' ? Math.min(slider.max, Math.max(slider.min, val)) : val;
      if (k === 'adaptive') adaptiveChanged = true;
      else if (slider && slider.act === 'field') field = true;
      else if (slider && slider.act) actions.push(slider.act);
    }
    if (!this.engine.hasField()) return;
    if (adaptiveChanged) this.engine.commit();
    else if (field) this.engine.refresh();
    for (const a of actions) this.engine.onSliderAction?.(a);
  }

  /* ---------------- 托管模式（宿主消息协议） ---------------- */

  drawGhosts(): void {
    const box = document.getElementById('ghosts');
    if (!box) return;
    box.innerHTML = this.icons.map(ic => `<div class="ghost" style="left:${ic.x}px;top:${ic.y}px;width:${ic.w}px;height:${ic.h}px"><i></i><b></b></div>`).join('');
  }

  setupHostMessages(): void {
    document.body.classList.add('wall');
    if (this.PREVIEW) {
      document.body.classList.add('preview');
      const g = document.createElement('div'); g.id = 'ghosts'; document.body.appendChild(g);
    }
    this.engine.icons = [];
    this.engine.commit(true);                     // 先是一片海（还不知道图标在哪）
    this.engine.onSceneChanged?.('hostInit');
    this._firstIcons = true;
    if (this.PREVIEW) {
      this._winMsg = ev => { if (ev.source === parent) this._handle(typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data); };
      window.addEventListener('message', this._winMsg);
      parent.postMessage(JSON.stringify({ t: 'ready', theme: this.themeId }), '*');
      return;
    }
    const host = window.chrome && window.chrome.webview;
    if (!host) return;
    this._hostMsg = ev => this._handle(JSON.parse(ev.data as string));
    host.addEventListener('message', this._hostMsg);
    host.postMessage(JSON.stringify({ t: 'ready', theme: this.themeId }));
  }

  _handle(m: HostMessage): void {
    if (m.t === 'pause') { this.engine.paused = this.PREVIEW ? false : m.v; if (!this.engine.paused) this.engine.resume(); return; }
    if (m.t === 'settings') { this.applySettings(m.v || {}); return; }
    if (m.t === 'reset') { this.applySettings(Object.assign({}, this.DEFAULTS, m.v || {})); return; }
    if (m.t !== 'icons') return;
    const k = window.devicePixelRatio || 1;       // 物理像素 → CSS 像素
    this.engine.icons = m.vis ? m.r.map(([l, t, r, b]) => ({ x: l / k, y: t / k, w: (r - l) / k, h: (b - t) / k })) : [];
    if (this.PREVIEW) this.drawGhosts();
    this.iconsSeen = true;
    window.__desklandIcons = true;   // 测试同步信号：宿主图标已到达（场已按图标重算）
    this.engine.commit(this._firstIcons);         // 第一次：陆地从海里"长"出来；之后：岸线平滑移动
    if (this._firstIcons) this.engine.onSceneChanged?.('firstIcons');
    this._firstIcons = false;
  }

  // 热切换前收干净：定时器、DOM / 宿主监听、引擎事件、图标 DOM 都要卸下，
  // 否则旧实例还会响应点击与消息（静态控件还会被重复绑定）
  destroy(): void {
    for (const [node, type, fn] of this._bound || []) {
      try { node.removeEventListener(type, fn); } catch (e) { /* 元素已随布局重建消失：忽略 */ }
    }
    this._bound = [];
    clearInterval(this._clockT); this._clockT = 0;
    if (this._hostMsg) {
      const host = window.chrome && window.chrome.webview;
      if (host) host.removeEventListener('message', this._hostMsg);
      this._hostMsg = null;
    }
    if (this._winMsg) { window.removeEventListener('message', this._winMsg); this._winMsg = null; }
    if (this.engine) {
      if (this._engineResize) this.engine.off('resize', this._engineResize);
      if (this._engineStats) this.engine.off('stats', this._engineStats);
      this._engineResize = this._engineStats = null;
    }
    // 壁纸模式下 icons 是宿主发来的纯矩形（没有 el），只有浏览器模式才有 DOM 图标
    if (this.icons.length) { this.icons.forEach(ic => { if (ic.el) ic.el.remove(); }); this.engine.icons = []; }
    const g = document.getElementById('ghosts'); if (g) g.remove();
  }
}
