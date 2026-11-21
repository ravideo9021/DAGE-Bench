import { CheckCircle2, XCircle, Circle } from 'lucide-react';
import type { Trial } from '../../sim/trial';
import { ENVELOPE, SIM } from '../../sim/physics';
import { getNetwork } from '../../sim/network';
import { featureLabel } from '../../engine/flight';

const DEG = 57.29578;
const RANGE = 15; // ± degrees shown on the roll dial

/** Semicircular roll dial with the touchdown envelope marked on the track. */
export function RollGauge({ tr }: { tr: Trial }) {
  const phi = tr.state[4] * DEG;
  const des = tr.phiDes * DEG;
  const lim = ENVELOPE.phi_max * DEG;
  const cx = 110, cy = 104, R = 84;
  const ang = (d: number) => (Math.max(-RANGE, Math.min(RANGE, d)) / RANGE) * 90; // −90…90°
  const pt = (d: number, r: number) => {
    const a = ((ang(d) - 90) * Math.PI) / 180;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  };
  const arc = (d0: number, d1: number, r: number) => {
    const [x0, y0] = pt(d0, r);
    const [x1, y1] = pt(d1, r);
    return `M${x0},${y0} A${r},${r} 0 0 1 ${x1},${y1}`;
  };
  const finalApp = tr.state[0] < ENVELOPE.final_approach_z;
  const over = Math.abs(phi) > lim;
  const [kx, ky] = pt(phi, R);
  const [dx, dy] = pt(des, R - 16);
  const valueColor = over && finalApp ? 'var(--crit)' : 'var(--text)';
  return (
    <svg viewBox="0 0 220 128" width="100%" style={{ display: 'block' }} role="img" aria-label={`Roll ${phi.toFixed(2)} degrees`}>
      <path d={arc(-RANGE, RANGE, R)} stroke="var(--fill)" strokeWidth={12} fill="none" strokeLinecap="round" />
      <path d={arc(-lim, lim, R)} stroke="color-mix(in srgb, var(--ok) 55%, transparent)" strokeWidth={12} fill="none" />
      {Math.abs(phi) > 0.05 && <path d={phi >= 0 ? arc(0, phi, R) : arc(phi, 0, R)} stroke={over ? 'var(--warn)' : 'var(--accent)'} strokeWidth={12} fill="none" strokeLinecap="round" />}
      {[-15, -10, -5, 0, 5, 10, 15].map((d) => {
        const [x0, y0] = pt(d, R - 11);
        const [x1, y1] = pt(d, R - 15);
        return <line key={d} x1={x0} y1={y0} x2={x1} y2={y1} stroke="var(--text-4)" strokeWidth={1.5} strokeLinecap="round" />;
      })}
      <circle cx={dx} cy={dy} r={3.2} fill="none" stroke="var(--info)" strokeWidth={1.6} />
      <circle cx={kx} cy={ky} r={8.5} fill="#fff" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))' }} />
      <text x={cx} y={cy - 22} textAnchor="middle" fontSize={30} fontWeight={600} fill={valueColor} style={{ fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>
        {Math.abs(phi) < 0.005 ? '0.00' : phi.toFixed(2).replace('-', '−')}°
      </text>
      <text x={cx} y={cy - 2} textAnchor="middle" fontSize={11.5} fill="var(--text-3)" fontWeight={500}>Roll · limit ±{lim.toFixed(1)}°</text>
      <text x={cx - R} y={cy + 20} textAnchor="middle" fontSize={10.5} fill="var(--text-3)">−15°</text>
      <text x={cx + R} y={cy + 20} textAnchor="middle" fontSize={10.5} fill="var(--text-3)">15°</text>
    </svg>
  );
}

export function AltitudeBar({ tr }: { tr: Trial }) {
  const z = Math.max(0, tr.state[0]);
  const zRef = Math.max(0, SIM.z0 - SIM.v_des * tr.t);
  const H = 104, W = 22, top = 6;
  const Y = (v: number) => top + H - (Math.min(v, 4.2) / 4.2) * H;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <svg width={W + 26} height={H + 12} viewBox={`0 0 ${W + 26} ${H + 12}`} role="img" aria-label={`Altitude ${z.toFixed(2)} metres`}>
        <rect x={0} y={top} width={W} height={H} rx={W / 2} fill="var(--fill)" />
        <clipPath id="alt-clip"><rect x={0} y={top} width={W} height={H} rx={W / 2} /></clipPath>
        <g clipPath="url(#alt-clip)">
          <rect x={0} y={Y(tr.plant.R_z)} width={W} height={top + H - Y(tr.plant.R_z)} fill="color-mix(in srgb, var(--warn) 22%, transparent)" />
          <rect x={0} y={Y(z)} width={W} height={top + H - Y(z)} fill="color-mix(in srgb, var(--accent) 85%, transparent)" />
        </g>
        <path d={`M${W + 3},${Y(zRef)} l6,-4 v8 z`} fill="var(--info)" />
        {[0, 2, 4].map((m) => <text key={m} x={W + 12} y={Y(m) + 4} fontSize={10} fill="var(--text-3)">{m}</text>)}
      </svg>
      <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 500 }}>Altitude</span>
    </div>
  );
}

