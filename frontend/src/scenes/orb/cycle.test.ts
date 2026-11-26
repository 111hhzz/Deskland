// autoCycle 索引推进单测：顺序、环绕、越界/NaN 收敛。
import { describe, expect, it } from 'vitest';
import { nextCycleIndex } from './cycle.js';

describe('orb autoCycle 索引', () => {
  it('顺序推进并环绕（5 形态）', () => {
    const seq = [0, 1, 2, 3, 4, 0].map((cur) => nextCycleIndex(cur, 5));
    expect(seq).toEqual([1, 2, 3, 4, 0, 1]);
  });

  it('越界索引先收敛再推进', () => {
    expect(nextCycleIndex(7, 5)).toBe(3); // 7 → 有效索引 2 → 下一 3
    expect(nextCycleIndex(-1, 5)).toBe(0); // -1 → 有效索引 4 → 下一 0
  });

  it('NaN / Infinity 退化为从 0 起', () => {
    expect(nextCycleIndex(Number.NaN, 5)).toBe(1);
    expect(nextCycleIndex(Number.POSITIVE_INFINITY, 5)).toBe(1);
  });

  it('count 非法时不崩且恒返回 0', () => {
    expect(nextCycleIndex(0, 0)).toBe(0);
    expect(nextCycleIndex(2, -3)).toBe(0);
  });
});
