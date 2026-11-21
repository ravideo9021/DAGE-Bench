// Validates the TypeScript port against the Python reference implementation.
//   npx tsx scripts/validate.ts
import { MODEL, getNetwork } from '../src/sim/network';
import { stepRK4 } from '../src/sim/physics';
import { runTrial, wilson, type ControllerId } from '../src/sim/trial';

const net = getNetwork();
const out = new Float64Array(2);
let maxErr = 0;
MODEL.selftest.net_inputs.forEach((x, i) => {
  net.predict(x, out);
  MODEL.selftest.net_outputs[i].forEach((v, k) => (maxErr = Math.max(maxErr, Math.abs(v - out[k]))));
});
console.log(`MLP forward vs NumPy   max |err| = ${maxErr.toExponential(2)}  params=${net.nParams} macs=${net.nMacs}`);
const r = MODEL.selftest.rk4;
const s = Float64Array.from(r.state);
stepRK4(s, r.u_z, r.u_phi, { vp: r.vp, K_phi: r.K_phi, A_GE: r.A_GE, Jx: r.Jx, L: 0.35, lam: 0.6, R_z: 0.55, n: 2 }, 0);
console.log(`RK4 step vs NumPy      max |err| = ${Math.max(...r.out.map((v, i) => Math.abs(v - s[i]))).toExponential(2)}`);

const N = Number(process.argv[2] ?? 200);
const paper: Record<string, number> = { 'PD@5': 41.0, 'PID@5': 100, 'PD@6': 9.8, 'PID@6': 89.8, 'PID+DOB@6': 100, 'Res-NG@6': 100, 'Res-G@6': 100, 'PD@3': 100 };
for (const mm of [false, true]) {
  for (const vp of mm ? [3, 5] : [3, 5, 6]) {
    for (const c of ['PD', 'PID', 'PID+DOB', 'Res-NG', 'Res-G'] as ControllerId[]) {
      const t0 = performance.now();
      let ok = 0, vz = 0, rms = 0, sig = 0;
      for (let i = 0; i < N; i++) {
        const res = runTrial({ controller: c, vp, seed: 100 + i, mismatch: mm, kappa: 1, d0Scale: 1 }, net);
        ok += +res.success; vz += res.vz; rms += res.rmsPhi; sig += res.meanSigma;
      }
      const [lo, hi] = wilson(ok, N);
      const ref = mm ? '' : paper[`${c}@${vp}`];
      console.log(`${mm ? 'MISMATCH ' : ''}vp=${vp} ${c.padEnd(8)} env=${((100 * ok) / N).toFixed(1).padStart(5)}% [${(lo * 100).toFixed(1)},${(hi * 100).toFixed(1)}]  |vz|=${(vz / N).toFixed(3)} rmsφ=${(rms / N).toFixed(4)} σ=${(sig / N).toFixed(3)}  ${ref !== undefined && ref !== '' ? 'paper=' + ref + '%' : ''}  ${((performance.now() - t0) / N).toFixed(2)}ms/trial`);
    }
  }
}
