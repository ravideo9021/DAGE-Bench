/** Runtime self-verification of the TypeScript port against NumPy reference vectors. */
import { MODEL, getNetwork } from './network';
import { stepRK4, SIM } from './physics';
import { runTrial } from './trial';

export function verifyNetwork(): number {
  const net = getNetwork();
  const out = new Float64Array(2);
  let e = 0;
  MODEL.selftest.net_inputs.forEach((x, i) => {
    net.predict(x, out);
    MODEL.selftest.net_outputs[i].forEach((v, k) => (e = Math.max(e, Math.abs(v - out[k]))));
  });
  return e;
}

export function verifyRK4(): number {
  const r = MODEL.selftest.rk4;
  const s = Float64Array.from(r.state);
  stepRK4(s, r.u_z, r.u_phi, { vp: r.vp, K_phi: r.K_phi, A_GE: r.A_GE, Jx: r.Jx, L: SIM.L, lam: SIM.lam, R_z: SIM.R_z, n: SIM.decay_exp }, 0);
  return Math.max(...r.out.map((v, i) => Math.abs(v - s[i])));
}

/** Returns microseconds per forward pass. */
export function benchInference(iters = 4000): number {
  const net = getNetwork();
  const x = Float64Array.from(MODEL.input_mean);
  const out = new Float64Array(2);
  for (let i = 0; i < 200; i++) net.predict(x, out);
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) { x[i % 24] += 1e-6; net.predict(x, out); }
  return ((performance.now() - t0) * 1000) / iters;
}

export function smokeTest() {
  const t0 = performance.now();
  const r = runTrial({ controller: 'Res-G', vp: 6, seed: 100, mismatch: false, kappa: 1, d0Scale: 1 }, getNetwork());
  return { ...r, ms: performance.now() - t0 };
}

export const selftest: { netErr?: number; rk4Err?: number; usPerInf?: number } = {};
