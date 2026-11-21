import { getNetwork } from './network';
import { verifyNetwork, verifyRK4, benchInference, smokeTest, selftest } from './selftest';
import { workerCount } from '../engine/montecarlo';

/** Start-up checks of the browser port against the Python reference. */
export interface Check { label: string; result: string; ok: boolean }

export const STEPS: { label: string; run: () => { result: string; ok: boolean } }[] = [
  { label: 'Trained weights loaded', run: () => { const n = getNetwork(); return { result: `${n.nParams.toLocaleString()} parameters`, ok: n.nParams === 7906 }; } },
  { label: 'Network matches NumPy', run: () => { const e = verifyNetwork(); selftest.netErr = e; return { result: `max error ${e.toExponential(1)}`, ok: e < 1e-9 }; } },
  { label: 'Integrator matches NumPy', run: () => { const e = verifyRK4(); selftest.rk4Err = e; return { result: e === 0 ? 'exact' : `max error ${e.toExponential(1)}`, ok: e < 1e-12 }; } },
  { label: 'Gate threshold calibrated', run: () => ({ result: `d₀ = ${getNetwork().d0.toFixed(3)}`, ok: true }) },
  { label: 'Inference speed', run: () => { const us = benchInference(); selftest.usPerInf = us; return { result: `${us.toFixed(1)} µs per pass`, ok: us < 10000 }; } },
  { label: 'Closed-loop landing at 6 m/s', run: () => { const r = smokeTest(); return { result: `${r.success ? 'passed' : 'failed'} in ${r.ms.toFixed(0)} ms`, ok: r.success }; } },
  { label: 'Parallel workers', run: () => ({ result: `${workerCount()} threads`, ok: true }) },
];

export function runChecks(onUpdate: (c: Check[]) => void) {
  const out: Check[] = [];
  let i = 0;
  const next = () => {
    if (i >= STEPS.length) return;
    const s = STEPS[i++];
    try { out.push({ label: s.label, ...s.run() }); } catch (e) { out.push({ label: s.label, result: String(e), ok: false }); }
    onUpdate([...out]);
    setTimeout(next, 30);
  };
  setTimeout(next, 400);
}

export const CHECK_COUNT = STEPS.length;

