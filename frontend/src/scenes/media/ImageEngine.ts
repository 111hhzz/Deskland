// 图片主题引擎：<img> 铺满背景层（object-fit 由「填充方式」参数控制）+ 可选暗色遮罩。
// 交互 / 外壳（面板、图标、任务栏）全部复用 DeskApp，媒体只是背景材质。
import { MediaEngine } from './MediaEngine.js';
import type { EngineOpts, EngineParams } from '../../engine/BaseEngine.js';
import { assertParamCoverage, paramDisplays, paramSliders, runtimeDefaults } from '../../engine/paramSchema.js';
import { FIT_OPTIONS } from './schema.js';

export class ImageEngine extends MediaEngine {
  private img: HTMLImageElement | null = null;

  constructor(canvas: HTMLCanvasElement, opts: EngineOpts = {}) {
    super(canvas, opts);
    const id = this.requireThemeId();
    this.sliders = paramSliders(id, {
      fit: { fmt: (v) => FIT_OPTIONS[Math.round(v)] ?? String(v), act: 'apply' },
      veil: { fmt: (v) => Math.round(v * 100) + '%', act: 'apply' },
    });
    this.displayKeys = paramDisplays(id, []);
    assertParamCoverage(id, this.sliders, this.displayKeys);
  }

  override defaultParams(): EngineParams {
    return { ...runtimeDefaults(this.requireThemeId()), quality: 2, debug: false, snap: true, cap30: true };
  }

  protected override buildMedia(): void {
    const img = document.createElement('img');
    img.alt = '';
    img.draggable = false;
    img.src = this.src;
    this.layer.insertBefore(img, this.veilEl);
    this.img = img;
  }

  protected override applyFit(fit: (typeof FIT_OPTIONS)[number]): void {
    if (this.img) this.img.style.objectFit = fit;
  }

  override dispose(): void {
    this.img = null;
    super.dispose();
  }
}
