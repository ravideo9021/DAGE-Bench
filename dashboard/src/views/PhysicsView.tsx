import { theme as TH, alpha, FONT, rgbOf } from '../ui/theme';
import { useEffect, useState } from 'react';
import { dageTorque, geAccel, SIM, MISMATCH, MAX_TRAIN_SPEED } from '../sim/physics';
import { Panel, Field, Slider, Seg, Readout } from '../ui/kit';
import { useCanvas } from '../ui/hooks';

interface P { K: number; L: number; lam: number; n: number; A: number; Rz: number }
const NOMINAL: P = { K: SIM.K_phi, L: SIM.L, lam: SIM.lam, n: SIM.decay_exp, A: SIM.A_GE, Rz: SIM.R_z };
const MISM: P = { K: SIM.K_phi * MISMATCH.K_phi_scale, L: SIM.L * MISMATCH.L_scale, lam: MISMATCH.lam, n: MISMATCH.decay_exp, A: SIM.A_GE * MISMATCH.A_GE_scale, Rz: SIM.R_z * MISMATCH.R_z_scale };
const PROFILE_SPEEDS = [1.5, 3, 5, 6];
const PCOL = [TH().info, TH().text2, TH().warn, TH().accent];

/** τ for a vehicle whose inertial lateral speed is `slip`·v_p (slip=1: matched). */
function tau(p: P, z: number, vp: number, slip: number) {
  return dageTorque(Math.max(z, 0.01), slip * vp, vp, 0, p.K, p.L, p.lam, p.n);
}

