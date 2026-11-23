// 人物 / 小猫场景引擎：在 CloudSceneEngine 之上加入 meadow 专用的人物（boy）与小猫（cat）绘制。
// 两个角色由各自的 legacy 模块（themes/meadow/legacy/boy.ts、cat.ts）经 LegacyHost 注入，
// 引擎侧只持有它们当帧的纹理与矩形，在每次绘制时绑定到着色器（uActor / uCat 系列）。
// 只有 meadow 同时需要云与人物；sky / aurora / beach 都不声明、也不绑定 uActor / uCat。

import { CloudSceneEngine } from './CloudSceneEngine.js';
import type { EngineOpts } from './BaseEngine.js';
import type { Program, Uniforms } from './SceneEngine.js';

export class ActorSceneEngine extends CloudSceneEngine {
  actorPR: Program | null; catPR: Program | null; catActorPR: Program | null;
  actorTex: WebGLTexture | null; actorShadowTex: WebGLTexture | null;
  actorRect: [number, number, number, number] | null;
  catTex: WebGLTexture | null;
  catRect: [number, number, number, number] | null;
  catShadow: [number, number] | null;
  catTail: number;

  constructor(canvas: HTMLCanvasElement, opts: EngineOpts = {}) {
    super(canvas, opts);
    this.actorPR = this.catPR = this.catActorPR = null;
    this.actorTex = this.actorShadowTex = null; this.actorRect = null;
    this.catTex = null; this.catRect = null; this.catShadow = null; this.catTail = 0;
  }

  /* ---- SceneEngine 的人物钩子 ---- */
  // 人物 / 小猫的纹理与矩形绑定（SceneEngine.render 的 draw 里调用；无人物主题为空操作）
  override bindActorUniforms(U: Uniforms, withCat: boolean): void {
    const gl = this.gl;
    if (!gl) return;
    if (this.actorTex && U.uActor) {
      // actorRect 与 actorTex 总是由 meadow 的 legacy boy 同源赋值（MeadowActor），故此处非空
      gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, this.actorTex); gl.uniform1i(U.uActor, 5);
      gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, this.actorShadowTex); gl.uniform1i(U.uActorShadow ?? null, 6);
      gl.uniform4f(U.uActorRect ?? null, ...this.actorRect!);
    }
    if (withCat && U.uCat) {
      // catRect / catShadow / catTail 同理：cat 模块 draw 成功时一并写入
      gl.activeTexture(gl.TEXTURE8); gl.bindTexture(gl.TEXTURE_2D, this.catTex); gl.uniform1i(U.uCat, 8);
      gl.uniform4f(U.uCatRect ?? null, ...this.catRect!); gl.uniform2f(U.uCatShadow ?? null, ...this.catShadow!);
      gl.uniform1f(U.uCatTail ?? null, this.catTail);
    }
  }

  // 纹理本体由 legacy 模块自己释放（boy.dispose / cat.dispose），引擎侧只置空引用
  override disposeActor(): void {
    this.actorPR = this.catPR = this.catActorPR = null;
    this.actorTex = this.actorShadowTex = null; this.actorRect = null;
    this.catTex = null; this.catRect = null; this.catShadow = null; this.catTail = 0;
  }
}
