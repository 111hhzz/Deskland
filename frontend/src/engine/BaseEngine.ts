// Deskland 引擎基类：所有主题引擎的公共骨架。
// 职责：Canvas / WebGL2 上下文、requestAnimationFrame 主循环、resize、事件订阅（on/off/emit）、
//       --scene-* Token 读取、destroy 清理。
// 渲染相关的具体逻辑由子类实现：buildShaders / buildResources / update / render / dispose。
//
// 说明：这是骨架文件，迁移逻辑时子类覆盖对应钩子即可，不要把主题特例写进基类。

// 构造选项：wallpaper / preview 决定画布缩放与布局（SceneEngine 读取）
export interface EngineOpts {
  wallpaper?: boolean;
  preview?: boolean;
}

// 每 10 帧发给应用外壳的统计
export interface EngineStats {
  fps: number;
  frame: number;
}

// 事件回调：emit 的数据形状因事件而异（stats 对象 / 无数据），统一按 unknown 处理
type EngineListener = (data: unknown) => void;

export class BaseEngine {
  canvas: HTMLCanvasElement;
  opts: EngineOpts;
  gl: WebGL2RenderingContext | null;
  params: Record<string, number>;
  paused: boolean;

  _raf: number;
  _running: boolean;
  _lastT: number;        // 上一帧的 rAF 时间戳（0 表示还没有上一帧）
  _t0: number;           // init 时的 performance.now()：场景时间原点（对应迁移前的 T0）
  _fpsEMA: number;
  _frameN: number;
  _frameMs: number;
  _listeners: Map<string, Set<EngineListener>>;
  _resizeT: number;

  constructor(canvas: HTMLCanvasElement, opts: EngineOpts = {}) {
    this.canvas = canvas;
    this.opts = opts;
    this.gl = null;
    this.params = Object.assign({}, this.defaultParams());
    this.paused = false;

    this._raf = 0;
    this._running = false;
    this._lastT = 0;
    this._t0 = 0;
    this._fpsEMA = 0;
    this._frameN = 0;
    this._frameMs = 0;
    this._listeners = new Map();
    this._resizeT = 0;
  }

  defaultParams(): Record<string, number> { return {}; }

  async init(): Promise<boolean> {
    this._t0 = performance.now();
    this.gl = this.canvas.getContext('webgl2', { antialias: false });
    if (!this.gl) {
      const el = document.getElementById('nogl');
      if (el) el.style.display = 'grid';
      return false;
    }
    this.buildShaders();
    this.buildResources();
    this.resize();
    this._installResize();
    return true;
  }

  // 子类实现：画布尺寸 / 资源重建
  resize(): void {}

  start(): void {
    if (this._running) return;
    this._running = true;
    this._lastT = 0;
    this._raf = requestAnimationFrame(this._loop);
  }

  stop(): void {
    this._running = false;
    cancelAnimationFrame(this._raf);
  }

  // 暂停后恢复主循环（暂停时 _loop 已停止注册下一帧）
  resume(): void {
    if (this._running && !this.paused && !this._raf) this._raf = requestAnimationFrame(this._loop);
  }

  destroy(): void {
    this.stop();
    this._removeResize();
    clearTimeout(this._resizeT);
    this.dispose();
    this.emit('destroy');
  }

  // 主循环：pause / cap30 / dt / fps 统计都在基类；子类只做 update + render
  _loop = (now: number): void => {
    if (!this._running) return;
    if (this.paused) { this._lastT = 0; this._raf = 0; return; }   // 暂停：彻底停掉主循环，不再空转
    this._raf = requestAnimationFrame(this._loop);
    if (this.params.cap30 && now - this._lastT < 31) return;
    const dt = this._lastT ? Math.min((now - this._lastT) / 1000, 0.1) : 0.03;
    if (this._lastT) this._fpsEMA = this._fpsEMA ? this._fpsEMA * 0.9 + (1 / dt) * 0.1 : 1 / dt;
    this._lastT = now;
    this.update(dt, now);
    const t0 = performance.now();
    this.render(now);
    this._frameMs = performance.now() - t0;
    if (++this._frameN % 10 === 0) this.emit('stats', this.getStats());
  };

  // ---- 子类钩子 ----
  buildShaders(): void {}
  buildResources(): void {}
  update(_dt: number, _now: number): void {}
  render(_now: number): void {}
  dispose(): void {}

  // resize 事件之后的收尾（由 _onResize 调用；init 时的 resize 不经过这里，子类可按需覆盖）
  afterResize(): void {}

  // 每 10 帧发给应用外壳的统计（子类可覆盖以补充主题特有的字段）
  getStats(): EngineStats { return { fps: this._fpsEMA, frame: this._frameMs }; }

  // ---- resize ----
  _installResize(): void { window.addEventListener('resize', this._onResize); }
  _removeResize(): void { window.removeEventListener('resize', this._onResize); }
  _onResize = (): void => {
    clearTimeout(this._resizeT);
    this._resizeT = setTimeout(() => { this.resize(); this.afterResize(); this.emit('resize'); }, 100);
  };

  // ---- 事件 ----
  on(name: string, fn: EngineListener): this {
    let s = this._listeners.get(name);
    if (!s) { s = new Set(); this._listeners.set(name, s); }
    s.add(fn);
    return this;
  }
  off(name: string, fn: EngineListener): this {
    const s = this._listeners.get(name);
    if (s) s.delete(fn);
    return this;
  }
  emit(name: string, data?: unknown): void {
    const s = this._listeners.get(name);
    if (s) for (const fn of s) fn(data);
  }

  // ---- 场景 Token ----
  // 读取 theme.css 里的 --scene-*（值为空格分隔的 0-1 数值），返回数组；解析失败返回 null
  sceneToken(name: string): number[] | null {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (!raw) return null;
    const p = raw.split(/\s+/).map(Number);
    return p.length >= 2 && p.every(Number.isFinite) ? p : null;
  }

  // 场景时间（秒），语义同迁移前的 (now - T0) / 1000
  sceneTime(now: number): number { return (now - this._t0) / 1000; }
}