export default function PhysicsView() {
  const [p, setP] = useState<P>(NOMINAL);
  const [slip, setSlip] = useState(1);
  const [hover, setHover] = useState<{ z: number; vp: number } | null>(null);
  const preset = p === NOMINAL ? 'nom' : p === MISM ? 'mis' : 'custom';
  const upd = (k: keyof P) => (v: number) => setP((q) => ({ ...q, [k]: v }));

  const tauMax = Math.abs(tau(p, 0, 7, slip)) || 1e-6;
  const trainMax = Math.abs(tau(NOMINAL, 0, MAX_TRAIN_SPEED, 1));

  const { ref, redraw } = useCanvas(({ ctx, w, h }) => {
    const L = 46, R = 84, T = 12, B = 34;
    const pw = w - L - R, ph = h - T - B;
    const nx = 140, ny = 90;
    const cw = pw / nx, chh = ph / ny;
    for (let ix = 0; ix < nx; ix++) {
      const vp = ((ix + 0.5) / nx) * 7;
      for (let iy = 0; iy < ny; iy++) {
        const z = (1 - (iy + 0.5) / ny) * 4;
        const v = tau(p, z, vp, slip) / tauMax;
        ctx.fillStyle = cmap(v);
        ctx.fillRect(L + ix * cw, T + iy * chh, cw + 0.6, chh + 0.6);
      }
    }
    // contours of |τ|
    ctx.strokeStyle = alpha(TH().text, 0.22);
    ctx.lineWidth = 1;
    for (const lvl of [0.1, 0.25, 0.5, 0.75]) {
      ctx.beginPath();
      for (let ix = 0; ix <= 140; ix++) {
        const vp = (ix / 140) * 7;
        // solve |τ(z)| = lvl·τmax for z: K·|f|·vp/(1+(z/L)^n) = lvl·τmax
        const base = Math.abs(tau(p, 0, vp, slip));
        if (base < lvl * tauMax) continue;
        const z = p.L * Math.pow(base / (lvl * tauMax) - 1, 1 / p.n);
        if (z > 4) continue;
        const x = L + (vp / 7) * pw;
        const y = T + (1 - z / 4) * ph;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // training boundary
    const xb = L + (MAX_TRAIN_SPEED / 7) * pw;
    ctx.strokeStyle = TH().text;
    ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(xb, T); ctx.lineTo(xb, T + ph); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = `500 11.0px ${FONT}`;
    ctx.fillStyle = TH().text;
    ctx.textAlign = 'right';
    ctx.fillText('Trained', xb - 8, T + 14);
    ctx.textAlign = 'left';
    ctx.fillText('Extrapolated', xb + 8, T + 14);
    // final approach & GE lines
    const yFa = T + (1 - 1 / 4) * ph;
    ctx.strokeStyle = alpha(TH().info, 0.6);
    ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(L, yFa); ctx.lineTo(L + pw, yFa); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = alpha(TH().info, 0.9);
    ctx.fillText('final approach z = 1 m', L + 6, yFa - 5);
    // axes
    ctx.fillStyle = TH().text3;
    ctx.textAlign = 'center';
    for (let v = 0; v <= 7; v++) ctx.fillText(String(v), L + (v / 7) * pw, T + ph + 13);
    ctx.fillText('platform speed v_p (m/s)', L + pw / 2, h - 4);
    ctx.textAlign = 'right';
    for (let z = 0; z <= 4; z++) ctx.fillText(`${z}`, L - 6, T + (1 - z / 4) * ph + 3);
    ctx.save(); ctx.translate(12, T + ph / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText('altitude z (m)', 0, 0); ctx.restore();
    // colour bar
    const bx = L + pw + 22;
    for (let i = 0; i < ph; i++) { ctx.fillStyle = cmap(1 - (2 * i) / ph); ctx.fillRect(bx, T + i, 10, 1.5); }
    ctx.textAlign = 'left';
    ctx.fillStyle = TH().text3;
    ctx.fillText(`+${tauMax.toFixed(2)}`, bx + 14, T + 6);
    ctx.fillText('0', bx + 14, T + ph / 2 + 3);
    ctx.fillText(`−${tauMax.toFixed(2)}`, bx + 14, T + ph);
    ctx.save(); ctx.translate(bx + 52, T + ph / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText('τ_DAGE (N·m)', 0, 0); ctx.restore();
    if (hover) {
      const x = L + (hover.vp / 7) * pw;
      const y = T + (1 - hover.z / 4) * ph;
      ctx.strokeStyle = '#fff';
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.stroke();
    }
  });
  useEffect(() => { redraw(); }, [p, slip, hover, redraw]);

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const vp = ((e.clientX - r.left - 46) / (r.width - 130)) * 7;
    const z = (1 - (e.clientY - r.top - 12) / (r.height - 46)) * 4;
    if (vp >= 0 && vp <= 7 && z >= 0 && z <= 4) setHover({ vp, z }); else setHover(null);
  };

  return (
    <div className="view-scroll">
      <div className="section-title">
        <h1>Disturbance model</h1>
        <p>A moving deck turns the rotor downwash into an asymmetric cushion. The result is a roll torque that grows with platform speed and with inverse-polynomial strength near the surface. This is the effect the network learns to cancel.</p>
      </div>

      <div className="grid g-2" style={{ marginBottom: 10 }}>
        <div className="eq"><span className="lbl">Eq. 6 · DAGE roll torque</span>τ<sub>φ</sub> = <var>K</var><sub>φ</sub> [ v<sub>y</sub> + <var>λ</var>(v<sub>y</sub> − v<sub>p</sub>) ] cos φ / ( 1 + (z/<var>L</var>)<sup><var>n</var></sup> )</div>
        <div className="eq"><span className="lbl">Eq. 7 · vertical ground effect</span>a<sub>GE</sub> = <var>A</var><sub>GE</sub> / ( 1 + (z/<var>R</var><sub>z</sub>)<sup><var>n</var></sup> )</div>
      </div>

      <div className="grid g-side">
        <Panel tag="PHY-CFG" title="Model parameters">
          <Field label="Preset">
            <Seg options={[{ value: 'nom', label: 'Nominal' }, { value: 'mis', label: 'Mismatch' }, { value: 'custom', label: 'Custom' }] as const} value={preset}
              onChange={(v) => { if (v === 'nom') setP(NOMINAL); if (v === 'mis') setP(MISM); }} label="Preset" />
          </Field>
          <Field label="K_φ DAGE gain" value={p.K.toFixed(3)}><Slider min={0.04} max={0.3} step={0.002} value={p.K} onChange={upd('K')} label="K_phi" /></Field>
          <Field label="L altitude scale" value={`${p.L.toFixed(2)} m`}><Slider min={0.1} max={1} step={0.01} value={p.L} onChange={upd('L')} label="L" /></Field>
          <Field label="λ slip weight" value={p.lam.toFixed(2)}><Slider min={0} max={1.5} step={0.01} value={p.lam} onChange={upd('lam')} label="lambda" /></Field>
          <Field label="n decay exponent" value={p.n.toFixed(2)}><Slider min={1} max={3} step={0.05} value={p.n} onChange={upd('n')} label="n" /></Field>
          <Field label="A_GE ground effect" value={`${p.A.toFixed(2)} m/s²`}><Slider min={0.5} max={3.5} step={0.05} value={p.A} onChange={upd('A')} label="A_GE" /></Field>
          <Field label="R_z GE scale" value={`${p.Rz.toFixed(2)} m`}><Slider min={0.2} max={1.2} step={0.01} value={p.Rz} onChange={upd('Rz')} label="R_z" /></Field>
          <Field label="Vehicle speed v_y / v_p" value={slip.toFixed(2)} hint="1.0 = matched to the deck (final approach). 0 = still stationary in the inertial frame.">
            <Slider min={0} max={1.2} step={0.01} value={slip} onChange={setSlip} label="slip ratio" />
          </Field>
        </Panel>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
          <div className="stat-strip" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
            <div><Readout label="τ at touchdown, 6 m/s" value={tau(p, 0, 6, slip).toFixed(4)} unit="N·m" color="var(--signal)" /></div>
            <div><Readout label="vs. training maximum" value={(Math.abs(tau(p, 0, 6, slip)) / trainMax).toFixed(2)} unit="×" /></div>
            <div><Readout label="Roll accel @ J_x" value={(tau(p, 0, 6, slip) / SIM.Jx).toFixed(2)} unit="rad/s²" /></div>
            <div><Readout label={hover ? `τ @ z ${hover.z.toFixed(2)}, v_p ${hover.vp.toFixed(1)}` : 'Hover the field'} value={hover ? tau(p, hover.z, hover.vp, slip).toFixed(4) : '—'} unit={hover ? 'N·m' : ''} /></div>
          </div>
          <Panel tag="PHY-MAP" title="DAGE torque field τ(z, v_p)" className="chart-panel" style={{ height: 420 }}>
            <div className="chart-wrap" onMouseMove={onMove} onMouseLeave={() => setHover(null)} style={{ cursor: 'crosshair' }}><canvas ref={ref} /></div>
          </Panel>
          <div className="grid g-2">
            <Panel tag="PHY-TAU" title="Torque vs altitude" className="chart-panel" style={{ height: 270 }}
              right={<div className="legend">{PROFILE_SPEEDS.map((v, i) => <span key={v}><i style={{ background: PCOL[i] }} />{v}</span>)}</div>}>
              <Profile f={(z, i) => tau(p, z, PROFILE_SPEEDS[i], slip)} n={4} colors={PCOL} unit="N·m" mark={p.L} markLabel="L" />
            </Panel>
            <Panel tag="PHY-GE" title="Ground-effect acceleration" className="chart-panel" style={{ height: 270 }}
              right={<div className="legend"><span><i style={{ background: TH().accent }} />current</span><span><i className="dash" style={{ color: TH().text3 }} />nominal</span></div>}>
              <Profile f={(z, i) => (i === 0 ? geAccel(Math.max(z, 0.01), p.A, p.Rz, p.n) : geAccel(Math.max(z, 0.01), NOMINAL.A, NOMINAL.Rz, NOMINAL.n))} n={2} colors={[TH().accent, TH().text3]} dashed={[false, true]} unit="m/s²" mark={p.Rz} markLabel="R_z" />
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}

function Profile({ f, n, colors, dashed, unit, mark, markLabel }: { f: (z: number, i: number) => number; n: number; colors: string[]; dashed?: boolean[]; unit: string; mark: number; markLabel: string }) {
  const W = 460, H = 220, L = 44, R = 12, T = 12, B = 30;
  const N = 120;
  const series = Array.from({ length: n }, (_, i) => Array.from({ length: N + 1 }, (_, k) => f((k / N) * 3, i)));
  let lo = 0, hi = 0;
  for (const s of series) for (const v of s) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (hi - lo < 1e-9) hi = lo + 1;
  const X = (z: number) => L + (z / 3) * (W - L - R);
  const Y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" style={{ display: 'block' }}>
      {[0, 0.25, 0.5, 0.75, 1].map((q) => {
        const v = lo + q * (hi - lo);
        return (
          <g key={q}>
            <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="var(--grid)" />
            <text x={L - 6} y={Y(v) + 3} fill="var(--text-3)" fontSize={9} textAnchor="end">{v.toFixed(Math.abs(hi) < 1 ? 2 : 1)}</text>
          </g>
        );
      })}
      {[0, 0.5, 1, 1.5, 2, 2.5, 3].map((z) => <text key={z} x={X(z)} y={H - 16} fill="var(--text-3)" fontSize={9} textAnchor="middle">{z}</text>)}
      <text x={(L + W - R) / 2} y={H - 3} fill="var(--text-3)" fontSize={9} textAnchor="middle">altitude z (m) · {unit}</text>
      <line x1={X(mark)} x2={X(mark)} y1={T} y2={H - B} stroke="var(--warn)" strokeDasharray="3 3" opacity={0.7} />
      <text x={X(mark) + 4} y={T + 10} fill="var(--warn)" fontSize={9}>{markLabel}</text>
      {series.map((s, i) => (
        <polyline key={i} points={s.map((v, k) => `${X((k / N) * 3)},${Y(v)}`).join(' ')} fill="none" stroke={colors[i]} strokeWidth={1.8} strokeDasharray={dashed?.[i] ? '4 3' : undefined} />
      ))}
    </svg>
  );
}

/** Diverging map: accent blue (−) → card surface (0) → orange (+), following the appearance. */
function cmap(v: number): string {
  const th = TH();
  const t = Math.max(-1, Math.min(1, v));
  const a = Math.pow(Math.abs(t), 0.5);
  const base = rgbOf(th.card);
  const c = rgbOf(t >= 0 ? th.disturb : th.accent);
  const r = Math.round(base[0] + (c[0] - base[0]) * a);
  const g = Math.round(base[1] + (c[1] - base[1]) * a);
  const b = Math.round(base[2] + (c[2] - base[2]) * a);
  return `rgb(${r},${g},${b})`;
}
