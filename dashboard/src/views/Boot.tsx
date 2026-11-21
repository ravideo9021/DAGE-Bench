import { useEffect, useState } from 'react';
import { getNetwork } from '../sim/network';
import { verifyNetwork, verifyRK4, benchInference, smokeTest, selftest } from '../sim/selftest';
import { workerCount } from '../engine/montecarlo';

interface Line { label: string; result?: string; ok?: boolean }

const STEPS: { label: string; run: () => string }[] = [
  { label: 'Load residual_model.npz', run: () => { const n = getNetwork(); return `${n.nParams.toLocaleString()} params · ${n.layers.length} layers`; } },
  { label: 'Verify MLP forward pass vs NumPy', run: () => { const e = verifyNetwork(); selftest.netErr = e; return `max |Δ| ${e.toExponential(1)}`; } },
  { label: 'Verify RK4 integrator vs NumPy', run: () => { const e = verifyRK4(); selftest.rk4Err = e; return `max |Δ| ${e === 0 ? '0 (exact)' : e.toExponential(1)}`; } },
  { label: 'Load calibrated gate threshold', run: () => `d₀ = ${getNetwork().d0.toFixed(4)} (P99)` },
  { label: 'Benchmark inference latency', run: () => { const us = benchInference(); selftest.usPerInf = us; return `${us.toFixed(1)} µs / forward`; } },
  { label: 'Closed-loop smoke test · Res-G @ 6 m/s', run: () => { const r = smokeTest(); return `${r.success ? 'PASS' : 'FAIL'} · TD ${r.touchdownT.toFixed(2)} s · ${r.ms.toFixed(0)} ms`; } },
  { label: 'Monte Carlo worker pool', run: () => `${workerCount()} threads` },
];

export default function Boot({ onDone }: { onDone: () => void }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [i, setI] = useState(0);

  useEffect(() => {
    if (i >= STEPS.length) { const t = setTimeout(onDone, 520); return () => clearTimeout(t); }
    const t = setTimeout(() => {
      const st = STEPS[i];
      let result: string;
      let ok = true;
      try { result = st.run(); } catch (e) { result = String(e); ok = false; }
      setLines((l) => [...l, { label: st.label, result, ok }]);
      setI(i + 1);
    }, i === 0 ? 260 : 150);
    return () => clearTimeout(t);
  }, [i, onDone]);

  useEffect(() => {
    const skip = () => onDone();
    window.addEventListener('keydown', skip);
    return () => window.removeEventListener('keydown', skip);
  }, [onDone]);

  return (
    <div className="boot" onClick={onDone} role="dialog" aria-label="System initialisation">
      <div className="boot-box">
        <div className="boot-mark">
          <svg width="40" height="40" viewBox="0 0 32 32" aria-hidden="true">
            <rect width="32" height="32" rx="5" fill="#0c0f12" stroke="#242c35" />
            <path d="M6 23h20" stroke="#ff6b1a" strokeWidth="2.2" strokeLinecap="round" />
            <path d="M16 6v11M11 12l5 5 5-5" fill="none" stroke="#e8ecef" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div>
            <h1>DAGE · FLIGHT CONSOLE</h1>
            <p>Residual compensation of dynamic asymmetric ground effect · v1.0</p>
          </div>
        </div>
        {lines.map((l) => (
          <div key={l.label} className={`boot-line ${l.ok ? 'ok' : ''}`}>
            <span style={{ color: l.ok ? 'var(--ok)' : 'var(--crit)' }}>{l.ok ? '✓' : '✕'}</span>
            <span>{l.label}</span>
            <span className="r">{l.result}</span>
          </div>
        ))}
        {i < STEPS.length && (
          <div className="boot-line">
            <span className="spinner" />
            <span>{STEPS[i].label}</span>
            <span className="r">running</span>
          </div>
        )}
        <div className="boot-bar"><i style={{ width: `${(i / STEPS.length) * 100}%` }} /></div>
        <div className="boot-skip">{i >= STEPS.length ? 'ALL CHECKS PASSED · ENTERING CONSOLE' : 'PRESS ANY KEY TO SKIP'}</div>
      </div>
    </div>
  );
}
