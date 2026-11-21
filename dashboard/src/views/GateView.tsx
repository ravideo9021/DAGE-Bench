import { theme as TH, alpha } from '../ui/theme';
import { useEffect, useMemo, useState } from 'react';
import { Play } from 'lucide-react';
import { getNetwork, gateSigma } from '../sim/network';
import { Trial, runTrial, wilson } from '../sim/trial';
import { featureLabel } from '../engine/flight';
import { gateAblation } from '../data/results';
import { Panel, Field, Slider, Readout } from '../ui/kit';

const net = getNetwork();
const BIN = 0.25;
const DMAX = 14;
const NB = Math.round(DMAX / BIN);

interface Collected { idHist: Float64Array; oodHist: Float64Array; id: Float32Array; ood: Float32Array; attr: Float64Array; attrN: number; maxFeat: Float64Array }

function collect(onProgress: (p: number) => void, done: (c: Collected) => void) {
  const jobs: { vp: number; seed: number; ood: boolean }[] = [];
  for (const vp of [1.5, 3.0]) for (let s = 0; s < 6; s++) jobs.push({ vp, seed: 500 + s, ood: false });
  for (const vp of [6.0, 7.0]) for (let s = 0; s < 6; s++) jobs.push({ vp, seed: 500 + s, ood: true });
  const id: number[] = [];
  const ood: number[] = [];
  const attr = new Float64Array(24);
  const maxFeat = new Float64Array(24);
  let attrN = 0;
  let k = 0;
  const step = () => {
    const t0 = performance.now();
    while (k < jobs.length && performance.now() - t0 < 30) {
      const j = jobs[k++];
      const tr = new Trial({ controller: 'Res-G', vp: j.vp, seed: j.seed, mismatch: false, kappa: 1, d0Scale: 1 }, net, false);
      let i = 0;
      while (tr.advance()) {
        if (++i < 5) continue;
        (j.ood ? ood : id).push(tr.d);
        if (j.ood && tr.d > net.d0) {
          attrN++;
          for (let f = 0; f < 24; f++) {
            const v = Math.abs(tr.win[f] - net.inMean[f]) / net.inStd[f];
            attr[f] += v;
            if (v > maxFeat[f]) maxFeat[f] = v;
          }
        }
      }
    }
    onProgress(k / jobs.length);
    if (k < jobs.length) setTimeout(step, 0);
    else {
      const hist = (arr: number[]) => {
        const h = new Float64Array(NB);
        for (const d of arr) h[Math.min(NB - 1, Math.floor(d / BIN))]++;
        for (let b = 0; b < NB; b++) h[b] /= arr.length * BIN;
        return h;
      };
      done({ idHist: hist(id), oodHist: hist(ood), id: Float32Array.from(id), ood: Float32Array.from(ood), attr, attrN, maxFeat });
    }
  };
  setTimeout(step, 30);
}

let cache: Collected | null = null;

