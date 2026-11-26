// 确定性 PRNG（mulberry32）：点云形态只依赖 seed，视觉基线与截图才可复现。
// 与 DeskApp.mulberry32 等价，但放在这里让 orb 的纯逻辑模块不依赖应用外壳。
export function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
