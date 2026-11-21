import type { Trial } from '../../sim/trial';
import { ENVELOPE, SIM } from '../../sim/physics';
import { getNetwork } from '../../sim/network';
import { featureLabel } from '../../engine/flight';

const DEG = 57.29578;
const AMP = 5; // visual amplification of roll on the ADI

export function Attitude({ tr }: { tr: Trial }) {
  const phi = tr.state[4] * DEG;
  const des = tr.phiDes * DEG;
  const lim = ENVELOPE.phi_max * DEG;
  const R = 74;
  const cx = 100, cy = 92;
  const ang = (d: number) => Math.max(-80, Math.min(80, d * AMP));
  const pt = (d: number, r: number) => {
    const a = ((ang(d) - 90) * Math.PI) / 180;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  };
  const arc = (d0: number, d1: number, r: number) => {
    const [x0, y0] = pt(d0, r);
    const [x1, y1] = pt(d1, r);
    return `M${x0},${y0} A${r},${r} 0 0 1 ${x1},${y1}`;
  };
  const ticks = [-15, -10, -5, 0, 5, 10, 15];
  const over = Math.abs(phi) > lim && tr.state[0] < ENVELOPE.final_approach_z;
  return (
    <svg viewBox="0 0 200 150" width="100%" style={{ display: 'block' }} role="img" aria-label={`Roll ${phi.toFixed(2)} degrees`}>
      <defs>
        <clipPath id="adi-clip"><circle cx={cx} cy={cy} r={R - 12} /></clipPath>
      </defs>
      <g clipPath="url(#adi-clip)">
        <g transform={`rotate(${-ang(phi)} ${cx} ${cy})`}>
          <rect x={cx - 120} y={cy - 120} width={240} height={120} fill="#122233" />
          <rect x={cx - 120} y={cy} width={240} height={120} fill="#1d1712" />
          <line x1={cx - 120} y1={cy} x2={cx + 120} y2={cy} stroke="#e8ecef" strokeWidth={1.2} />
          {[-20, -10, 10, 20].map((p) => (
            <line key={p} x1={cx - (Math.abs(p) === 10 ? 16 : 26)} x2={cx + (Math.abs(p) === 10 ? 16 : 26)} y1={cy + p} y2={cy + p} stroke="rgba(232,236,239,0.35)" strokeWidth={1} />
          ))}
        </g>
      </g>
      <circle cx={cx} cy={cy} r={R - 12} fill="none" stroke="#242c35" />
      {/* envelope zones */}
      <path d={arc(-80 / AMP, -lim, R)} stroke="rgba(255,77,79,0.55)" strokeWidth={4} fill="none" />
      <path d={arc(lim, 80 / AMP, R)} stroke="rgba(255,77,79,0.55)" strokeWidth={4} fill="none" />
      <path d={arc(-lim, lim, R)} stroke="rgba(61,214,140,0.45)" strokeWidth={4} fill="none" />
      {ticks.map((d) => {
        const [x0, y0] = pt(d, R + 3);
        const [x1, y1] = pt(d, R + (d % 10 === 0 ? 10 : 7));
        const [tx, ty] = pt(d, R + 18);
        return (
          <g key={d}>
            <line x1={x0} y1={y0} x2={x1} y2={y1} stroke="#6f7b87" strokeWidth={1} />
            {d % 5 === 0 && <text x={tx} y={ty + 3} fill="#6f7b87" fontSize={8} textAnchor="middle" fontFamily="IBM Plex Mono">{Math.abs(d)}</text>}
          </g>
        );
      })}
      {/* roll command bug */}
      {(() => {
        const [x, y] = pt(des, R - 5);
        return <circle cx={x} cy={y} r={3} fill="none" stroke="#59a8ff" strokeWidth={1.5} />;
      })()}
      {/* pointer */}
      <g transform={`rotate(${ang(phi)} ${cx} ${cy})`}>
        <path d={`M${cx},${cy - R + 2} l-6,10 h12 z`} fill={over ? '#ff4d4f' : '#ff6b1a'} />
      </g>
      {/* aircraft symbol */}
      <path d={`M${cx - 34},${cy} h22 l6,6 l6,-6 h22`} stroke="#ff6b1a" strokeWidth={2.4} fill="none" strokeLinejoin="round" />
      <circle cx={cx} cy={cy} r={2} fill="#ff6b1a" />
      <text x={6} y={146} fill="#4a545e" fontSize={8} fontFamily="IBM Plex Mono">ROLL ×{AMP} SCALE · °</text>
      <text x={194} y={146} fill="#4a545e" fontSize={8} fontFamily="IBM Plex Mono" textAnchor="end">○ φ_des</text>
    </svg>
  );
}

