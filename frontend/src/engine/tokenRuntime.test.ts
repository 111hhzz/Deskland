// tokenRuntime 纯逻辑单测：主题切换、覆盖优先、core 回退、未知主题与非法值。
import { describe, expect, it } from 'vitest';
import { currentThemeId, loadTheme, resolveToken, sceneToken } from './tokenRuntime.js';

describe('tokenRuntime', () => {
  it('默认 meadow：主题覆盖优先，core 作为回退', () => {
    loadTheme('meadow');
    expect(currentThemeId()).toBe('meadow');
    expect(resolveToken('--color-bg')).toBe('#a6c46e');
    expect(sceneToken('--scene-ground-mid')).toEqual([0.62, 0.75, 0.42]);
    // core 回退：字体栈只在 core 定义，各主题都不覆盖
    expect(String(resolveToken('--font-main'))).toContain('system-ui');
  });

  it('切换主题后取该主题的覆盖值', () => {
    loadTheme('sky');
    expect(resolveToken('--color-bg')).toBe('#6fb3ea');
    expect(sceneToken('--scene-sky-day-top')).toEqual([0.27, 0.56, 0.88]);
  });

  it('不回读其它主题：当前主题缺失的 scene token 不会被别的主题串值', () => {
    loadTheme('sky');
    expect(sceneToken('--scene-ground-mid')).toBeNull(); // 仅 meadow/beach 有
    loadTheme('beach');
    expect(sceneToken('--scene-sky-day-top')).toBeNull(); // 仅 sky 有
  });

  it('未知主题不改变当前选择；缺失 / 非向量返回 null', () => {
    loadTheme('sky');
    loadTheme('nope');
    expect(currentThemeId()).toBe('sky');
    expect(resolveToken('--no-such-token')).toBeUndefined();
    expect(sceneToken('--no-such-token')).toBeNull();
    // 字符串型 token（字体栈）不是数值向量
    expect(sceneToken('--font-main')).toBeNull();
  });
});
