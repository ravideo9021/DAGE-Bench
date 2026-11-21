import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Play, Square } from 'lucide-react';
import { campaign, cellStats, workerCount, FIELDS, type McCell } from '../engine/montecarlo';
import { CONTROLLERS, CONTROLLER_INFO, type ControllerId } from '../sim/trial';
import { ENVELOPE, MAX_TRAIN_SPEED } from '../sim/physics';
import { COLORS } from '../engine/flight';
import { evaluationResults, mismatchResults } from '../data/results';
import { Panel, Field, Seg, Slider, Toggle, Readout } from '../ui/kit';
import { useCanvas, useTicker } from '../ui/hooks';

const SPEED_OPTS = [0, 1.5, 3, 4, 5, 6, 7];

function useCampaign() {
  return useSyncExternalStore((cb) => campaign.subscribe(cb), () => `${campaign.trialsDone}:${campaign.running}:${campaign.cells.length}`);
}

function paperRef(vp: number, c: ControllerId, mismatch: boolean): number | undefined {
  const rows = mismatch ? mismatchResults : evaluationResults;
  return rows.find((r) => Math.abs(r.vp - vp) < 1e-6 && r.controller === c)?.envelope_pct;
}

export default function MonteCarloView() {
  useCampaign();
  useTicker(4, campaign.running);
  const [speeds, setSpeeds] = useState<number[]>(campaign.settings?.speeds ?? [0, 1.5, 3, 5, 6]);
  const [ctrls, setCtrls] = useState<ControllerId[]>(campaign.settings?.controllers ?? [...CONTROLLERS]);
  const [nTrials, setN] = useState(campaign.settings?.nTrials ?? 100);
  const [mismatch, setMismatch] = useState(campaign.settings?.mismatch ?? false);
  const [kappa, setKappa] = useState(1);
  const [d0s, setD0s] = useState(1);
  const [sel, setSel] = useState<number | null>(null);

  const run = () => campaign.start({ speeds: [...speeds].sort((a, b) => a - b), controllers: CONTROLLERS.filter((c) => ctrls.includes(c)), nTrials, mismatch, kappa, d0Scale: d0s });

  useEffect(() => {
    if (!campaign.cells.length && !campaign.running) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const s = campaign.settings;
  const cells = campaign.cells;
  const el = campaign.elapsed();
  const rate = el > 0 ? campaign.trialsDone / el : 0;
  const nRes = ctrls.filter((c) => c.startsWith('Res')).length;
  const estS = (speeds.length * ((ctrls.length - nRes) * 0.8 + nRes * 14) * nTrials) / 1000 / workerCount();

  return (
    <div className="view-scroll">
      <div className="section-title">
        <h1>Monte Carlo campaign</h1>
        <p>Thousands of randomised landings run in parallel browser threads on the same simulator and network weights as the Python benchmark. Each cell is checked against the published table.</p>
      </div>

      <div className="stat-strip" style={{ marginBottom: 10 }}>
        <div><Readout label="Trials" value={`${campaign.trialsDone.toLocaleString()}`} unit={`/ ${campaign.trialsTotal.toLocaleString()}`} /></div>
        <div><Readout label="Throughput" value={rate ? rate.toFixed(0) : '—'} unit="trials/s" /></div>
        <div><Readout label="Simulated flight" value={(campaign.simSeconds / 60).toFixed(1)} unit="min" /></div>
        <div><Readout label="NN inferences" value={campaign.inferences > 1e6 ? (campaign.inferences / 1e6).toFixed(2) + 'M' : campaign.inferences.toLocaleString()} /></div>
        <div><Readout label="Wall clock" value={el.toFixed(1)} unit="s" /></div>
        <div><Readout label="Execution" value={campaign.mode === 'workers' ? `${workerCount()}× worker` : 'main thread'} color={campaign.running ? 'var(--signal)' : undefined} /></div>
      </div>

      <div className="grid g-side">
        <Panel tag="MC-CFG" title="Campaign setup">
          <Field label="Platform speeds (m/s)">
            <div className="seg" style={{ gridAutoColumns: '1fr' }}>
              {SPEED_OPTS.map((v) => (
                <button key={v} type="button" aria-pressed={speeds.includes(v)} onClick={() => setSpeeds((x) => (x.includes(v) ? x.filter((y) => y !== v) : [...x, v]))}>
                  {v}{v > MAX_TRAIN_SPEED ? '*' : ''}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Controllers">
            <div className="ctl-list">
              {CONTROLLERS.map((c) => (
                <button key={c} type="button" className="ctl-opt" style={{ padding: '6px 10px' }} aria-pressed={ctrls.includes(c)} onClick={() => setCtrls((x) => (x.includes(c) ? x.filter((y) => y !== c) : [...x, c]))}>
                  <span className="sw" style={{ background: ctrls.includes(c) ? COLORS[c] : 'transparent', border: `1px solid ${COLORS[c]}` }} />
                  <span className="nm">{CONTROLLER_INFO[c].name}</span>
                  <span className="id">{c}</span>
                </button>
              ))}
            </div>
          </Field>
          <Field label="Trials per cell" value={nTrials}>
            <Seg options={[50, 100, 250, 500].map((v) => ({ value: v, label: v }))} value={nTrials} onChange={setN} label="Trials per cell" />
          </Field>
          <div className="field"><Toggle checked={mismatch} onChange={setMismatch} label="Disturbance-model mismatch" desc="Reproduces Table IV conditions" /></div>
          <Field label="Gate κ" value={kappa.toFixed(1)}><Slider min={0.2} max={3} step={0.1} value={kappa} onChange={setKappa} label="kappa" /></Field>
          <Field label="Gate d₀ scale" value={d0s.toFixed(2)}><Slider min={0.4} max={1.4} step={0.05} value={d0s} onChange={setD0s} label="d0 scale" /></Field>
          <div className="field" style={{ marginTop: 18 }}>
            {campaign.running ? (
              <button type="button" className="btn" onClick={() => campaign.abort()}><Square size={12} /> Abort campaign</button>
            ) : (
              <button type="button" className="btn signal" disabled={!speeds.length || !ctrls.length} onClick={run}><Play size={13} /> Launch {(speeds.length * ctrls.length * nTrials).toLocaleString()} trials</button>
            )}
            <div className="field-hint">Seeds 100…{99 + nTrials}, the same protocol as the paper. Estimated ≈ {estS < 60 ? `${Math.max(1, Math.round(estS))} s` : `${(estS / 60).toFixed(1)} min`} on this machine.</div>
          </div>
        </Panel>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
          <Panel tag="MC-MTX" title={`Envelope success rate · Wilson 95% CI${s?.mismatch ? ' · mismatch' : ''}`}
            right={<span className="mono" style={{ fontSize: 10, color: 'var(--text-3)' }}>Grey figure = paper</span>}>
            {s && <Matrix cells={cells} speeds={s.speeds} controllers={s.controllers} mismatch={s.mismatch} sel={sel} setSel={setSel} />}
          </Panel>
          <div className="grid g-2">
            <Panel tag="MC-SCT" title="Touchdown states" className="chart-panel" style={{ height: 360 }}
              right={<span className="mono" style={{ fontSize: 10, color: 'var(--text-3)' }}>{sel !== null && cells[sel] ? `${cells[sel].controller} @ ${cells[sel].vp} m/s` : 'All cells'}</span>}>
              <Scatter cells={cells} sel={sel} />
            </Panel>
            <Panel tag="MC-CRV" title="Success vs platform speed" className="chart-panel" style={{ height: 360 }}>
              {s && <SpeedCurve cells={cells} speeds={s.speeds} controllers={s.controllers} />}
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}

function Matrix({ cells, speeds, controllers, mismatch, sel, setSel }: { cells: McCell[]; speeds: number[]; controllers: ControllerId[]; mismatch: boolean; sel: number | null; setSel: (n: number | null) => void }) {
  return (
    <div className="matrix" style={{ gridTemplateColumns: `130px repeat(${speeds.length}, minmax(0, 1fr))` }}>
      <div />
      {speeds.map((v) => (
        <div key={v} className="mx-h">v_p {v.toFixed(1)} {v > MAX_TRAIN_SPEED && <span className="badge warn" style={{ marginLeft: 6, height: 15 }}>OOD</span>}</div>
      ))}
      {controllers.map((c) => (
        <Row key={c} c={c} speeds={speeds} cells={cells} mismatch={mismatch} sel={sel} setSel={setSel} />
      ))}
    </div>
  );
}

function Row({ c, speeds, cells, mismatch, sel, setSel }: { c: ControllerId; speeds: number[]; cells: McCell[]; mismatch: boolean; sel: number | null; setSel: (n: number | null) => void }) {
  return (
    <>
      <div className="mx-rh"><span style={{ width: 8, height: 8, background: COLORS[c], borderRadius: 2 }} />{c}</div>
      {speeds.map((vp) => {
        const idx = cells.findIndex((x) => x.controller === c && x.vp === vp);
        const cell = cells[idx];
        if (!cell) return <div key={vp} />;
        const st = cellStats(cell);
        const ref = paperRef(vp, c, mismatch);
        const col = st.rate >= 0.99 ? 'var(--ok)' : st.rate >= 0.8 ? 'var(--warn)' : 'var(--crit)';
        const tint = st.rate >= 0.99 ? 'rgba(61,214,140,0.05)' : st.rate >= 0.8 ? 'rgba(245,184,61,0.07)' : 'rgba(255,77,79,0.08)';
        const agrees = ref !== undefined && cell.done === cell.n ? ref / 100 >= st.lo - 0.005 && ref / 100 <= st.hi + 0.005 : null;
        return (
          <button key={vp} type="button" className="mx-cell" aria-pressed={sel === idx} onClick={() => setSel(sel === idx ? null : idx)} style={{ background: cell.done ? tint : undefined }}>
            <div className="pv" style={{ color: cell.done ? col : 'var(--text-4)' }}>{cell.done ? (st.rate * 100).toFixed(1) : '—'}<small>%</small></div>
            <div className="ci">{cell.done ? `[${(st.lo * 100).toFixed(1)}, ${(st.hi * 100).toFixed(1)}]` : 'queued'}</div>
            <div className="cibar">
              <i style={{ left: `${st.lo * 100}%`, width: `${(st.hi - st.lo) * 100}%`, background: col, opacity: 0.5 }} />
              {ref !== undefined && <em style={{ left: `calc(${ref}% - 1px)` }} />}
            </div>
            <div className="ref">
              {ref !== undefined ? `${ref.toFixed(1)}%` : ''}
              {agrees !== null && <><br /><span style={{ color: agrees ? 'var(--ok)' : 'var(--warn)' }}>{agrees ? '✓ in CI' : 'Δ'}</span></>}
            </div>
            <div className="prog" style={{ width: cell.done < cell.n ? `${(cell.done / cell.n) * 100}%` : 0 }} />
          </button>
        );
      })}
    </>
  );
}

function Scatter({ cells, sel }: { cells: McCell[]; sel: number | null }) {
  const { ref, redraw } = useCanvas(({ ctx, w, h }) => {
    const L = 46, R = 12, T = 12, B = 30;
    const pw = w - L - R, ph = h - T - B;
    const xMax = 0.3, yMax = 2.0;
    const X = (v: number) => L + Math.min(1, v / xMax) * pw;
    const Y = (v: number) => T + (1 - Math.min(1, v / yMax)) * ph;
    ctx.fillStyle = 'rgba(61,214,140,0.06)';
    ctx.fillRect(X(0), Y(ENVELOPE.dvy_max), X(ENVELOPE.phi_max) - X(0), Y(0) - Y(ENVELOPE.dvy_max));
    ctx.strokeStyle = 'rgba(61,214,140,0.55)';
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(X(0) + 0.5, Y(ENVELOPE.dvy_max) + 0.5, X(ENVELOPE.phi_max) - X(0), Y(0) - Y(ENVELOPE.dvy_max));
    ctx.setLineDash([]);
    ctx.font = '9px "IBM Plex Mono", monospace';
    ctx.fillStyle = 'rgba(61,214,140,0.8)';
    ctx.fillText('SAFE ENVELOPE', X(0) + 6, Y(ENVELOPE.dvy_max) + 13);
    ctx.fillStyle = '#5a6570';
    ctx.textAlign = 'center';
    for (let v = 0; v <= xMax + 1e-9; v += 0.05) {
      ctx.strokeStyle = '#151b21';
      ctx.beginPath(); ctx.moveTo(X(v) + 0.5, T); ctx.lineTo(X(v) + 0.5, T + ph); ctx.stroke();
      ctx.fillText(v.toFixed(2), X(v), T + ph + 13);
    }
    ctx.fillText('peak |φ| on final approach (rad)', L + pw / 2, h - 4);
    ctx.textAlign = 'right';
    for (let v = 0; v <= yMax + 1e-9; v += 0.5) {
      ctx.strokeStyle = '#151b21';
      ctx.beginPath(); ctx.moveTo(L, Y(v) + 0.5); ctx.lineTo(L + pw, Y(v) + 0.5); ctx.stroke();
      ctx.fillText(v.toFixed(1), L - 6, Y(v) + 3);
    }
    ctx.save();
    ctx.translate(11, T + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('|Δv_y| at touchdown (m/s)', 0, 0);
    ctx.restore();
    const order = cells.map((_, i) => i).filter((i) => i !== sel);
    if (sel !== null) order.push(sel);
    for (const ci of order) {
      const c = cells[ci];
      const dim = sel !== null && ci !== sel;
      ctx.fillStyle = COLORS[c.controller];
      ctx.globalAlpha = dim ? 0.06 : sel !== null ? 0.85 : 0.45;
      for (let i = 0; i < c.n; i++) {
        const o = i * FIELDS;
        if (!(c.data[o + 6] > 0)) continue;
        const x = X(c.data[o]);
        const y = Y(c.data[o + 1]);
        ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
      }
    }
    ctx.globalAlpha = 1;
  });
  const v = useSyncExternalStore((cb) => campaign.subscribe(cb), () => campaign.trialsDone);
  useEffect(() => { const id = requestAnimationFrame(redraw); return () => cancelAnimationFrame(id); }, [v, sel, redraw]);
  return <div className="chart-wrap"><canvas ref={ref} /></div>;
}

function SpeedCurve({ cells, speeds, controllers }: { cells: McCell[]; speeds: number[]; controllers: ControllerId[] }) {
  const W = 520, H = 300, L = 40, R = 14, T = 14, B = 30;
  const xs = useMemo(() => [Math.min(...speeds), Math.max(...speeds)], [speeds]);
  const X = (v: number) => L + ((v - xs[0]) / Math.max(1e-6, xs[1] - xs[0])) * (W - L - R);
  const Y = (p: number) => T + (1 - p) * (H - T - B);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" style={{ display: "block" }}>
      {xs[1] > MAX_TRAIN_SPEED && (
        <rect x={X(Math.max(MAX_TRAIN_SPEED, xs[0]))} y={T} width={X(xs[1]) - X(Math.max(MAX_TRAIN_SPEED, xs[0]))} height={H - T - B} fill="rgba(245,184,61,0.05)" />
      )}
      {[0, 0.25, 0.5, 0.75, 1].map((p) => (
        <g key={p}>
          <line x1={L} x2={W - R} y1={Y(p)} y2={Y(p)} stroke="#151b21" />
          <text x={L - 6} y={Y(p) + 3} fill="#5a6570" fontSize={9} textAnchor="end" fontFamily="IBM Plex Mono">{p * 100}%</text>
        </g>
      ))}
      {speeds.map((v) => (
        <text key={v} x={X(v)} y={H - 12} fill="#5a6570" fontSize={9} textAnchor="middle" fontFamily="IBM Plex Mono">{v}</text>
      ))}
      <text x={(L + W - R) / 2} y={H - 1} fill="#5a6570" fontSize={9} textAnchor="middle" fontFamily="IBM Plex Mono">platform speed v_p (m/s)</text>
      {xs[1] > MAX_TRAIN_SPEED && <text x={X(Math.max(MAX_TRAIN_SPEED, xs[0])) + 5} y={H - B - 6} fill="#f5b83d" fontSize={9} fontFamily="IBM Plex Mono">OUT OF DISTRIBUTION</text>}
      {controllers.map((c) => {
        const pts = speeds.map((v) => {
          const cell = cells.find((x) => x.controller === c && x.vp === v);
          return cell && cell.done ? { v, ...cellStats(cell) } : null;
        }).filter(Boolean) as ({ v: number } & ReturnType<typeof cellStats>)[];
        if (!pts.length) return null;
        const band = pts.map((p) => `${X(p.v)},${Y(p.hi)}`).join(' ') + ' ' + [...pts].reverse().map((p) => `${X(p.v)},${Y(p.lo)}`).join(' ');
        return (
          <g key={c}>
            <polygon points={band} fill={COLORS[c]} opacity={0.12} />
            <polyline points={pts.map((p) => `${X(p.v)},${Y(p.rate)}`).join(' ')} fill="none" stroke={COLORS[c]} strokeWidth={c === 'Res-G' ? 2.2 : 1.4} vectorEffect="non-scaling-stroke" />
            {pts.map((p) => <circle key={p.v} cx={X(p.v)} cy={Y(p.rate)} r={2.6} fill={COLORS[c]} />)}
          </g>
        );
      })}
    </svg>
  );
}