export default function GateView() {
  const [data, setData] = useState<Collected | null>(cache);
  const [prog, setProg] = useState(0);
  const [kappa, setKappa] = useState(1.0);
  const [d0s, setD0s] = useState(1.0);
  const [verify, setVerify] = useState<{ k: number; d: number; n: number; ok: number; sigma: number; running: boolean } | null>(null);

  useEffect(() => { if (!cache) collect(setProg, (c) => { cache = c; setData(c); }); }, []);

  const d0 = net.d0 * d0s;
  const stats = useMemo(() => {
    if (!data) return null;
    const f = (arr: Float32Array) => {
      let att = 0, sum = 0;
      for (const d of arr) { const s = gateSigma(d, d0, kappa); sum += s; if (s < 0.99) att++; }
      return { att: att / arr.length, mean: sum / arr.length };
    };
    return { id: f(data.id), ood: f(data.ood) };
  }, [data, d0, kappa]);

  const runVerify = () => {
    const N = 100;
    const st = { k: kappa, d: d0s, n: 0, ok: 0, sigma: 0, running: true };
    setVerify({ ...st });
    const step = () => {
      const t0 = performance.now();
      while (st.n < N && performance.now() - t0 < 40) {
        const r = runTrial({ controller: 'Res-G', vp: 6, seed: 100 + st.n, mismatch: false, kappa: st.k, d0Scale: st.d }, net);
        st.n++; st.ok += r.success ? 1 : 0; st.sigma += r.meanSigma;
      }
      st.running = st.n < N;
      setVerify({ ...st });
      if (st.running) setTimeout(step, 0);
    };
    setTimeout(step, 0);
  };

  const ablRows = [0.4, 0.8, 1.2, 2.4];
  const ablCols = [0.6, 0.8, 1.0];
  const ungated = gateAblation.find((r) => r.kappa === null);
  const pid = gateAblation.find((r) => r.kappa === 'PID');

  return (
    <div className="view-scroll">
      <div className="section-title">
        <h1>Safety gate lab</h1>
        <p>The gate measures how far the network's input sits from its training distribution and smoothly withdraws the learned correction, falling back to the certified PID. Tune it here against distributions recorded from live flights.</p>
      </div>

      <div className="grid g-2" style={{ marginBottom: 10 }}>
        <div className="eq"><span className="lbl">Eq. 12</span>d(<var>x</var>) = max<sub>i</sub> | <var>x</var><sub>i</sub> − μ<sub>i</sub> | / σ<sub>i</sub></div>
        <div className="eq"><span className="lbl">Eq. 13</span>σ(<var>x</var>) = exp( −max(0, d(<var>x</var>) − d₀) / κ )  ·  u = u<sub>PID</sub> − σ·r̂</div>
      </div>

      <div className="grid g-side" style={{ marginBottom: 10 }}>
        <Panel tag="GT-CFG" title="Gate parameters">
          <Field label="Decay κ" value={kappa.toFixed(2)} hint="Smaller κ cuts the residual off more sharply beyond d₀.">
            <Slider min={0.2} max={3} step={0.05} value={kappa} onChange={setKappa} label="kappa" />
          </Field>
          <Field label="Threshold" value={`${d0s.toFixed(2)} × d₀ = ${d0.toFixed(2)}`} hint={`d₀ = ${net.d0.toFixed(3)} is the 99th percentile of validation distances.`}>
            <Slider min={0.4} max={1.6} step={0.05} value={d0s} onChange={setD0s} label="d0 scale" />
          </Field>
          <div className="field" style={{ marginTop: 18 }}>
            <div className="field-l"><span>Attenuated timesteps</span></div>
            <div className="grid g-2" style={{ gap: 8 }}>
              <div className="hud-card" style={{ background: 'var(--card-2)', boxShadow: 'inset 0 0 0 0.5px var(--sep)', borderRadius: 12 }}><Readout label="Within training" value={stats ? (stats.id.att * 100).toFixed(1) : '…'} unit="%" color="var(--info)" /></div>
              <div className="hud-card" style={{ background: 'var(--card-2)', boxShadow: 'inset 0 0 0 0.5px var(--sep)', borderRadius: 12 }}><Readout label="Beyond training" value={stats ? (stats.ood.att * 100).toFixed(1) : '…'} unit="%" color="var(--warn)" /></div>
              <div className="hud-card" style={{ background: 'var(--card-2)', boxShadow: 'inset 0 0 0 0.5px var(--sep)', borderRadius: 12 }}><Readout label="Mean σ within" value={stats ? stats.id.mean.toFixed(3) : '…'} /></div>
              <div className="hud-card" style={{ background: 'var(--card-2)', boxShadow: 'inset 0 0 0 0.5px var(--sep)', borderRadius: 12 }}><Readout label="Mean σ beyond" value={stats ? stats.ood.mean.toFixed(3) : '…'} /></div>
            </div>
          </div>
          <div className="field" style={{ marginTop: 18 }}>
            <button type="button" className="btn signal" onClick={runVerify} disabled={verify?.running}>
              {verify?.running ? <span className="spinner" /> : <Play size={12} />} Fly 100 trials @ 6 m/s
            </button>
            {verify && (
              <dl className="kv" style={{ marginTop: 8 }}>
                <dt>κ · d₀ scale</dt><dd>{verify.k.toFixed(2)} · {verify.d.toFixed(2)}</dd>
                <dt>Completed</dt><dd>{verify.n} / 100</dd>
                <dt>Envelope success</dt><dd style={{ color: verify.ok === verify.n ? 'var(--ok)' : 'var(--warn)' }}>{verify.n ? ((verify.ok / verify.n) * 100).toFixed(1) : '—'}%{verify.n ? <small>[{wilson(verify.ok, verify.n).map((v) => (v * 100).toFixed(0)).join('–')}]</small> : null}</dd>
                <dt>Mean σ</dt><dd>{verify.n ? (verify.sigma / verify.n).toFixed(3) : '—'}</dd>
              </dl>
            )}
          </div>
        </Panel>

        <Panel tag="GT-RSP" title="Gate response over observed distance distributions" className="chart-panel" style={{ minHeight: 470 }}
          right={<div className="legend"><span><i style={{ background: 'var(--c-pid)' }} />Within training (≤3 m/s)</span><span><i style={{ background: 'var(--warn)' }} />Beyond training (≥6 m/s)</span><span><i style={{ background: 'var(--accent)' }} />Gate σ(d)</span></div>}>
          {data ? <Response data={data} kappa={kappa} d0={d0} /> : <Loading p={prog} />}
        </Panel>
      </div>

      <div className="grid g-2">
        <Panel tag="GT-ABL" title="Table V · gate ablation at v_p = 6.0 m/s (300 trials/cell)">
          <div className="matrix" style={{ gridTemplateColumns: '90px repeat(3, minmax(0, 1fr))' }}>
            <div className="mx-h">κ \ d₀ ×</div>
            {ablCols.map((c) => <div key={c} className="mx-h">{c.toFixed(1)} d₀</div>)}
            {ablRows.map((k) => (
              <Row key={k} k={k} cols={ablCols} sel={Math.abs(kappa - k) < 1e-6 ? d0s : null} onPick={(d) => { setKappa(k); setD0s(d); }} />
            ))}
          </div>
          <dl className="kv" style={{ marginTop: 12 }}>
            <dt>Ungated residual (σ ≡ 1)</dt><dd>{ungated?.envelope_pct.toFixed(1)}% · RMS φ {ungated?.rms_phi.toFixed(4)}</dd>
            <dt>PID baseline (no residual)</dt><dd>{pid?.envelope_pct.toFixed(1)}% · RMS φ {pid?.rms_phi.toFixed(4)}</dd>
          </dl>
          <p className="field-hint" style={{ marginTop: 10 }}>Click a cell to load its parameters, then fly 100 live trials to reproduce it.</p>
        </Panel>
        <Panel tag="GT-ATR" title="Which inputs leave the training distribution?" className="chart-panel" style={{ height: 380 }}>
          {data ? <Attribution data={data} d0={net.d0} /> : <Loading p={prog} />}
        </Panel>
      </div>
    </div>
  );
}

