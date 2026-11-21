/**
 * Residual MLP inference + state-space distance gate — port of dage/network.py
 * and ResidualController._compute_gate. Runs the actual trained weights from
 * results/residual_model.npz (exported by scripts/export_model.py).
 */
import modelJson from './model.json';

interface LayerJson { W: number[]; b: number[]; in: number; out: number }
interface ModelJson {
  layers: LayerJson[];
  input_mean: number[];
  input_std: number[];
  target_mean: number[];
  target_std: number[];
  gate_d0: number;
  selftest: {
    net_inputs: number[][];
    net_outputs: number[][];
    rk4: { state: number[]; u_z: number; u_phi: number; vp: number; K_phi: number; A_GE: number; Jx: number; out: number[] };
  };
}

export const MODEL = modelJson as unknown as ModelJson;

export interface Layer { W: Float64Array; b: Float64Array; nIn: number; nOut: number }

export const FEATURE_NAMES = ['φ', 'p', 'z', 'vz', 'u_φ', 'u_z'] as const;

export class ResidualMLP {
  readonly layers: Layer[];
  readonly inMean: Float64Array;
  readonly inStd: Float64Array;
  readonly tMean: Float64Array;
  readonly tStd: Float64Array;
  readonly d0: number;
  /** Post-activation buffers for every layer (index 0 = standardised input). */
  readonly acts: Float64Array[];
  readonly nParams: number;
  readonly nMacs: number;

  constructor(m: ModelJson = MODEL) {
    this.layers = m.layers.map((l) => ({
      W: Float64Array.from(l.W), b: Float64Array.from(l.b), nIn: l.in, nOut: l.out,
    }));
    this.inMean = Float64Array.from(m.input_mean);
    this.inStd = Float64Array.from(m.input_std.map((s) => (s > 1e-8 ? s : 1)));
    this.tMean = Float64Array.from(m.target_mean);
    this.tStd = Float64Array.from(m.target_std);
    this.d0 = m.gate_d0;
    this.acts = [new Float64Array(this.layers[0].nIn), ...this.layers.map((l) => new Float64Array(l.nOut))];
    this.nParams = this.layers.reduce((a, l) => a + l.W.length + l.b.length, 0);
    this.nMacs = this.layers.reduce((a, l) => a + l.nIn * l.nOut, 0);
  }

  /** Predict [tau_phi_DAGE, a_GE] in physical units. Activations land in `acts`. */
  predict(x: ArrayLike<number>, out: Float64Array): void {
    const a0 = this.acts[0];
    for (let i = 0; i < a0.length; i++) a0[i] = (x[i] - this.inMean[i]) / this.inStd[i];
    const L = this.layers.length;
    for (let li = 0; li < L; li++) {
      const { W, b, nIn, nOut } = this.layers[li];
      const src = this.acts[li];
      const dst = this.acts[li + 1];
      for (let j = 0; j < nOut; j++) dst[j] = b[j];
      for (let i = 0; i < nIn; i++) {
        const xi = src[i];
        const row = i * nOut;
        for (let j = 0; j < nOut; j++) dst[j] += xi * W[row + j];
      }
      if (li < L - 1) for (let j = 0; j < nOut; j++) dst[j] = Math.tanh(dst[j]);
    }
    const y = this.acts[L];
    for (let k = 0; k < y.length; k++) out[k] = y[k] * this.tStd[k] + this.tMean[k];
  }

  /** Chebyshev distance in standardised space (Eq 12). Also returns the arg-max feature. */
  distance(x: ArrayLike<number>): { d: number; idx: number } {
    let d = 0;
    let idx = 0;
    for (let i = 0; i < this.inMean.length; i++) {
      const v = Math.abs(x[i] - this.inMean[i]) / this.inStd[i];
      if (v > d) { d = v; idx = i; }
    }
    return { d, idx };
  }
}

/** Smooth gate (Eq 13). */
export function gateSigma(d: number, d0: number, kappa: number): number {
  const s = Math.exp(-Math.max(0, d - d0) / kappa);
  return s < 0 ? 0 : s > 1 ? 1 : s;
}

let shared: ResidualMLP | null = null;
export function getNetwork(): ResidualMLP {
  if (!shared) shared = new ResidualMLP();
  return shared;
}
