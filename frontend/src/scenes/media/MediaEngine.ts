// 媒体引擎底座：图片 / 视频主题共用（背景层、参数应用、设置派发）。
//
// 与 SceneEngine 的边界同 orb：没有 GL 渲染——init 不建 WebGL2 上下文，resize / commit /
// refresh / render / update 全部空操作；hasField() 仍返回 true，让 DeskApp.applySettings 的
// 派发门槛放行（否则 onSliderAction 收不到参数变化）。差异是媒体引擎连 GL 上下文都不需要：
// 无 WebGL2 的机器上图片 / 视频壁纸依旧可用。
import { SceneEngine, numParam } from '../../engine/SceneEngine.js';
import type { EngineOpts } from '../../engine/BaseEngine.js';
import { FIT_OPTIONS } from './schema.js';

export abstract class MediaEngine extends SceneEngine {
  protected layer: HTMLDivElement;
  protected veilEl: HTMLDivElement;
  private _src = '';

  constructor(canvas: HTMLCanvasElement, opts: EngineOpts = {}) {
    super(canvas, opts);
    // 背景层：盖在 #art 之上（DOM 顺序 + 同为 fixed），外壳（任务栏 / 面板 / 图标）z-index 更高
    const layer = document.createElement('div');
    layer.className = 'media-layer';
    const veil = document.createElement('div');
    veil.className = 'media-veil';
    layer.appendChild(veil);
    document.body.appendChild(layer);
    this.layer = layer;
    this.veilEl = veil;
    this._src = opts.mediaSrc ?? '';
  }

  /** 媒体源地址（相对站点根）；子类在 init 中取用 */
  get src(): string {
    return this._src;
  }

  /** 主题 id（参数声明索引）：媒体主题的 theme.json.groups 已由页面启动时注册，缺 themeId 直接抛错 */
  protected requireThemeId(): string {
    const id = this.opts.themeId;
    if (!id) throw new Error('媒体引擎缺少 themeId（无法解析参数声明）');
    return id;
  }

  /* ---- 覆写：媒体主题不需要 GL 与场 ---- */

  override async init(): Promise<boolean> {
    this._t0 = performance.now();
    this.buildMedia();
    this.applyLayer();
    this._installResize();
    return true;
  }

  /** 子类实现：把媒体元素挂进背景层并加载 src */
  protected abstract buildMedia(): void;

  override resize(): void {}
  override afterResize(): void {}
  override commit(_fromEmpty?: boolean): void {}
  override refresh(): void {}
  override update(_dt: number, _now: number): void {}
  override render(_now: number): void {}

  // 暂停语义由 hostBridge 经 onPausedChange 通知（见 DeskEngine）；默认无操作
  override dispose(): void {
    this.layer.remove();
  }

  /* ---- 参数应用 ---- */

  /** 把当前 params 应用到层样式；onSliderAction 统一走这里 */
  applyLayer(): void {
    const fit = FIT_OPTIONS[Math.round(numParam(this.params, 'fit'))] ?? FIT_OPTIONS[0]!;
    this.applyFit(fit);
    this.veilEl.style.background = `rgba(5, 8, 16, ${numParam(this.params, 'veil').toFixed(3)})`;
  }

  /** 子类按 fit 设置媒体元素的 object-fit（选择器统一在 base.css） */
  protected abstract applyFit(fit: (typeof FIT_OPTIONS)[number]): void;

  // DeskApp.applySettings 的 action 派发（sliders 的 act: 'apply'）
  // 注意：onSliderAction 定义在 DeskEngine 接口（非基类成员），不能带 override
  onSliderAction(act: string): void {
    if (act === 'apply') this.applyLayer();
  }
}
