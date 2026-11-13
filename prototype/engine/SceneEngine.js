// 场景型主题的共享引擎：meadow 与 sky 约 89% 的逻辑相同，抽在这里。
// 具体片元着色器由子类通过 static FS 提供；场景状态（图标矩形 / 种子 / 参数）由应用外壳驱动。
//
// 约定：若未来某个主题差异极大，直接继承 BaseEngine，不要往 SceneEngine 里加特例分支。

import { BaseEngine } from './BaseEngine.js';

export class SceneEngine extends BaseEngine {
  static FS = '';   // 子类覆盖：片元着色器源码

  defaultParams() { return {}; }   // 迁移时填入各主题默认参数

  // ---- 渲染钩子（迁移时实现）----
  buildShaders() {}
  buildResources() {}
  update(dt, now) {}
  render(now) {}
  dispose() {}

  // ---- 场景状态接口（迁移时实现，由应用外壳调用）----
  setIconRects(rects) {}
  reseed(seed) {}
  applySettings(v) {}
  commit(fromEmpty = false) {}
}
