import { useState } from 'react';
import { evaluationResults, mismatchResults, type EvalRow } from '../data/results';
import { CONTROLLERS } from '../sim/trial';
import { COLORS } from '../engine/flight';
import { MAX_TRAIN_SPEED } from '../sim/physics';
import { Panel, Seg } from '../ui/kit';

type Metric = 'envelope_pct' | 'rms_phi' | 'peak_phi' | 'delta_vy' | 'abs_vz';
const METRICS: { value: Metric; label: string; unit: string; better: 'high' | 'low'; d: number }[] = [
  { value: 'envelope_pct', label: 'Envelope %', unit: '%', better: 'high', d: 1 },
  { value: 'rms_phi', label: 'RMS φ', unit: 'rad', better: 'low', d: 4 },
  { value: 'peak_phi', label: 'Peak φ', unit: 'rad', better: 'low', d: 4 },
  { value: 'delta_vy', label: '|Δv_y|', unit: 'm/s', better: 'low', d: 3 },
  { value: 'abs_vz', label: '|v_z|', unit: 'm/s', better: 'low', d: 3 },
];

const FIGS = [
  { src: 'figures/envelope_comparison.png', cap: 'Envelope success across speeds · Wilson CIs' },
  { src: 'figures/fig4_descent_profile.png', cap: 'Fig. 4 · Descent profile at v_p = 3.0 m/s' },
  { src: 'figures/fig5_roll_error.png', cap: 'Fig. 5 · Roll error on final approach' },
  { src: 'figures/rms_phi_heatmap.png', cap: 'RMS roll error · controller × speed' },
  { src: 'figures/fig3_training_curves.png', cap: 'Fig. 3 · Training curves' },
];

