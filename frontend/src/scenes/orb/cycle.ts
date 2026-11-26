// autoCycle 的下一形态索引：纯逻辑，便于单测。
// 先把当前索引收敛到 [0, count)（越界 / NaN 都安全），再 +1 环绕。
export function nextCycleIndex(current: number, count: number): number {
  const n = Math.max(1, Math.floor(count));
  const i = Number.isFinite(current) ? ((Math.floor(current) % n) + n) % n : 0;
  return (i + 1) % n;
}
