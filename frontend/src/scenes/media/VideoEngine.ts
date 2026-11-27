// 视频主题引擎：IVideoBackend（v1 = <video>）+ 静音 / 循环 / 倍速 / 填充 / 遮罩。
// 暂停跟随宿主（onPausedChange）；P2 换 NativePlayerBackend 时本类不动。
import { MediaEngine } from './MediaEngine.js';
import type { EngineOpts, EngineParams } from '../../engine/BaseEngine.js';
import { assertParamCoverage, paramDisplays, paramSliders, runtimeDefaults } from '../../engine/paramSchema.js';
import { FIT_OPTIONS } from './schema.js';
import { DomVideoBackend } from './backend.js';
import type { VideoBackend } from './backend.js';

export class VideoEngine extends MediaEngine {
  private backend: VideoBackend | null = null;

  constructor(canvas: HTMLCanvasElement, opts: EngineOpts = {}) {
    super(canvas, opts);
    const id = this.requireThemeId();
    this.sliders = paramSliders(id, {
      fit: { fmt: (v) => FIT_OPTIONS[Math.round(v)] ?? String(v), act: 'apply' },
      veil: { fmt: (v) => Math.round(v * 100) + '%', act: 'apply' },
      speed: { fmt: (v) => '×' + v.toFixed(2), act: 'apply' },
    });
    this.displayKeys = paramDisplays(id, ['muted', 'loop']);
    assertParamCoverage(id, this.sliders, this.displayKeys);
  }

  override defaultParams(): EngineParams {
    return { ...runtimeDefaults(this.requireThemeId()), quality: 2, debug: false, snap: true, cap30: true };
  }

  protected override buildMedia(): void {
    const b = new DomVideoBackend();
    this.backend = b;
    this.layer.insertBefore(b.el, this.veilEl);
    b.load(this.src);
    this.applyPlayback();
    b.play();
  }

  /** 静音 / 循环 / 倍速（bool 与数值参数从 params 直读，随设置下发即时生效） */
  private applyPlayback(): void {
    const b = this.backend;
    if (!b) return;
    b.setMuted(!!this.params.muted);
    b.setLoop(!!this.params.loop);
    b.setSpeed(Number(this.params.speed) || 1);
  }

  // speed 变化即时生效（fit/veil 走 applyLayer，见 MediaEngine.onSliderAction）
  override onSliderAction(act: string): void {
    if (act === 'apply') {
      this.applyLayer();
      this.applyPlayback();
    }
  }

  /** 宿主暂停消息（hostBridge）：暂停 / 恢复播放 */
  onPausedChange(paused: boolean): void {
    const b = this.backend;
    if (!b) return;
    if (paused) b.pause();
    else b.play();
  }

  protected override applyFit(fit: (typeof FIT_OPTIONS)[number]): void {
    const el = this.backend?.el;
    if (el) el.style.objectFit = fit;
  }

  override dispose(): void {
    this.backend?.dispose();
    this.backend = null;
    super.dispose();
  }
}
