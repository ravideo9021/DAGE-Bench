import { useEffect, useMemo, useRef, useState } from 'react';
import { Gauge } from 'lucide-react';
import { getNetwork, FEATURE_NAMES } from '../sim/network';
import { Trial } from '../sim/trial';
import { benchInference, selftest } from '../sim/selftest';
import { MAX_TRAIN_SPEED } from '../sim/physics';
import { trainingCurves } from '../data/results';
import { Panel, Readout, Seg } from '../ui/kit';
import { useCanvas, useTicker } from '../ui/hooks';

const net = getNetwork();
const SIZES = [24, 64, 64, 32, 2];

/** Pre-select the strongest connections per layer for drawing. */
function topEdges(): { l: number; i: number; j: number; w: number }[] {
  const out: { l: number; i: number; j: number; w: number }[] = [];
  const budget = [260, 420, 300, 64];
  net.layers.forEach((L, l) => {
    const all: { l: number; i: number; j: number; w: number }[] = [];
    for (let i = 0; i < L.nIn; i++) for (let j = 0; j < L.nOut; j++) all.push({ l, i, j, w: L.W[i * L.nOut + j] });
    all.sort((a, b) => Math.abs(b.w) - Math.abs(a.w));
    out.push(...all.slice(0, budget[l]));
  });
  return out;
}

/** Live closed-loop trial driving the activation display (external, mutable state). */
class LiveRun {
  private vp = 5;
  private seed = 200;
  trial!: Trial;
  constructor() { this.next(); }
  next() { this.trial = new Trial({ controller: 'Res-G', vp: this.vp, seed: this.seed++, mismatch: false, kappa: 1, d0Scale: 1 }, net); }
  setSpeed(v: number) { this.vp = v; this.next(); }
}