export default function ResultsView() {
  const [metric, setMetric] = useState<Metric>('envelope_pct');
  const [fig, setFig] = useState<string | null>(null);
  const m = METRICS.find((x) => x.value === metric)!;

  const get = (rows: EvalRow[], c: string, vp: number) => rows.find((r) => r.controller === c && Math.abs(r.vp - vp) < 1e-6);
  const pd6 = get(evaluationResults, 'PD', 6)!;
  const pid6 = get(evaluationResults, 'PID', 6)!;
  const resg6 = get(evaluationResults, 'Res-G', 6)!;
  const pidM5 = get(mismatchResults, 'PID', 5)!;
  const resgM5 = get(mismatchResults, 'Res-G', 5)!;
  const pid3 = get(evaluationResults, 'PID', 3)!;
  const resg3 = get(evaluationResults, 'Res-G', 3)!;

  return (
    <div className="view-scroll">
      <div className="section-title">
        <h1>Published results</h1>
        <p>Aggregate figures from the Python benchmark (500 randomised trials per cell, 12,500 main-study simulations). Re-run any of them live in the Monte Carlo view.</p>
      </div>

      <div className="grid g-4" style={{ marginBottom: 10 }}>
        <Finding k="OOD robustness" v={`${resg6.envelope_pct.toFixed(0)}%`} c="var(--ok)"
          d={<>Res-G at 6.0 m/s, 1.5× beyond the training range. PID reaches {pid6.envelope_pct.toFixed(1)}% and PD {pd6.envelope_pct.toFixed(1)}%.</>} />
        <Finding k="Roll error reduction" v={`−${((1 - resg3.rms_phi / pid3.rms_phi) * 100).toFixed(0)}%`} c="var(--signal)"
          d={<>RMS φ vs. PID at 3.0 m/s ({pid3.rms_phi.toFixed(4)} → {resg3.rms_phi.toFixed(4)} rad), in distribution.</>} />
        <Finding k="Model mismatch" v={`${resgM5.envelope_pct.toFixed(1)}%`} c="var(--ok)"
          d={<>Res-G with the plant perturbed (K_φ ×1.4, λ 1.0, n 1.6) at 5 m/s. PID collapses to {pidM5.envelope_pct.toFixed(1)}%.</>} />
        <Finding k="Gate cost" v={`σ̄ ${resg6.mean_sigma?.toFixed(3)}`} c="var(--text)"
          d={<>Mean gate weight at 6 m/s. Res-G stays within the 95% CI of ungated Res-NG in every published cell, so the safety fallback costs no measurable performance.</>} />
      </div>

      <div className="grid g-2" style={{ marginBottom: 10 }}>
        <Panel tag="TAB-III" title="Table III · main evaluation" right={<Seg options={METRICS.map((x) => ({ value: x.value, label: x.label }))} value={metric} onChange={setMetric} label="Metric" />}>
          <Heat rows={evaluationResults} speeds={[0, 1.5, 3, 5, 6]} metric={m} controllers={[...CONTROLLERS]} />
        </Panel>
        <Panel tag="TAB-IV" title="Table IV · disturbance-model mismatch">
          <Heat rows={mismatchResults} speeds={[1.5, 3, 5]} metric={m} controllers={['PD', 'PID', 'Res-NG', 'Res-G']} />
        </Panel>
      </div>

      <Panel tag="TAB-III-F" title="Table III · full listing" style={{ marginBottom: 10 }} flush>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr><th>v_p (m/s)</th><th style={{ textAlign: 'left' }}>Controller</th><th>RMS φ</th><th>Peak φ</th><th>|Δv_y|</th><th>|v_z|</th><th>Envelope</th><th>95% CI</th><th>Roll viol.</th><th>σ̄</th></tr>
            </thead>
            <tbody>
              {evaluationResults.map((r) => (
                <tr key={r.vp + r.controller}>
                  <td>{r.vp.toFixed(1)}{r.vp > MAX_TRAIN_SPEED ? ' *' : ''}</td>
                  <td style={{ textAlign: 'left' }}><span style={{ display: 'inline-block', width: 7, height: 7, background: COLORS[r.controller as keyof typeof COLORS], marginRight: 8, borderRadius: 1 }} />{r.controller}</td>
                  <td>{r.rms_phi.toFixed(4)}</td><td>{r.peak_phi.toFixed(4)}</td><td>{r.delta_vy.toFixed(3)}</td><td>{r.abs_vz.toFixed(3)}</td>
                  <td style={{ color: r.envelope_pct >= 99.9 ? 'var(--ok)' : r.envelope_pct >= 80 ? 'var(--warn)' : 'var(--crit)' }}>{r.envelope_pct.toFixed(1)}%</td>
                  <td style={{ color: 'var(--text-3)' }}>[{r.envelope_ci_lo.toFixed(1)}, {r.envelope_ci_hi.toFixed(1)}]</td>
                  <td>{r.roll_viol_pct.toFixed(1)}%</td>
                  <td>{r.mean_sigma !== null ? r.mean_sigma.toFixed(3) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel tag="FIG" title="Publication figures · generated by dage visualize">
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
          {FIGS.map((f) => (
            <figure key={f.src} style={{ margin: 0 }}>
              <button type="button" className="fig-card" style={{ padding: 0, width: '100%' }} onClick={() => setFig(f.src)} aria-label={`Enlarge ${f.cap}`}>
                <img src={f.src} alt={f.cap} loading="lazy" />
              </button>
              <figcaption className="fig-cap">{f.cap}</figcaption>
            </figure>
          ))}
        </div>
      </Panel>

      {fig && <div className="lightbox" onClick={() => setFig(null)} role="dialog"><img src={fig} alt="" /></div>}
    </div>
  );
}

function Finding({ k, v, d, c }: { k: string; v: string; d: React.ReactNode; c: string }) {
  return (
    <div className="panel" style={{ padding: '14px 16px' }}>
      <div className="eyebrow">{k}</div>
      <div className="mono" style={{ fontSize: 30, fontWeight: 500, letterSpacing: '-0.03em', color: c, margin: '6px 0 4px' }}>{v}</div>
      <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5 }}>{d}</div>
    </div>
  );
}

function Heat({ rows, speeds, metric, controllers }: { rows: EvalRow[]; speeds: number[]; metric: (typeof METRICS)[number]; controllers: string[] }) {
  const vals = rows.map((r) => r[metric.value] as number);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const norm = (v: number) => {
    const t = hi > lo ? (v - lo) / (hi - lo) : 1;
    return metric.better === 'high' ? t : 1 - t;
  };
  const color = (g: number) => {
    const bad = [255, 77, 79], mid = [245, 184, 61], good = [61, 214, 140];
    const [a, b, t] = g < 0.5 ? [bad, mid, g * 2] : [mid, good, (g - 0.5) * 2];
    return `rgba(${a.map((x, i) => Math.round(x + (b[i] - x) * t)).join(',')},`;
  };
  return (
    <div className="matrix" style={{ gridTemplateColumns: `80px repeat(${speeds.length}, minmax(0, 1fr))` }}>
      <div />
      {speeds.map((v) => <div key={v} className="mx-h">{v.toFixed(1)} m/s{v > MAX_TRAIN_SPEED ? ' *' : ''}</div>)}
      {controllers.map((c) => (
        <Line key={c} c={c} speeds={speeds} rows={rows} metric={metric} color={color} norm={norm} />
      ))}
    </div>
  );
}

function Line({ c, speeds, rows, metric, color, norm }: { c: string; speeds: number[]; rows: EvalRow[]; metric: (typeof METRICS)[number]; color: (g: number) => string; norm: (v: number) => number }) {
  return (
    <>
      <div className="mx-rh"><span style={{ width: 8, height: 8, background: COLORS[c as keyof typeof COLORS], borderRadius: 2 }} />{c}</div>
      {speeds.map((vp) => {
        const r = rows.find((x) => x.controller === c && Math.abs(x.vp - vp) < 1e-6);
        if (!r) return <div key={vp} className="mx-cell" style={{ minHeight: 52, opacity: 0.3 }} />;
        const v = r[metric.value] as number;
        const g = norm(v);
        return (
          <div key={vp} className="mx-cell" style={{ minHeight: 52, background: `${color(g)}0.12)`, borderColor: `${color(g)}0.3)` }}>
            <div className="pv" style={{ fontSize: 15, color: `${color(g)}1)` }}>{v.toFixed(metric.d)}<small>{metric.unit === '%' ? '%' : ''}</small></div>
            {metric.value === 'envelope_pct' && <div className="ci">[{r.envelope_ci_lo.toFixed(1)}, {r.envelope_ci_hi.toFixed(1)}]</div>}
          </div>
        );
      })}
    </>
  );
}
