import type { ReactNode, CSSProperties } from 'react';

export function Panel(props: {
  tag?: string; title: ReactNode; right?: ReactNode; children: ReactNode;
  className?: string; bodyClass?: string; style?: CSSProperties; flush?: boolean;
}) {
  return (
    <section className={`panel ${props.className ?? ''}`} style={props.style}>
      <header className="panel-h">
        {props.tag && <span className="tag">{props.tag}</span>}
        <h3>{props.title}</h3>
        {props.right && <div className="right">{props.right}</div>}
      </header>
      <div className={`panel-b ${props.flush ? 'flush' : ''} ${props.bodyClass ?? ''}`}>{props.children}</div>
    </section>
  );
}

export function Field(props: { label: ReactNode; value?: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <div className="field-l"><span>{props.label}</span>{props.value !== undefined && <b>{props.value}</b>}</div>
      {props.children}
      {props.hint && <div className="field-hint">{props.hint}</div>}
    </div>
  );
}

export function Seg<T extends string | number>(props: {
  options: readonly { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; label?: string;
  className?: string; style?: CSSProperties;
}) {
  const n = props.options.length;
  const idx = props.options.findIndex((o) => o.value === props.value);
  return (
    <div className={`seg ${props.className ?? ''}`} role="group" aria-label={props.label} style={props.style}>
      {idx >= 0 && <span className="seg-thumb" aria-hidden="true" style={{ width: `calc((100% - 4px) / ${n})`, transform: `translateX(${idx * 100}%)` }} />}
      {props.options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === props.value} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Slider(props: {
  min: number; max: number; step: number; value: number; onChange: (v: number) => void;
  label: string; scale?: { at: number; label: string }[]; accentFrom?: number;
}) {
  const p = ((props.value - props.min) / (props.max - props.min)) * 100;
  return (
    <div>
      <input
        type="range" min={props.min} max={props.max} step={props.step} value={props.value}
        aria-label={props.label}
        style={{ ['--p' as string]: `${p}%` }}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      {props.scale && (
        <div className="range-scale">
          {props.scale.map((s) => (
            <span key={s.label} style={{ left: `${((s.at - props.min) / (props.max - props.min)) * 100}%` }}>{s.label}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export function Toggle(props: { checked: boolean; onChange: (v: boolean) => void; label: string; desc?: string }) {
  return (
    <button type="button" role="switch" aria-checked={props.checked} className="toggle" onClick={() => props.onChange(!props.checked)}>
      <span><span className="tl">{props.label}</span>{props.desc && <span className="td">{props.desc}</span>}</span>
      <span className="switch" />
    </button>
  );
}

export function Readout(props: { label: string; value: ReactNode; unit?: string; color?: string; style?: CSSProperties }) {
  return (
    <div className="readout" style={props.style}>
      <span className="rl">{props.label}</span>
      <span className="rv" style={{ color: props.color }}>{props.value}{props.unit && <small>{props.unit}</small>}</span>
    </div>
  );
}