export function AltTape({ tr }: { tr: Trial }) {
  const z = Math.max(0, tr.state[0]);
  const zRef = Math.max(0, SIM.z0 - SIM.v_des * tr.t);
  const H = 150, top = 8, bot = 142;
  const Y = (v: number) => bot - (v / 4.2) * (bot - top);
  return (
    <svg viewBox="0 0 64 150" width="64" height="150" style={{ display: 'block', flex: 'none' }} role="img" aria-label={`Altitude ${z.toFixed(2)} metres`}>
      <rect x={20} y={top} width={14} height={bot - top} fill="#0e1216" stroke="#242c35" />
      <rect x={20} y={Y(tr.plant.R_z)} width={14} height={bot - Y(tr.plant.R_z)} fill="rgba(245,184,61,0.18)" />
      <line x1={18} x2={36} y1={Y(1)} y2={Y(1)} stroke="#59a8ff" strokeDasharray="2 2" />
      {[0, 1, 2, 3, 4].map((m) => (
        <g key={m}>
          <line x1={34} x2={40} y1={Y(m)} y2={Y(m)} stroke="#4a545e" />
          <text x={44} y={Y(m) + 3} fill="#6f7b87" fontSize={8} fontFamily="IBM Plex Mono">{m}</text>
        </g>
      ))}
      <rect x={21} y={Y(z)} width={12} height={bot - Y(z)} fill="rgba(232,236,239,0.12)" />
      <path d={`M14,${Y(zRef) - 4} l6,4 l-6,4 z`} fill="#59a8ff" />
      <path d={`M20,${Y(z)} h14`} stroke="#ff6b1a" strokeWidth={2} />
      <text x={2} y={H - 1} fill="#4a545e" fontSize={7.5} fontFamily="IBM Plex Mono">m</text>
    </svg>
  );
}

export function GateMonitor({ tr }: { tr: Trial }) {
  const net = getNetwork();
  const isRes = tr.cfg.controller === 'Res-G' || tr.cfg.controller === 'Res-NG';
  const gated = tr.cfg.controller === 'Res-G';
  const d0 = net.d0 * tr.cfg.d0Scale;
  const dMax = Math.max(d0 * 2, 10);
  const sigma = tr.sigma;
  const col = !isRes ? '#4a545e' : sigma > 0.98 ? '#3dd68c' : sigma > 0.8 ? '#f5b83d' : '#ff4d4f';
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 8 }}>
        <div className="readout">
          <span className="rl">σ gate weight</span>
          <span className="rv" style={{ color: col, fontSize: 26 }}>{isRes ? (gated ? sigma.toFixed(3) : '1.000') : '—'}</span>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span className={`badge ${!isRes ? '' : !gated ? 'warn' : sigma > 0.98 ? 'ok' : 'warn'}`}>
            {!isRes ? 'Not fitted' : !gated ? 'Ungated' : sigma > 0.98 ? 'In distribution' : 'Attenuating'}
          </span>
        </div>
      </div>
      <div className="meter" style={{ marginBottom: 12 }}><i style={{ width: `${(isRes ? (gated ? sigma : 1) : 0) * 100}%`, background: col }} /></div>
      <div className="field-l" style={{ marginBottom: 5 }}><span>d(x) Chebyshev dist.</span><b>{isRes ? tr.d.toFixed(2) : '—'} <span style={{ color: 'var(--text-3)', fontSize: 10 }}>/ d₀ {d0.toFixed(2)}</span></b></div>
      <div className="meter">
        <i style={{ width: `${Math.min(1, (isRes ? tr.d : 0) / dMax) * 100}%`, background: tr.d > d0 ? '#f5b83d' : '#a3adb7' }} />
        <em style={{ left: `${(d0 / dMax) * 100}%`, background: '#ff6b1a' }} />
      </div>
      <dl className="kv" style={{ marginTop: 12 }}>
        <dt>OOD driver</dt><dd>{isRes && tr.d > d0 * 0.7 ? featureLabel(tr.dIdx) : '—'}</dd>
        <dt>τ̂ predicted</dt><dd>{isRes ? tr.tauHat.toFixed(4) : '—'}<small>N·m</small></dd>
        <dt>τ true (DAGE)</dt><dd>{tr.trueTau().toFixed(4)}<small>N·m</small></dd>
        <dt>applied −σ·τ̂</dt><dd>{isRes ? (-(gated ? sigma : 1) * tr.tauHat).toFixed(4) : '—'}<small>N·m</small></dd>
      </dl>
    </div>
  );
}

export function EnvelopeCheck({ tr }: { tr: Trial }) {
  const done = tr.done && tr.result;
  const s = tr.state;
  const peak = done ? tr.result!.peakPhi : peakSoFar(tr);
  const rows = [
    { l: 'peak |φ| final appr.', v: peak, max: ENVELOPE.phi_max, unit: 'rad', d: 4 },
    { l: '|v_z| impact', v: done ? tr.result!.vz : Math.abs(s[1]), max: ENVELOPE.vz_max, unit: 'm/s', d: 3 },
    { l: '|Δv_y| slip', v: done ? tr.result!.dvy : Math.abs(s[3]), max: ENVELOPE.dvy_max, unit: 'm/s', d: 3 },
  ];
  return (
    <div>
      {rows.map((r) => {
        const frac = Math.min(1, r.v / (r.max * 2));
        const bad = r.v > r.max;
        const col = bad ? '#ff4d4f' : done ? '#3dd68c' : '#a3adb7';
        return (
          <div className="env-row" key={r.l}>
            <span className="el">{r.l}</span>
            <span className="ev" style={{ color: bad ? '#ff4d4f' : undefined }}>{r.v.toFixed(r.d)} <span style={{ color: 'var(--text-4)' }}>≤ {r.max}</span></span>
            <div className="meter"><i style={{ width: `${frac * 100}%`, background: col }} /><em style={{ left: '50%', background: '#4a545e' }} /></div>
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