function Loading({ p }: { p: number }) {
  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100%', minHeight: 200 }}>
      <div style={{ width: 260 }}>
        <div className="field-l" style={{ marginBottom: 8 }}><span>Flying 24 recording trials</span><b>{(p * 100).toFixed(0)}%</b></div>
        <div className="meter"><i style={{ width: `${p * 100}%`, background: 'var(--signal)' }} /></div>
      </div>
    </div>
  );
}

function Row({ k, cols, sel, onPick }: { k: number; cols: number[]; sel: number | null; onPick: (d: number) => void }) {
  return (
    <>
      <div className="mx-rh mono" style={{ fontSize: 11 }}>κ = {k}</div>
      {cols.map((c) => {
        const r = gateAblation.find((x) => x.kappa === k && x.d0_scale === c)!;
        const col = r.envelope_pct >= 99.5 ? 'var(--ok)' : r.envelope_pct >= 85 ? 'var(--warn)' : 'var(--crit)';
        return (
          <button key={c} type="button" className="mx-cell" style={{ minHeight: 58 }} aria-pressed={sel !== null && Math.abs(sel - c) < 1e-6} onClick={() => onPick(c)}>
            <div className="pv" style={{ color: col, fontSize: 17 }}>{r.envelope_pct.toFixed(1)}<small>%</small></div>
            <div className="ci">σ̄ {r.mean_sigma?.toFixed(3)} · RMS φ {r.rms_phi.toFixed(4)}</div>
          </button>
        );
      })}
    </>
  );
}