/** Two concentric rings: outer = gate weight σ, inner = distance d relative to 2·d₀. */
export function GateRings({ tr }: { tr: Trial }) {
  const net = getNetwork();
  const isRes = tr.cfg.controller === 'Res-G' || tr.cfg.controller === 'Res-NG';
  const gated = tr.cfg.controller === 'Res-G';
  const d0 = net.d0 * tr.cfg.d0Scale;
  const sigma = isRes ? (gated ? tr.sigma : 1) : 0;
  const dFrac = isRes ? Math.min(1, tr.d / (2 * d0)) : 0;
  const sCol = !isRes ? 'var(--fill-strong)' : sigma > 0.98 ? 'var(--ok)' : sigma > 0.8 ? 'var(--warn)' : 'var(--crit)';
  const dCol = tr.d > d0 ? 'var(--warn)' : 'var(--info)';
  const ring = (r: number, frac: number, color: string, w: number) => {
    const c = 2 * Math.PI * r;
    return (
      <>
        <circle cx={60} cy={60} r={r} fill="none" stroke={color} strokeOpacity={0.18} strokeWidth={w} />
        <circle cx={60} cy={60} r={r} fill="none" stroke={color} strokeWidth={w} strokeLinecap="round"
          strokeDasharray={`${Math.max(0.001, frac) * c} ${c}`} transform="rotate(-90 60 60)" style={{ transition: 'stroke-dasharray 0.12s linear' }} />
      </>
    );
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <svg width={112} height={112} viewBox="0 0 120 120" role="img" aria-label={`Gate weight ${sigma.toFixed(3)}`} style={{ flex: 'none' }}>
        {ring(50, sigma, sCol, 13)}
        {ring(33, dFrac, dCol, 13)}
        <line x1={60} y1={60 - 33 - 8} x2={60} y2={60 - 33 + 8} stroke="var(--text-3)" strokeWidth={2} transform="rotate(180 60 60)" strokeLinecap="round" />
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
        <div className="readout">
          <span className="rl" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><i style={{ width: 8, height: 8, borderRadius: 4, background: sCol }} />Gate weight σ</span>
          <span className="rv" style={{ fontSize: 20 }}>{isRes ? sigma.toFixed(3) : '—'}</span>
        </div>
        <div className="readout">
          <span className="rl" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><i style={{ width: 8, height: 8, borderRadius: 4, background: dCol }} />Distance from training</span>
          <span className="rv" style={{ fontSize: 20 }}>{isRes ? tr.d.toFixed(2) : '—'}<small>of {d0.toFixed(2)}</small></span>
        </div>
      </div>
    </div>
  );
}

export function GateDetails({ tr }: { tr: Trial }) {
  const isRes = tr.cfg.controller === 'Res-G' || tr.cfg.controller === 'Res-NG';
  const gated = tr.cfg.controller === 'Res-G';
  const d0 = getNetwork().d0 * tr.cfg.d0Scale;
  return (
    <dl className="kv">
      <dt>Predicted torque τ̂</dt><dd>{isRes ? tr.tauHat.toFixed(4) : '—'}<small>N·m</small></dd>
      <dt>Actual DAGE torque</dt><dd>{tr.trueTau().toFixed(4)}<small>N·m</small></dd>
      <dt>Correction applied</dt><dd>{isRes ? (-(gated ? tr.sigma : 1) * tr.tauHat).toFixed(4) : '—'}<small>N·m</small></dd>
      <dt>Furthest input</dt><dd>{isRes && tr.d > d0 * 0.7 ? featureLabel(tr.dIdx) : '—'}</dd>
    </dl>
  );
}

export function EnvelopeCheck({ tr }: { tr: Trial }) {
  const done = tr.done && tr.result;
  const s = tr.state;
  const peak = done ? tr.result!.peakPhi : peakSoFar(tr);
  const rows = [
    { l: 'Peak roll on final approach', v: peak, max: ENVELOPE.phi_max, unit: 'rad', d: 3 },
    { l: 'Sink rate', v: done ? tr.result!.vz : Math.abs(s[1]), max: ENVELOPE.vz_max, unit: 'm/s', d: 2 },
    { l: 'Sideways slip', v: done ? tr.result!.dvy : Math.abs(s[3]), max: ENVELOPE.dvy_max, unit: 'm/s', d: 2 },
  ];
  return (
    <div>
      {rows.map((r) => {
        const frac = Math.min(1, r.v / (r.max * 1.6));
        const bad = r.v > r.max;
        const col = bad ? 'var(--crit)' : done ? 'var(--ok)' : 'var(--accent)';
        const Icon = done ? (bad ? XCircle : CheckCircle2) : Circle;
        return (
          <div className="env-row" key={r.l}>
            <Icon size={18} strokeWidth={2} style={{ color: done ? (bad ? 'var(--crit)' : 'var(--ok)') : bad ? 'var(--crit)' : 'var(--text-4)' }} />
            <span className="el">{r.l}</span>
            <span className="ev" style={{ color: bad ? 'var(--crit)' : undefined }}>{r.v.toFixed(r.d)} <small>/ {r.max} {r.unit}</small></span>
            <div className="meter"><i style={{ width: `${frac * 100}%`, background: col }} /><em style={{ left: `${(1 / 1.6) * 100}%` }} /></div>
          </div>
        );
      })}
    </div>
  );
}

function peakSoFar(tr: Trial): number {
  const h = tr.hist;
  if (!h) return 0;
  let m = 0;
  for (let i = 0; i < tr.step; i++) if (h.z[i] < ENVELOPE.final_approach_z) m = Math.max(m, Math.abs(h.phi[i]));
  return m;
}