export default function ModelView() {
  const [us, setUs] = useState<number | undefined>(selftest.usPerInf);
  const [benching, setBenching] = useState(false);
  const [vp, setVp] = useState(5);
  const [parity, setParity] = useState<'open' | 'closed'>('open');
  // Mutable live-simulation state shared with the animation loop (not React state).
  const [live] = useState(() => new LiveRun());
  useTicker(12);
  useEffect(() => { live.setSpeed(vp); }, [vp, live]);

  const edges = useMemo(() => topEdges(), []);
  const { ref: netRef, redraw: drawNet } = useCanvas(({ ctx, w, h }) => drawNetwork(ctx, w, h, edges));
  const { ref: inRef, redraw: drawIn } = useCanvas(({ ctx, w, h }) => drawInputs(ctx, w, h));

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const loop = (now: number) => {
      acc += Math.min(0.1, (now - last) / 1000);
      last = now;
      const tr = live.trial;
      while (acc >= 0.01) {
        acc -= 0.01;
        if (!tr.advance()) { live.next(); break; }
      }
      drawNet();
      drawIn();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [drawNet, drawIn, live]);

  const bench = () => {
    setBenching(true);
    setTimeout(() => { const v = benchInference(40000); selftest.usPerInf = v; setUs(v); setBenching(false); }, 30);
  };
  useEffect(() => {
    if (selftest.usPerInf !== undefined) return;
    const id = setTimeout(() => { const v = benchInference(40000); selftest.usPerInf = v; setUs(v); }, 60);
    return () => clearTimeout(id);
  }, []);

  const tr = live.trial;
  return (
    <div className="view-scroll">
      <div className="section-title">
        <h1>Residual network</h1>
        <p>A compact tanh MLP that predicts the DAGE roll torque and ground-effect acceleration from a 40 ms window of state and command history. These are the trained weights, running live in your browser.</p>
      </div>

      <div className="stat-strip" style={{ marginBottom: 10 }}>
        <div><Readout label="Topology" value="24·64·64·32·2" /></div>
        <div><Readout label="Parameters" value={net.nParams.toLocaleString()} /></div>
        <div><Readout label="MACs / forward" value={net.nMacs.toLocaleString()} /></div>
        <div><Readout label="Latency (this device)" value={us ? us.toFixed(1) : '…'} unit="µs" color="var(--signal)" /></div>
        <div><Readout label="Throughput" value={us ? (1e6 / us / 1000).toFixed(0) + 'k' : '…'} unit="inf/s" /></div>
        <div><Readout label="Of 10 ms control budget" value={us ? ((us / 10000) * 100).toFixed(2) : '…'} unit="%" /></div>
      </div>

      <div className="grid g-side-r" style={{ marginBottom: 10 }}>
        <Panel tag="NN-LIVE" title="Live activations · Res-G closed loop" className="chart-panel" style={{ height: 520 }}
          right={
            <div className="seg" style={{ width: 230 }}>
              {[1.5, 3, 5, 7].map((v) => (
                <button key={v} type="button" aria-pressed={vp === v} onClick={() => setVp(v)}>{v} m/s{v > MAX_TRAIN_SPEED ? '*' : ''}</button>
              ))}
            </div>
          }>
          <div className="chart-wrap"><canvas ref={netRef} /></div>
        </Panel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Panel tag="NN-IN" title="Input window x ∈ ℝ²⁴ (standardised)" className="chart-panel" style={{ height: 212 }}>
            <div className="chart-wrap"><canvas ref={inRef} /></div>
          </Panel>
          <Panel tag="NN-OUT" title="Output vs ground truth">
            <dl className="kv" style={{ fontSize: 11.5 }}>
              <dt>Platform v_p · t</dt><dd>{tr.plant.vp.toFixed(2)} m/s · {tr.t.toFixed(2)} s</dd>
              <dt>τ̂_φ predicted</dt><dd style={{ color: 'var(--text)' }}>{tr.tauHat.toFixed(4)}<small>N·m</small></dd>
              <dt>τ_φ true DAGE</dt><dd style={{ color: 'var(--signal)' }}>{tr.trueTau().toFixed(4)}<small>N·m</small></dd>
              <dt>â_GE predicted</dt><dd>{tr.aHat.toFixed(3)}<small>m/s²</small></dd>
              <dt>a_GE true</dt><dd style={{ color: 'var(--signal)' }}>{tr.trueGE().toFixed(3)}<small>m/s²</small></dd>
              <dt>Gate d(x) · σ</dt><dd>{tr.d.toFixed(2)} · {tr.sigma.toFixed(3)}</dd>
            </dl>
          </Panel>
          <Panel tag="NN-BENCH" title="Inference benchmark">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button type="button" className="btn sm" disabled={benching} onClick={bench}>{benching ? <span className="spinner" /> : <Gauge size={12} />} Run 40k passes</button>
              <span className="field-hint">Float64, single thread, no SIMD. The budget is the 100 Hz control period.</span>
            </div>
          </Panel>
        </div>
      </div>

      <div className="grid g-3" style={{ marginBottom: 10 }}>
        <Panel tag="NN-PAR" title="Parity · τ̂ vs τ" className="chart-panel" style={{ height: 340 }}
          right={<Seg options={[{ value: 'open', label: 'Open loop' }, { value: 'closed', label: 'Closed loop' }] as const} value={parity} onChange={setParity} label="Parity regime" />}>
          <Parity mode={parity} />
          <div className="field-hint" style={{ padding: '0 10px 6px' }}>
            {parity === 'open'
              ? 'PID flying, network observing: the regime it was trained in.'
              : 'Res-G flying on its own correction. Compensation shifts the nominal command the network reads, so fit drops (Python reference: R² 0.71).'}
          </div>
        </Panel>
        <Panel tag="NN-TRN" title="Training · MSE (standardised)" className="chart-panel" style={{ height: 340 }}>
          <TrainingCurve />
        </Panel>
        <Panel tag="NN-CARD" title="Model card">
          <dl className="kv">
            <dt>Input</dt><dd>4 × [φ, p, z, v_z, u_φ, u_z]</dd>
            <dt>Output</dt><dd>[τ_φ,DAGE, a_GE]</dd>
            <dt>Hidden act.</dt><dd>tanh × 3</dd>
            <dt>Normalisation</dt><dd>z-score in/out</dd>
            <dt>Training set</dt><dd>400 traj · 200k samples</dd>
            <dt>Validation</dt><dd>60 trajectories</dd>
            <dt>Train speeds</dt><dd>v_p ∈ [0, 4.0] m/s</dd>
            <dt>Optimiser</dt><dd>Adam · 8e-4 · ×0.94/ep</dd>
            <dt>Regularisation</dt><dd>dropout 5% · noise 2%</dd>
            <dt>Early stop</dt><dd>patience 6 · epoch 38</dd>
            <dt>Best val MSE</dt><dd>{Math.min(...trainingCurves.map((d) => d.val)).toExponential(2)}</dd>
            <dt>Gate d₀ (P99 val)</dt><dd>{net.d0.toFixed(4)}</dd>
            <dt>Port fidelity</dt><dd>{selftest.netErr !== undefined ? `|Δ| ${selftest.netErr.toExponential(1)}` : 'float64 exact'}</dd>
          </dl>
        </Panel>
      </div>

      <Panel tag="NN-W" title="Weight matrices · trained values (diverging, per-layer scale)">
        <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {net.layers.map((_, i) => <WeightMap key={i} idx={i} />)}
          <div className="legend" style={{ flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
            <span><i style={{ background: '#ff6b1a', height: 8, width: 8 }} />positive</span>
            <span><i style={{ background: '#59a8ff', height: 8, width: 8 }} />negative</span>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function drawNetwork(ctx: CanvasRenderingContext2D, w: number, h: number, edges: { l: number; i: number; j: number; w: number }[]) {
  const padX = 92, padY = 22;
  const colX = SIZES.map((_, k) => padX + (k * (w - padX * 2)) / (SIZES.length - 1));
  const pos = (l: number, i: number) => {
    const n = SIZES[l];
    const gap = l === 0 ? 15 : l === 4 ? 70 : 7.4;
    const span = Math.min(h - padY * 2 - 10, n * gap);
    return [colX[l], h / 2 - span / 2 + (n === 1 ? span / 2 : (i * span) / (n - 1))];
  };
  const acts = net.acts;
  // edges: signal = w * a_src
  ctx.lineWidth = 1;
  for (const e of edges) {
    const a = acts[e.l][e.i];
    const sgl = e.w * a;
    const m = Math.min(1, Math.abs(sgl) * 0.9);
    if (m < 0.04) continue;
    const [x0, y0] = pos(e.l, e.i);
    const [x1, y1] = pos(e.l + 1, e.j);
    ctx.strokeStyle = sgl > 0 ? `rgba(255,107,26,${m * 0.42})` : `rgba(89,168,255,${m * 0.42})`;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }
  // neurons
  for (let l = 0; l < SIZES.length; l++) {
    for (let i = 0; i < SIZES[l]; i++) {
      const [x, y] = pos(l, i);
      let a = acts[l][i];
      if (l === 0) a = Math.tanh(a / 2);
      if (l === SIZES.length - 1) a = Math.tanh(a);
      const m = Math.min(1, Math.abs(a));
      const r = l === 4 ? 6 : l === 0 ? 3.4 : 2.8;
      ctx.fillStyle = '#0b0e11';
      ctx.beginPath(); ctx.arc(x, y, r + 1.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = a > 0 ? `rgba(255,107,26,${0.15 + m * 0.85})` : `rgba(89,168,255,${0.15 + m * 0.85})`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.font = '9px "IBM Plex Mono", monospace';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  for (let i = 0; i < 24; i++) {
    const [x, y] = pos(0, i);
    const step = Math.floor(i / 6);
    ctx.fillStyle = i % 6 === 0 ? '#a3adb7' : '#5a6570';
    ctx.fillText(`${FEATURE_NAMES[i % 6]}${step < 3 ? `[k−${3 - step}]` : '[k]'}`, x - 9, y);
  }
  ctx.textAlign = 'left';
  const outs = ['τ̂_φ DAGE', 'â_GE'];
  for (let i = 0; i < 2; i++) {
    const [x, y] = pos(4, i);
    ctx.fillStyle = '#e8ecef';
    ctx.fillText(outs[i], x + 12, y);
  }
  ctx.textAlign = 'center';
  ctx.fillStyle = '#4a545e';
  const titles = ['input 24', 'dense 64 · tanh', 'dense 64 · tanh', 'dense 32 · tanh', 'linear 2'];
  titles.forEach((t, k) => ctx.fillText(t, colX[k], h - 8));
}

function drawInputs(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const a0 = net.acts[0];
  const L = 44, T = 18, B = 6;
  const cw = (w - L - 8) / 4;
  const chh = (h - T - B) / 6;
  ctx.font = '9px "IBM Plex Mono", monospace';
  ctx.textBaseline = 'middle';
  for (let s = 0; s < 4; s++) {
    ctx.fillStyle = '#5a6570';
    ctx.textAlign = 'center';
    ctx.fillText(s === 3 ? 'k' : `k−${3 - s}`, L + cw * (s + 0.5), 8);
    for (let f = 0; f < 6; f++) {
      const v = a0[s * 6 + f];
      const m = Math.min(1, Math.abs(v) / 3);
      ctx.fillStyle = v > 0 ? `rgba(255,107,26,${0.08 + m * 0.75})` : `rgba(89,168,255,${0.08 + m * 0.75})`;
      ctx.fillRect(L + cw * s + 1, T + chh * f + 1, cw - 2, chh - 2);
      ctx.fillStyle = m > 0.55 ? '#fff' : '#a3adb7';
      ctx.fillText(v.toFixed(2), L + cw * (s + 0.5), T + chh * (f + 0.5));
    }
  }
  ctx.textAlign = 'right';
  for (let f = 0; f < 6; f++) {
    ctx.fillStyle = '#a3adb7';
    ctx.fillText(FEATURE_NAMES[f], L - 8, T + chh * (f + 0.5));
  }
}

function WeightMap({ idx }: { idx: number }) {
  const L = net.layers[idx];
  const cell = idx === 3 ? 6 : 3;
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!;
    cv.width = L.nOut * cell;
    cv.height = L.nIn * cell;
    const ctx = cv.getContext('2d')!;
    let m = 0;
    for (const v of L.W) m = Math.max(m, Math.abs(v));
    for (let i = 0; i < L.nIn; i++) for (let j = 0; j < L.nOut; j++) {
      const v = L.W[i * L.nOut + j] / m;
      const a = Math.min(1, Math.abs(v) * 1.6);
      ctx.fillStyle = v > 0 ? `rgba(255,107,26,${a})` : `rgba(89,168,255,${a})`;
      ctx.fillRect(j * cell, i * cell, cell, cell);
    }
  }, [L, cell]);
  return (
    <div>
      <canvas ref={ref} style={{ display: 'block', background: '#07090b', border: '1px solid var(--line-2)', imageRendering: 'pixelated' }} />
      <div className="fig-cap">W{idx} · {L.nIn}×{L.nOut} · {(L.W.length + L.b.length).toLocaleString()} params</div>
    </div>
  );
}

function Parity({ mode }: { mode: 'open' | 'closed' }) {
  const data = useMemo(() => {
    const pts: { t: number; p: number; ood: boolean }[] = [];
    const speeds = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5];
    for (const vp of speeds) for (let s = 0; s < 2; s++) {
      const tr = new Trial({ controller: mode === 'open' ? 'PID' : 'Res-G', vp, seed: 400 + s * 7 + vp * 10, mismatch: false, kappa: 1, d0Scale: 1 }, net, true, true);
      while (tr.advance());
      const h = tr.hist!;
      for (let i = 4; i < tr.step; i += 6) pts.push({ t: h.tauTrue[i], p: h.tauHat[i], ood: tr.plant.vp > MAX_TRAIN_SPEED });
    }
    const r2 = (arr: typeof pts) => {
      const mean = arr.reduce((a, b) => a + b.t, 0) / arr.length;
      const ssr = arr.reduce((a, b) => a + (b.t - b.p) ** 2, 0);
      const sst = arr.reduce((a, b) => a + (b.t - mean) ** 2, 0);
      return { r2: 1 - ssr / sst, rmse: Math.sqrt(ssr / arr.length) };
    };
    return { pts, id: r2(pts.filter((p) => !p.ood)), ood: r2(pts.filter((p) => p.ood)) };
  }, [mode]);
  const { ref, redraw } = useCanvas(({ ctx, w, h }) => {
    const L = 44, R = 10, T = 10, B = 30;
    let lo = Infinity, hi = -Infinity;
    for (const p of data.pts) { lo = Math.min(lo, p.t, p.p); hi = Math.max(hi, p.t, p.p); }
    const pad = (hi - lo) * 0.05;
    lo -= pad; hi += pad;
    const pw = w - L - R, ph = h - T - B;
    const X = (v: number) => L + ((v - lo) / (hi - lo)) * pw;
    const Y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * ph;
    ctx.strokeStyle = '#242c35';
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(X(lo), Y(lo)); ctx.lineTo(X(hi), Y(hi)); ctx.stroke();
    ctx.setLineDash([]);
    for (const p of data.pts) {
      ctx.fillStyle = p.ood ? 'rgba(245,184,61,0.55)' : 'rgba(89,168,255,0.45)';
      ctx.fillRect(X(p.t) - 1.2, Y(p.p) - 1.2, 2.4, 2.4);
    }
    ctx.font = '9px "IBM Plex Mono", monospace';
    ctx.fillStyle = '#5a6570';
    ctx.textAlign = 'center';
    ctx.fillText('τ true (N·m)', L + pw / 2, h - 4);
    for (let k = 0; k <= 4; k++) {
      const v = lo + ((hi - lo) * k) / 4;
      ctx.fillText(v.toFixed(2), X(v), T + ph + 13);
      ctx.textAlign = 'right';
      ctx.fillText(v.toFixed(2), L - 5, Y(v) + 3);
      ctx.textAlign = 'center';
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(89,168,255,0.9)';
    ctx.fillText(`in-dist  R² ${data.id.r2.toFixed(3)}  RMSE ${data.id.rmse.toFixed(4)}`, L + 8, T + 10);
    ctx.fillStyle = 'rgba(245,184,61,0.95)';
    ctx.fillText(`OOD>4m/s R² ${data.ood.r2.toFixed(3)}  RMSE ${data.ood.rmse.toFixed(4)}`, L + 8, T + 24);
  });
  useEffect(() => { redraw(); }, [redraw, data]);
  return <div className="chart-wrap"><canvas ref={ref} /></div>;
}

function TrainingCurve() {
  const W = 420, H = 290, L = 46, R = 12, T = 12, B = 32;
  const d = trainingCurves;
  const lo = Math.log10(0.0018), hi = Math.log10(0.06);
  const X = (e: number) => L + ((e - 1) / (d.length - 1)) * (W - L - R);
  const Y = (v: number) => T + (1 - (Math.log10(v) - lo) / (hi - lo)) * (H - T - B);
  const best = d.reduce((a, b) => (b.val < a.val ? b : a));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" style={{ display: 'block' }}>
      {[0.002, 0.005, 0.01, 0.02, 0.05].map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="#151b21" />
          <text x={L - 6} y={Y(v) + 3} fill="#5a6570" fontSize={9} textAnchor="end" fontFamily="IBM Plex Mono">{v}</text>
        </g>
      ))}
      {[1, 10, 20, 30, 38].map((e) => <text key={e} x={X(e)} y={H - 16} fill="#5a6570" fontSize={9} textAnchor="middle" fontFamily="IBM Plex Mono">{e}</text>)}
      <text x={(L + W - R) / 2} y={H - 3} fill="#5a6570" fontSize={9} textAnchor="middle" fontFamily="IBM Plex Mono">epoch</text>
      <rect x={X(best.epoch)} y={T} width={X(38) - X(best.epoch)} height={H - T - B} fill="rgba(255,255,255,0.025)" />
      <line x1={X(best.epoch)} x2={X(best.epoch)} y1={T} y2={H - B} stroke="#3dd68c" strokeDasharray="3 3" />
      <text x={X(best.epoch) - 4} y={T + 10} fill="#3dd68c" fontSize={9} textAnchor="end" fontFamily="IBM Plex Mono">best ep {best.epoch}</text>
      <text x={X(38) - 2} y={T + 22} fill="#6f7b87" fontSize={9} textAnchor="end" fontFamily="IBM Plex Mono">patience</text>
      <polyline points={d.map((p) => `${X(p.epoch)},${Y(p.train)}`).join(' ')} fill="none" stroke="#e8ecef" strokeWidth={1.6} />
      <polyline points={d.map((p) => `${X(p.epoch)},${Y(p.val)}`).join(' ')} fill="none" stroke="#ff6b1a" strokeWidth={1.6} />
      <g fontFamily="IBM Plex Mono" fontSize={9}>
        <rect x={W - R - 96} y={T + 40} width={8} height={2} fill="#e8ecef" /><text x={W - R - 84} y={T + 44} fill="#a3adb7">train</text>
        <rect x={W - R - 96} y={T + 54} width={8} height={2} fill="#ff6b1a" /><text x={W - R - 84} y={T + 58} fill="#a3adb7">validation</text>
      </g>
    </svg>
  );
}