function Response({ data, kappa, d0 }: { data: Collected; kappa: number; d0: number }) {
  const W = 760, H = 400, L = 46, R = 46, T = 16, B = 36;
  const X = (d: number) => L + (d / DMAX) * (W - L - R);
  const Y = (s: number) => T + (1 - s) * (H - T - B);
  let hmax = 0;
  for (let b = 0; b < NB; b++) hmax = Math.max(hmax, data.idHist[b], data.oodHist[b]);
  const HY = (v: number) => T + (1 - Math.min(1, v / hmax)) * (H - T - B);
  const curve = (k: number, dd: number) => Array.from({ length: 141 }, (_, i) => { const d = (i / 140) * DMAX; return `${X(d)},${Y(gateSigma(d, dd, k))}`; }).join(' ');
  const bars = (h: Float64Array, color: string) => Array.from(h).map((v, b) => v > 0 && (
    <rect key={b} x={X(b * BIN) + 0.5} y={HY(v)} width={Math.max(1, X(BIN) - X(0) - 1)} height={H - B - HY(v)} fill={color} />
  ));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" style={{ display: 'block' }}>
      {[0, 0.25, 0.5, 0.75, 1].map((s) => (
        <g key={s}>
          <line x1={L} x2={W - R} y1={Y(s)} y2={Y(s)} stroke="var(--grid)" />
          <text x={L - 6} y={Y(s) + 3} fill="var(--text-3)" fontSize={9} textAnchor="end">{s.toFixed(2)}</text>
        </g>
      ))}
      {Array.from({ length: DMAX / 2 + 1 }, (_, i) => i * 2).map((d) => (
        <text key={d} x={X(d)} y={H - 18} fill="var(--text-3)" fontSize={9} textAnchor="middle">{d}</text>
      ))}
      <text x={(L + W - R) / 2} y={H - 3} fill="var(--text-3)" fontSize={9.5} textAnchor="middle">Chebyshev distance d(x) in standardised input space</text>
      <text x={12} y={(T + H - B) / 2} fill="var(--text-3)" fontSize={9.5} textAnchor="middle" transform={`rotate(-90 12 ${(T + H - B) / 2})`}>gate weight σ</text>
      <text x={W - 12} y={(T + H - B) / 2} fill="var(--text-4)" fontSize={9.5} textAnchor="middle" transform={`rotate(90 ${W - 12} ${(T + H - B) / 2})`}>density of observed d</text>
      <g opacity={0.5}>{bars(data.idHist, TH().ctrl.PID)}</g>
      <g opacity={0.5}>{bars(data.oodHist, TH().warn)}</g>
      <rect x={X(d0)} y={T} width={X(DMAX) - X(d0)} height={H - T - B} fill={alpha(TH().accent, 0.04)} />
      {[0.4, 2.4].map((k) => <polyline key={k} points={curve(k, d0)} fill="none" stroke="var(--text-4)" strokeDasharray="3 3" strokeWidth={1} />)}
      <polyline points={curve(kappa, d0)} fill="none" stroke="var(--accent)" strokeWidth={2.4} strokeLinejoin="round" />
      <line x1={X(d0)} x2={X(d0)} y1={T} y2={H - B} stroke="var(--accent)" strokeDasharray="4 3" />
      <text x={X(d0) + 6} y={T + 12} fill="var(--accent)" fontSize={10}>d₀ = {d0.toFixed(2)}</text>
      <text x={X(d0) + 6} y={T + 25} fill="var(--text-3)" fontSize={9}>residual withdrawn →</text>
      <text x={X(1.7)} y={T + 12} fill="var(--ok)" fontSize={9}>full residual (σ = 1)</text>
      <text x={X(11.5)} y={Y(gateSigma(11.5, d0, 0.4)) - 6} fill="var(--text-4)" fontSize={8.5}>κ 0.4</text>
      <text x={X(11.5)} y={Y(gateSigma(11.5, d0, 2.4)) - 6} fill="var(--text-4)" fontSize={8.5}>κ 2.4</text>
    </svg>
  );
}

function Attribution({ data, d0 }: { data: Collected; d0: number }) {
  const W = 620, H = 330, L = 40, R = 10, T = 14, B = 54;
  const mean = Array.from(data.attr).map((v) => v / Math.max(1, data.attrN));
  const peak = Array.from(data.maxFeat);
  const vmax = Math.max(d0 * 1.4, ...peak) * 1.05;
  const bw = (W - L - R) / 24;
  const Y = (v: number) => T + (1 - v / vmax) * (H - T - B);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" style={{ display: 'block' }}>
      {[0, 5, 10, 15, 20].filter((v) => v <= vmax).map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="var(--grid)" />
          <text x={L - 6} y={Y(v) + 3} fill="var(--text-3)" fontSize={9} textAnchor="end">{v}</text>
        </g>
      ))}
      {mean.map((v, i) => (
        <g key={i}>
          <rect x={L + i * bw + 2} y={Y(peak[i])} width={bw - 4} height={H - B - Y(peak[i])} fill={alpha(TH().warn, 0.14)} />
          <rect x={L + i * bw + 2} y={Y(v)} width={bw - 4} height={H - B - Y(v)} fill={peak[i] > d0 ? TH().warn : TH().text4} />
          <text x={L + i * bw + bw / 2} y={H - B + 10} fill={i % 6 === 0 ? TH().text2 : TH().text3} fontSize={8} textAnchor="end" transform={`rotate(-55 ${L + i * bw + bw / 2} ${H - B + 10})`}>{featureLabel(i)}</text>
        </g>
      ))}
      <line x1={L} x2={W - R} y1={Y(d0)} y2={Y(d0)} stroke="var(--accent)" strokeDasharray="4 3" />
      <text x={W - R - 4} y={Y(d0) - 5} fill="var(--accent)" fontSize={9} textAnchor="end">d₀</text>
      <text x={L + 4} y={T + 4} fill="var(--text-3)" fontSize={9}>|x_i − μ_i| / σ_i while gate active · bar = mean, halo = peak · {data.attrN.toLocaleString()} gated steps</text>
    </svg>
  );
}
