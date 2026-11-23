// 页面装配：把各主题的 legacy 模块注入对应引擎（P4 迁移）。
// 必须在 engine.init() **之前**调用——引擎的 buildShaders() 要用 palms 的着色器源码，
// 实例则由引擎在 init() 末尾（gl 就绪后）用 def 里的工厂创建。
import type { DeskApp } from './DeskApp.js';
import type { SceneEngine } from './SceneEngine.js';
import { MeadowEngine } from '../scenes/MeadowEngine.js';
import { FlatEngine } from '../scenes/FlatEngine.js';
import { createMeadowBoyScene } from '../themes/meadow/legacy/boy.js';
import { createMeadowCatScene } from '../themes/meadow/legacy/cat.js';
import { BEACH_PALM_FS, BEACH_PALM_VS, createMaldivesPalmsScene } from '../themes/beach/legacy/palms.js';

export function installLegacyFor(id: string, app: DeskApp, engine: SceneEngine): void {
  const host = app.legacyHost('/themes/' + id + '/');
  if (id === 'meadow' && engine instanceof MeadowEngine) {
    engine.installLegacy(host, {
      createBoy: h => createMeadowBoyScene(h),
      createCat: h => createMeadowCatScene(h),
    });
  } else if (id === 'beach' && engine instanceof FlatEngine) {
    engine.installLegacy(host, {
      FS: BEACH_PALM_FS,
      VS: BEACH_PALM_VS,
      create: h => createMaldivesPalmsScene(h),
    });
  }
}
