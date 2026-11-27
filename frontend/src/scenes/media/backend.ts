// 视频播放器后端抽象（M1a 架构预留，P2 可换独立进程后端）。
//
// v1 = DomVideoBackend（WebView2 内 <video>）：格式受 Edge 解码能力限制、无焦点窗口可能被
// Chromium 节流。P2 的 NativePlayerBackend（mpv/VLC 独立进程 + 命名管道 JSON IPC）只需实现
// 同一接口，VideoEngine 不动——见 docs/specs/2026-11-27-theme-extension-and-import-plan.md §5.1。

export interface VideoBackend {
  /** 播放器根元素（由 MediaEngine 挂进背景层；样式走 base.css 的 .media-layer 选择器） */
  readonly el: HTMLVideoElement;
  load(src: string): void;
  play(): void;
  pause(): void;
  dispose(): void;
  setMuted(m: boolean): void;
  setLoop(b: boolean): void;
  setSpeed(v: number): void;
}

export class DomVideoBackend implements VideoBackend {
  readonly el: HTMLVideoElement;

  constructor() {
    const v = document.createElement('video');
    v.autoplay = true;
    v.playsInline = true;
    v.setAttribute('playsinline', 'playsinline');
    v.setAttribute('webkit-playsinline', 'webkit-playsinline');
    this.el = v;
  }

  load(src: string): void {
    this.el.src = src;
  }

  play(): void {
    // autoplay 策略：未静音时浏览器可能拒绝自动播放，失败保持静默（用户可点击面板开关触发）
    const p = this.el.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }

  pause(): void {
    this.el.pause();
  }

  dispose(): void {
    this.el.pause();
    this.el.removeAttribute('src');
    this.el.load();
  }

  setMuted(m: boolean): void {
    this.el.muted = m;
  }

  setLoop(b: boolean): void {
    this.el.loop = b;
  }

  setSpeed(v: number): void {
    this.el.playbackRate = Number.isFinite(v) && v > 0 ? v : 1;
  }
}
