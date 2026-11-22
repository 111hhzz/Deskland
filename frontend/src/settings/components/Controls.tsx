import type { CSSProperties } from 'react';
import { useSettings } from '../store';
import { fmtParam, themeById, valuesOf } from '../domain';
import type { ParamDef } from '../types';

function ParamRow({ p, value }: { p: ParamDef; value: number }) {
  const { setParam, t } = useSettings();
  const changed = value !== p.default;
  const pct = p.min !== undefined && p.max !== undefined && p.max > p.min
    ? ((value - p.min) / (p.max - p.min)) * 100
    : 50;
  return (
    <div className={`param${changed ? ' changed' : ''}`} id={`p-${p.key}`}>
      <div className="row">
        <span className="label">{p.label}{p.hint ? <span className="hint">{p.hint}</span> : null}</span>
        <span className="right">
          <button type="button" className="undo" data-reset={p.key}
            title={t('resetOne', { v: fmtParam(p, p.default) })}
            aria-label={t('resetOneAria', { label: p.label })}
            onClick={() => setParam(p.key, p.default)}>↺</button>
          <span className="value" id={`v-${p.key}`}>{fmtParam(p, value)}</span>
        </span>
      </div>
      {p.options ? (
        <div className="opts" data-key={p.key} role="radiogroup" aria-label={p.label}>
          {p.options.map((o, i) => (
            <button type="button" key={i} data-opt={i} className={value === i ? 'on' : ''}
              role="radio" aria-checked={value === i}
              onClick={() => setParam(p.key, i)}>{o}</button>
          ))}
        </div>
      ) : (
        <div className="track" title={t('dblclickReset', { v: fmtParam(p, p.default) })}
          onDoubleClick={() => setParam(p.key, p.default)}>
          <input type="range" data-key={p.key} min={p.min} max={p.max} step={p.step}
            value={value} aria-label={p.label}
            style={{ '--p': pct + '%' } as CSSProperties}
            onChange={e => setParam(p.key, Number(e.target.value))} />
        </div>
      )}
    </div>
  );
}

export function Controls() {
  const { state, themes, t } = useSettings();
  const th = themeById(themes, state.theme);
  if (!th?.groups) {
    return <section className="card controls" id="controls"><div className="empty">{t('noParams')}</div></section>;
  }
  const vals = valuesOf(th, state.params);
  return (
    <section className="card controls" id="controls">
      {th.groups.map(g => (
        <details className="group" open key={g.name}>
          <summary>{g.name}</summary>
          {g.params.map(p => <ParamRow key={p.key} p={p} value={vals[p.key] ?? p.default} />)}
          {g.soon ? (
            <div className="soon">{t('comingSoon')}{g.soon.map(s => <span className="chip" key={s}>{s}</span>)}</div>
          ) : null}
        </details>
      ))}
    </section>
  );
}
