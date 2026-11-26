// 桌面图标层：网格布局 / 拖拽 / 选中 / 涟漪 / 「+ 新建文件」。
// 所有 DOM 图标状态集中在这一层，DeskApp 只做应用编排（面板、宿主消息、生命周期）。
import type { IconItem } from './SceneEngine.js';
import type { DeskEngine } from './DeskEngine.js';
import { EXTRA, FILES, glyphOf, mineCells, type IconCell } from './mockIcons.js';

const CELL_W = 76,
  CELL_H = 100,
  GRID_X0 = 4,
  GRID_Y0 = 6;
// 任务栏高度（px）：布局下边界，也经 LegacyHost 提供给 legacy 模块
export const TASKBAR = 48;

interface DragState {
  ic: IconItem;
  sx: number;
  sy: number;
  ox: number;
  oy: number;
  moved: boolean;
}
interface Point {
  x: number;
  y: number;
}

export class IconLayer {
  engine: DeskEngine;
  desktop: HTMLElement;
  grid: { cols: number; rows: number };
  DW: number;
  DH: number;
  selected: IconItem | null = null;
  extraIdx = 0;
  layoutCapacity = 0;
  layoutKind = 'mine';
  ripples: Array<{ x: number; y: number; t0: number; str: number }> = [];

  constructor(engine: DeskEngine, desktop: HTMLElement) {
    this.engine = engine;
    this.desktop = desktop;
    this.grid = { cols: 1, rows: 1 };
    this.DW = innerWidth;
    this.DH = innerHeight - TASKBAR;
    this.computeGrid();
  }

  get icons(): IconItem[] {
    return this.engine.icons;
  }

  /* ---------------- 网格与碰撞 ---------------- */

  computeGrid(): void {
    this.DW = innerWidth;
    this.DH = innerHeight - TASKBAR;
    this.grid.cols = Math.max(1, Math.floor((this.DW - GRID_X0) / CELL_W));
    this.grid.rows = Math.max(1, Math.floor((this.DH - GRID_Y0) / CELL_H));
  }
  cellPos(c: number, r: number): Point {
    return { x: GRID_X0 + c * CELL_W, y: GRID_Y0 + r * CELL_H };
  }
  occupied(x: number, y: number, self: IconItem | null): boolean {
    return this.icons.some((ic) => ic !== self && Math.abs(ic.x - x) < CELL_W / 2 && Math.abs(ic.y - y) < CELL_H / 2);
  }
  nearestFreeCell(cx: number, cy: number, self: IconItem | null): Point | null {
    let best: Point | null = null,
      bd = Infinity;
    for (let c = 0; c < this.grid.cols; c++)
      for (let r = 0; r < this.grid.rows; r++) {
        const pos = this.cellPos(c, r);
        if (this.occupied(pos.x, pos.y, self)) continue;
        const dd = Math.hypot(pos.x + CELL_W / 2 - cx, pos.y + CELL_H / 2 - cy);
        if (dd < bd) {
          bd = dd;
          best = pos;
        }
      }
    return best;
  }

  /* ---------------- 涟漪 ---------------- */

  addRipple(x: number, y: number, str = 1): void {
    this.engine.addRipple?.(x, y, str); // 主题自己的着色器涟漪（海滩）
    this.ripples.push({ x, y, t0: performance.now(), str });
    if (this.ripples.length > 6) this.ripples.shift();
  }

  /* ---------------- 图标 DOM ---------------- */

  addIcon([name, type]: [string, string], pos: Point, born = false): IconItem {
    const node = document.createElement('div');
    node.className = 'icon' + (born ? ' born' : '');
    node.innerHTML = `<div class="glyph"><svg viewBox="0 0 48 48">${glyphOf(name, type)}</svg></div><div class="label">${name}</div>`;
    node.style.left = pos.x + 'px';
    node.style.top = pos.y + 'px';
    this.desktop.appendChild(node);
    const ic: IconItem = { name, type, x: pos.x, y: pos.y, w: node.offsetWidth, h: node.offsetHeight, el: node };
    this.engine.icons.push(ic);
    this.bindDrag(ic);
    return ic;
  }
  setPos(ic: IconItem, x: number, y: number): void {
    ic.x = x;
    ic.y = y;
    if (ic.el) {
      ic.el.style.left = x + 'px';
      ic.el.style.top = y + 'px';
    }
  }
  select(ic: IconItem | null): void {
    if (this.selected && this.selected.el) this.selected.el.classList.remove('sel');
    this.selected = ic;
    if (ic && ic.el) ic.el.classList.add('sel');
  }
  removeSelected(): void {
    const ic = this.selected;
    if (!ic) return;
    this.select(null);
    if (ic.el) ic.el.remove();
    this.engine.icons = this.icons.filter((x) => x !== ic);
    this.engine.commit();
  }
  clearDom(): void {
    // 壁纸模式下 icons 是宿主发来的纯矩形（没有 el），只有浏览器模式才有 DOM 图标
    this.icons.forEach((ic) => {
      if (ic.el) ic.el.remove();
    });
    this.engine.icons = [];
  }

