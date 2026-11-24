// 草地上的小黑猫：贴图只上传一次，位置随种子更换，始终为男孩的整轮路线留空。
// 依赖（渲染上下文 / 尺寸 / 种子 / 图标 / 参数）由 LegacyHost 显式传入（P4 迁移）。
import type { LegacyHost } from '../../../engine/LegacyHost.js';
import type { IconItem } from '../../../engine/SceneEngine.js';
import { numParam } from '../../../engine/SceneEngine.js';
import { meadowBoyRunDestination } from './boy.js';
import type { MeadowActorState } from './boy.js';

interface Point {
  x: number;
  y: number;
}
type Lane = [Point, Point];

export interface MeadowCat {
  texture: WebGLTexture;
  rect: [number, number, number, number];
  shadow: [number, number];
  tail: number;
  bounds: [number, number, number, number];
  state: MeadowCatPlace;
}
export interface MeadowCatScene {
  // boy 只用到 state（路线），所以入参收窄成 { state } | null
  prepare(boy: { state: MeadowActorState } | null, now?: number): MeadowCat | null;
  // 引擎 destroy 时释放贴图纹理
  dispose(): void;
}
interface MeadowCatPlace {
  x: number;
  y: number;
  size: number;
  clearance: number;
  routeDistance: number;
  lanes: Lane[];
}

function meadowCatSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
}
function meadowCatRunLanes(
  state: MeadowActorState,
  width: number,
  height: number,
  taskbar: number,
): { lanes: Lane[]; scale: number } {
  const scale = Math.max(0.24, Math.min(1.25, width / 1379, (height - taskbar) / 1141)) * 0.35;
  const lanes: Lane[] = [];
  const add = (a: Point, b: Point): Point => {
    lanes.push([{ ...a }, { ...b }]);
    return b;
  };
  const finish = (from: Point): void => {
    for (let i = 0; i < 64; i++) {
      const to = meadowBoyRunDestination(from, scale, width, height, taskbar);
      add(from, to);
      from = to;
      if (to.exit) break;
    }
  };
  // 包含正在进行的那一段，以及之后一直跑出上边缘的各段。
  const current = state.routeTarget ? add(state.position, state.routeTarget) : state.position;
  finish(current);
  // 下方返回后每轮走同一条路线，预留整轮，而非只避开男孩当前的位置。
  const bottom = {
    x: Math.max(96 * scale + 12, Math.min(width * 0.7, width - 612 * scale - 12)),
    y: height + 116 * scale + 24,
  };
  const y = (height - taskbar) * 0.7;
  const entry = { x: Math.max(96 * scale + 12, bottom.x - (bottom.y - y) * 0.65), y };
  add(bottom, entry);
  finish(entry);
  return { lanes, scale };
}
function meadowCatChoosePlace(
  state: MeadowActorState,
  width: number,
  height: number,
  taskbar: number,
  sceneSeed: number,
  desktopIcons: IconItem[],
  cloudSize: number,
): MeadowCatPlace | null {
  const { lanes, scale } = meadowCatRunLanes(state, width, height, taskbar);
  const size = Math.max(28, Math.min(90, Math.min(width / 1379, (height - taskbar) / 1141) * 78)) * 0.578;
  const radius = size * 0.58,
    pad = radius + 12,
    clearance = radius + 96 * scale + 14;
  if (width <= pad * 2 || height - taskbar <= pad * 2) return null;
  let randomState = (sceneSeed | 0) ^ 0x71a43d25;
  const random = (): number => {
    randomState = (randomState + 0x6d2b79f5) | 0;
    let v = Math.imul(randomState ^ (randomState >>> 15), 1 | randomState);
    v ^= v + Math.imul(v ^ (v >>> 7), 61 | v);
    return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
  };
  let best: MeadowCatPlace | null = null,
    bestScore = Infinity;
  for (let i = 0; i < 337; i++) {
    const x = i < 256 ? random() : (((i - 256) % 9) + 0.5) / 9;
    const y = i < 256 ? random() : (Math.floor((i - 256) / 9) + 0.5) / 9;
    const p = { x: pad + x * (width - pad * 2), y: pad + y * (height - taskbar - pad * 2) };
    const routeDistance = Math.min(...lanes.map(([a, b]) => meadowCatSegmentDistance(p, a, b)));
    if (routeDistance < clearance) continue;
    let score = 0;
    for (const icon of desktopIcons) {
      const dx = Math.max(icon.x - p.x, 0, p.x - icon.x - icon.w);
      const dy = Math.max(icon.y - p.y, 0, p.y - icon.y - icon.h);
      score += Math.max(0, radius + cloudSize + 25 - Math.hypot(dx, dy));
    }
    if (score < bestScore) {
      best = { ...p, size, clearance, routeDistance, lanes };
      bestScore = score;
    }
    if (score === 0) break;
  }
  return best;
}
function meadowCatTailAngle(time: number, sceneSeed: number): number {
  const period = 10 + Math.abs(sceneSeed % 4),
    age = ((time + Math.abs(sceneSeed % 1300) / 1000) % period) - 3;
  if (age < 0 || age >= 1.6) return 0;
  const t = age / 1.6;
  // 大部分时间安静躺着，偶尔柔和地来回摆两下，起止都回到原姿势。
  return Math.sin(t * Math.PI * 4) * Math.pow(Math.sin(t * Math.PI), 2) * 0.34;
}
export function createMeadowCatScene(host: LegacyHost): MeadowCatScene {
  const gl = host.gl;
  const texture = gl.createTexture()!;
  let ready = false,
    disposed = false,
    layout = '',
    signature = '',
    routeState: MeadowActorState | null = null,
    place: MeadowCatPlace | null = null;
  let time = 0,
    previousTime: number | null = null;
  const image = new Image();
  image.onload = () => {
    if (disposed) return; // 引擎已销毁：不要再向已删除的纹理上传
    const sprite = document.createElement('canvas');
    sprite.width = sprite.height = 384;
    sprite.getContext('2d')!.drawImage(image, 0, 0, 384, 384);
    gl.activeTexture(gl.TEXTURE8);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sprite);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    ready = true;
  };
  image.onerror = () => console.warn('草地小猫素材加载失败');
  image.src = host.themeBase + 'images/meadow-black-kitten.png';
  return {
    dispose(): void {
      disposed = true;
      gl.deleteTexture(texture);
    },
    prepare(boy, now = 0): MeadowCat | null {
      if (previousTime !== null) time += Math.max(0, Math.min(0.05, (now - previousTime) / 1000));
      previousTime = now;
      const nextLayout = [host.W, host.H, host.TASKBAR].join(',');
      if (layout !== nextLayout) {
        layout = nextLayout;
        routeState = null;
        place = null;
        signature = '';
      }
      if (boy && boy.state.layout === layout) routeState = boy.state;
      if (!ready || !routeState) return null;
      const next = [layout, host.seed].join(',');
      if (next !== signature) {
        signature = next;
        place = meadowCatChoosePlace(
          routeState,
          host.W,
          host.H,
          host.TASKBAR,
          host.seed,
          host.icons,
          numParam(host.P, 'sigma'),
        );
      }
      if (!place) return null;
      const size = place.size,
        rect: [number, number, number, number] = [place.x - size / 2, place.y - size / 2, size, size],
        shadow: [number, number] = [size * 0.045, size * 0.06];
      return {
        texture,
        rect,
        shadow,
        tail: meadowCatTailAngle(time, host.seed),
        bounds: [rect[0] - 2, rect[1] - 2, size + shadow[0] + 4, size + shadow[1] + 4],
        state: place,
      };
    },
  };
}
