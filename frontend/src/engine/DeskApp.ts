// Deskland 应用外壳：面板、任务栏、时钟、生命周期与设置应用。
// 构造器接收一个引擎实例（渲染侧的状态与能力），本类只负责应用层编排：
//   图标布局/拖拽 → IconLayer；宿主消息协议（ADR 0002）→ hostBridge。
//
// P4：legacy 模块（boy/cat/palms）已 TS 化并经 LegacyHost 显式注入，window 上不再挂共享状态。

import type { EngineParams, EngineParamValue } from './BaseEngine.js';
import { numParam } from './SceneEngine.js';
import type { IconItem } from './SceneEngine.js';
import type { LegacyHost } from './LegacyHost.js';
import { IconLayer, TASKBAR } from './IconLayer.js';
import { connectHost, type HostHandle } from './hostBridge.js';
import type { DeskEngine } from './DeskEngine.js';

export type { DeskEngine } from './DeskEngine.js';

// 取静态控件：这些元素由 WallShell（React）渲染，缺失即页面结构出错
function el(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error('缺少元素 #' + id);
  return node;
}

// 面板配置（滑块 / 分段开关）由各主题引擎自己声明，DeskApp 只负责渲染与绑定：
//   engine.sliders     [{ ...ParamMeta, fmt?, act? }]（数据面来自 PARAM_DEFS，见 paramSchema.ts）
//   engine.displayKeys [ParamMeta]（范围同样来自 PARAM_DEFS）
// 新主题只加配置，不改这里。

export class DeskApp {
  engine: DeskEngine;
  themeId: string;
  desktop: HTMLElement;
  layer: IconLayer;
  statsEl: HTMLElement;
  DEFAULTS: EngineParams;
  WALL: boolean;
  PREVIEW: boolean;
  iconsSeen: boolean;
  // 销毁时要用到的句柄：DOM 监听、定时器、引擎事件、宿主消息桥
  _bound: Array<[EventTarget, string, EventListener]>;
  _clockT: number;
  _engineResize: (() => void) | null;
  _engineStats: (() => void) | null;
  _host: HostHandle | null;

  constructor(engine: DeskEngine, themeId = '') {
    this.engine = engine;
    this.themeId = themeId; // 所属主题 id：回执与销毁时辨认实例
    this.desktop = el('desktop');
    this.layer = new IconLayer(engine, this.desktop);
    this.statsEl = el('stats');
    this.DEFAULTS = Object.assign({}, engine.params);
    this._bound = [];
    this._clockT = 0;
    this._engineResize = this._engineStats = null;
    this._host = null;
    const QS = new URLSearchParams(location.search);
    this.WALL = QS.has('wallpaper');
    this.PREVIEW = QS.has('preview');
    this.iconsSeen = !(this.WALL || this.PREVIEW); // 浏览器模式一开始就有演示图标
  }

  // 共享状态的便捷访问
  get icons(): IconItem[] {
    return this.engine.icons;
  }
  get P(): EngineParams {
    return this.engine.params;
  }

  start(): void {
    this.buildSliders();
    this.bindEvents();
    if (this.WALL || this.PREVIEW) {
      this._host = connectHost({
        engine: this.engine,
        themeId: this.themeId,
        preview: this.PREVIEW,
        defaults: this.DEFAULTS,
        applySettings: (v) => this.applySettings(v),
        isIconsSeen: () => this.iconsSeen,
        markIconsSeen: () => {
          this.iconsSeen = true;
        },
      });
      this._host.announce();
    }
    this._engineResize = () => this.onResize();
    this._engineStats = () => this.updateStats();
    this.engine.on('resize', this._engineResize);
    this.engine.on('stats', this._engineStats);
    this.tickClock();
    this._clockT = window.setInterval(() => this.tickClock(), 15000);
    if (!this.WALL && !this.PREVIEW) {
      this.layer.layout('mine');
      this.syncPanel();
    }
  }