  // 桌面空白处按下：取消选中；落在水面上则留一圈涟漪
  pointerDown(x: number, y: number): void {
    this.select(null);
    if (this.engine.isWater(x, y)) this.addRipple(x, y);
  }

  bindDrag(ic: IconItem): void {
    const node = ic.el;
    if (!node) return;
    let drag: DragState | null = null;
    node.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      this.select(ic);
      node.setPointerCapture(e.pointerId);
      node.classList.remove('settle');
      drag = { ic, sx: e.clientX, sy: e.clientY, ox: ic.x, oy: ic.y, moved: false };
    });
    node.addEventListener('pointermove', (e) => {
      if (!drag || drag.ic !== ic) return;
      const dx = e.clientX - drag.sx,
        dy = e.clientY - drag.sy;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      node.classList.add('drag');
      node.style.left = drag.ox + dx + 'px';
      node.style.top = drag.oy + dy + 'px';
    });
    const end = (e: PointerEvent, cancel: boolean): void => {
      if (!drag || drag.ic !== ic) return;
      const d = drag;
      drag = null;
      node.classList.remove('drag');
      if (!d.moved) return; // 纯点击抬起（<4px）：不算拖拽，不吸附、不留涟漪
      let nx = cancel ? d.ox : d.ox + (e.clientX - d.sx),
        ny = cancel ? d.oy : d.oy + (e.clientY - d.sy);
      nx = Math.min(Math.max(nx, 0), this.DW - ic.w);
      ny = Math.min(Math.max(ny, 0), this.DH - ic.h);
      if (this.engine.params.snap && !cancel) {
        const c = this.nearestFreeCell(nx + ic.w / 2, ny + ic.h / 2, ic);
        if (c) {
          nx = c.x;
          ny = c.y;
        }
      }
      if (Math.hypot(nx - d.ox, ny - d.oy) < 0.5) {
        this.setPos(ic, nx, ny);
        return;
      }
      const cx = nx + ic.w / 2,
        cy = ny + ic.h / 2;
      if (this.engine.isWater(cx, cy)) this.addRipple(cx, cy, 1.3);
      node.classList.add('settle');
      this.setPos(ic, nx, ny);
      this.engine.commit();
    };
    node.addEventListener('pointerup', (e) => end(e, false));
    node.addEventListener('pointercancel', (e) => end(e, true));
  }

  mulberry32(a: number): () => number {
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------------- 布局 ---------------- */

  layout(kind: string): void {
    this.layoutKind = kind;
    this.icons.forEach((ic) => {
      if (ic.el) ic.el.remove();
    });
    this.engine.icons = [];
    this.select(null);
    this.extraIdx = 0;
    this.computeGrid();
    this.layoutCapacity = this.grid.cols * this.grid.rows;
    if (kind === 'mine') {
      for (const [c, r, name, type] of mineCells()) {
        const pos = this.cellPos(
          Math.round((c * (this.grid.cols - 1)) / 21),
          Math.round((r * (this.grid.rows - 1)) / 9),
        );
        if (!this.occupied(pos.x, pos.y, null)) this.addIcon([name, type], pos);
      }
    } else if (kind === 'arranged') {
      FILES.forEach((f, i) => {
        const c = Math.floor(i / this.grid.rows),
          r = i % this.grid.rows;
        if (c < this.grid.cols) this.addIcon(f, this.cellPos(c, r));
      });
    } else if (kind === 'messy') {
      const rnd = this.mulberry32(20260928);
      for (const f of FILES)
        for (let t = 0; t < 300; t++) {
          const c = rnd() < 0.45 ? Math.floor(rnd() * Math.min(3, this.grid.cols)) : Math.floor(rnd() * this.grid.cols);
          const pos = this.cellPos(c, Math.floor(rnd() * this.grid.rows));
          if (!this.occupied(pos.x, pos.y, null)) {
            this.addIcon(f, pos);
            break;
          }
        }
    } else {
      // 其余布局：左两列 + 中间一簇（列数随屏幕宽度变化）
      const cells: IconCell[] = [];
      for (let r = 0; r < 10; r++) cells.push([0, r], [1, r]);
      cells.push(
        [2, 0],
        [2, 1],
        [2, 2],
        [3, 0],
        [3, 1],
        [3, 2],
        [Math.floor(this.grid.cols * 0.45), Math.floor(this.grid.rows * 0.5)],
      );
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
    if (this.engine.isWater(pos.x + ic.w / 2, pos.y + ic.h / 2))
      this.addRipple(pos.x + ic.w / 2, pos.y + ic.h / 2, 1.3);
    this.engine.commit();
  }

  // 窗口尺寸变化：容量不够就整盘重排，否则只把图标夹回可视区。返回是否发生了重排（调用方补 syncPanel）
  reflow(): boolean {
    this.computeGrid();
    if (this.grid.cols * this.grid.rows > this.layoutCapacity && this.layoutCapacity < 40) {
      this.layout(this.layoutKind);
      return true;
    }
    for (const ic of this.icons)
      this.setPos(ic, Math.min(ic.x, Math.max(0, this.DW - ic.w)), Math.min(ic.y, Math.max(0, this.DH - ic.h)));
    this.engine.refresh();
    return false;
  }
}
