import type { CSSProperties } from 'react';
import { useSettings } from '../store.js';
import { fmtParam, themeById, valuesOf } from '../domain.js';
import type { ParamDef } from '../types.js';

// 参数说明收进 ⓘ：hover / 聚焦触发的原生 tooltip（controls 是滚动容器，自定义气泡会被裁剪）
function ParamLabel({ p }: { p: ParamDef }) {
  return (
    <span className="label">
      {p.label}
      {p.hint ? (
        <button type="button" className="info" title={p.hint} aria-label={p.hint}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" strokeWidth="1.1" />
            <path d="M8 7.4v3.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <circle cx="8" cy="4.9" r=".95" fill="currentColor" />
          </svg>
        </button>
      ) : null}
    </span>
  );
}

function ParamRow({ p, value }: { p: ParamDef; value: number | boolean }) {
  const { setParam, t } = useSettings();
  const changed = value !== p.default;

  // 布尔开关：右侧显示开 / 关，控件复用设置页既有的 .switch-row 样式
  if (p.type === 'bool') {
    return (
      <div className={`param${changed ? ' changed' : ''}`} id={`p-${p.key}`}>
        <div className="row">
          <ParamLabel p={p} />
          <span className="right">
            <button
              type="button"
              className="undo"
              data-reset={p.key}
              title={t('resetOne', { v: fmtParam(p, p.default) })}
              aria-label={t('resetOneAria', { label: p.label })}
              onClick={() => setParam(p.key, p.default)}
            >
              ↺
            </button>
            <span className="value" id={`v-${p.key}`}>
              {value ? '开' : '关'}
            </span>
          </span>
        </div>
        <label className="switch-row">
          <input
            type="checkbox"
            data-key={p.key}
            checked={!!value}
            onChange={(e) => setParam(p.key, e.target.checked)}
          />
          <span className="switch" />
        </label>
      </div>
    );
  }

  const num = typeof value === 'number' ? value : 0;
  const pct =
    p.min !== undefined && p.max !== undefined && p.max > p.min ? ((num - p.min) / (p.max - p.min)) * 100 : 50;
  return (
    <div className={`param${changed ? ' changed' : ''}`} id={`p-${p.key}`}>
      <div className="row">
        <ParamLabel p={p} />
        <span className="right">
          <button
            type="button"
            className="undo"
            data-reset={p.key}
            title={t('resetOne', { v: fmtParam(p, p.default) })}
            aria-label={t('resetOneAria', { label: p.label })}
            onClick={() => setParam(p.key, p.default)}
          >
            ↺
          </button>
          <span className="value" id={`v-${p.key}`}>
            {fmtParam(p, value)}
          </span>
        </span>
      </div>
      {p.options ? (
        <div className="opts" data-key={p.key} role="radiogroup" aria-label={p.label}>
          {p.options.map((o, i) => (
            <button
              type="button"
              key={i}
              data-opt={i}
              className={num === i ? 'on' : ''}
              role="radio"
              aria-checked={num === i}
              onClick={() => setParam(p.key, i)}
            >
              {o}
            </button>
          ))}
        </div>
      ) : (
        <div
          className="track"
          title={t('dblclickReset', { v: fmtParam(p, p.default) })}
          onDoubleClick={() => setParam(p.key, p.default)}
        >
          <input
            type="range"
            data-key={p.key}
            min={p.min}
            max={p.max}
            step={p.step}
            value={num}
            aria-label={p.label}
            style={{ '--p': pct + '%' } as CSSProperties}
            onChange={(e) => setParam(p.key, Number(e.target.value))}
          />
        </div>
      )}
    </div>
  );
}

export function Controls() {
  const { state, themes, t } = useSettings();
  const th = themeById(themes, state.theme);
  if (!th?.groups) {
    return (
      <section className="card controls" id="controls">
        <div className="empty">{t('noParams')}</div>
      </section>
    );
  }
  const vals = valuesOf(th, state.params);
  const singleGroup = th.groups.length === 1;
  return (
    <section className="card controls" id="controls">
      {th.groups.map((g) => (
        <details className="group" open key={g.name}>
          {/* 只有一组时分组名没有区分作用，折叠标题反而抬高参数、削弱归属 */}
          {singleGroup ? null : <summary>{g.name}</summary>}
          {g.params.map((p) => (
            <ParamRow key={p.key} p={p} value={vals[p.key] ?? p.default} />
          ))}
          {g.soon ? (
            <div className="soon">
              {t('comingSoon')}
              {g.soon.map((s) => (
                <span className="chip" key={s}>
                  {s}
                </span>
              ))}
            </div>
          ) : null}
        </details>
      ))}
    </section>
  );
}