  // P4：legacy TS 模块（boy/cat/palms）的显式依赖入口；第 3 步已删除 mountToWindow 全局桥接
  legacyHost(themeBase: string): LegacyHost {
    const e = this.engine;
    // 预先绑定一次，避免每帧新建函数
    const sampleArr = e.sampleArr.bind(e);
    const curS = e.curS.bind(e);
    const mulberry32 = this.layer.mulberry32.bind(this.layer);
    return {
      get gl() {
        return e.gl as WebGL2RenderingContext;
      },
      get cv() {
        return e.cv;
      },
      get program() {
        return e.program;
      },
      get W() {
        return e.W;
      },
      get H() {
        return e.H;
      },
      get TASKBAR() {
        return TASKBAR;
      },
      get icons() {
        return e.icons;
      },
      get seed() {
        return e.seed;
      },
      get P() {
        return e.params;
      },
      get FB() {
        return e.FB;
      },
      sampleArr,
      curS,
      mulberry32,
      get themeBase() {
        return themeBase;
      },
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
    document.querySelectorAll<HTMLElement>('.seg').forEach((seg) =>
      on<MouseEvent>(seg, 'click', (e) => {
        const b = e.target instanceof Element ? e.target.closest('button') : null;
        if (!b) return;
        if (b.dataset.v !== undefined) {
          this.layer.layout(b.dataset.v);
          this.syncPanel();
        } else if (b.dataset.scheme !== undefined) {
          this.P.scheme = +b.dataset.scheme;
          this.syncPanel();
        }
      }),
    );
    document.querySelectorAll<HTMLInputElement>('.toggles input').forEach((inp) =>
      on(inp, 'change', () => {
        const key = inp.dataset.key;
        if (key !== undefined) this.P[key] = inp.checked;
      }),
    );
    on<MouseEvent>(el('collapse'), 'click', () => {
      const p = el('panel');
      p.classList.toggle('collapsed');
      el('collapse').textContent = p.classList.contains('collapsed') ? '+' : '–';
    });
    on<MouseEvent>(el('btnSeed'), 'click', () => this.reseed((Math.random() * 1e6) | 0));
    on<MouseEvent>(el('btnAdd'), 'click', () => this.layer.addFile());
    on<PointerEvent>(this.desktop, 'pointerdown', (e) => {
      this.layer.pointerDown(e.clientX, e.clientY);
    });
    on<KeyboardEvent>(window, 'keydown', (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.layer.selected) {
        this.layer.removeSelected();
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
      out.textContent = s.fmt ? s.fmt(val) : String(val);
      inp.addEventListener('input', () => {
        this.P[s.key] = +inp.value;
        out.textContent = s.fmt ? s.fmt(numParam(this.P, s.key)) : String(numParam(this.P, s.key));
        if (s.act === 'field') this.engine.refresh();
        else if (s.act === 'size') {
          this.engine.resize();
          this.engine.refresh();
        } else if (s.act && this.engine.onSliderAction) this.engine.onSliderAction(s.act);
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
    document
      .querySelectorAll<HTMLButtonElement>('.seg button')
      .forEach((b) => b.classList.toggle('on', b.dataset.v === this.layer.layoutKind));
    const scheme = numParam(this.P, 'scheme') | 0;
    document
      .querySelectorAll<HTMLButtonElement>('.seg button[data-scheme]')
      .forEach((b) => b.classList.toggle('on', +(b.dataset.scheme ?? '') === scheme));
    document.querySelectorAll<HTMLInputElement>('.toggles input').forEach((inp) => {
      const key = inp.dataset.key;
      if (key !== undefined) inp.checked = !!this.P[key];
    });
  }

  tickClock(): void {
    const d = new Date(),
      z = (n: number) => String(n).padStart(2, '0');
    el('clock').innerHTML =
      `${z(d.getHours())}:${z(d.getMinutes())}<br>${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  }

  onResize(): void {
    if (this.WALL || this.PREVIEW) return;
    // 容量不足触发整盘重排时补一次面板高亮（分段按钮要跟随 layoutKind）
    if (this.layer.reflow()) this.syncPanel();
  }

  /* ---------------- 设置 / 换云 ---------------- */

  // 调试 / 测试探针契约（__dbg.applyLayout，见 themes/*/*.html）：转发到图标层
  layoutIcons(kind: string): void {
    this.layer.layout(kind);
  }

  // 换一张：新的种子（设置窗口的"刷新"、面板上的"换一张"）。已经知道图标在哪了就从头再来一遍开场；
  // 壁纸 / 预览刚打开、还不知道图标在哪的时候只记下种子（等图标来了再按它画）
  reseed(v: number): void {
    this.engine.setSeed(v);
    if (!this.iconsSeen) return;
    this.engine.commit(true);
    this.engine.onSceneChanged?.('reseed');
  }

  // 应用设置：规则表由引擎声明合成（见 SceneEngine.paramRules），这里只查表执行：
  // 未声明键跳过；类型不符 / 值相同跳过；display 键越界丢弃；slider 键夹紧。
  applySettings(v: Record<string, EngineParamValue>): void {
    if (typeof v.seed === 'number' && v.seed !== this.engine.seed) this.reseed(v.seed);
    const rules = this.engine.paramRules;
    let field = false,
      adaptiveChanged = false;
    const actions: string[] = [];
    for (const k in v) {
      let val = v[k];
      if (val === undefined) continue;
      const rule = rules[k];
      if (!rule) continue; // 引擎未声明的参数不接受（与旧行为一致）
      const cur = this.P[k];
      if (typeof val !== typeof cur || cur === val) continue;
      // 数值比较前先把类型收窄到 number：slider / displayKeys 声明的是数值键；但 displayKeys
      // 也允许布尔（如 orb autoCycle），非数值按旧语义直接写入，不参与范围判断。
      if (typeof val === 'number') {
        if (rule.mode === 'drop') {
          if (val < rule.min || val > rule.max) continue; // display 键：超出主题声明范围的值不接受
        } else {
          val = Math.min(rule.max, Math.max(rule.min, val)); // slider 键：夹紧到声明范围
        }
      }
      this.P[k] = val;
      if (k === 'adaptive') adaptiveChanged = true;
      else if (rule.action === 'field') field = true;
      else if (rule.action) actions.push(rule.action);
    }
    if (!this.engine.hasField()) return;
    if (adaptiveChanged) this.engine.commit();
    else if (field) this.engine.refresh();
    for (const a of actions) this.engine.onSliderAction?.(a);
  }

  // __dbg.injectPointer 转发（global.d.ts 契约）：物理像素 → CSS 合成事件
  injectPointer(x: number, y: number, p: 'move' | 'down' | 'up'): void {
    this._host?.injectPointer(x, y, p);
  }

  // 热切换前收干净：定时器、DOM / 宿主监听、引擎事件、图标 DOM 都要卸下，
  // 否则旧实例还会响应点击与消息（静态控件还会被重复绑定）
  destroy(): void {
    for (const [node, type, fn] of this._bound || []) {
      try {
        node.removeEventListener(type, fn);
      } catch {
        /* 元素已随布局重建消失：忽略 */
      }
    }
    this._bound = [];
    clearInterval(this._clockT);
    this._clockT = 0;
    if (this._host) {
      this._host.destroy();
      this._host = null;
    }
    if (this.engine) {
      if (this._engineResize) this.engine.off('resize', this._engineResize);
      if (this._engineStats) this.engine.off('stats', this._engineStats);
      this._engineResize = this._engineStats = null;
    }
    this.layer.clearDom();
  }
}
