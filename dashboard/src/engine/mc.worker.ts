/// <reference lib="webworker" />
import { runTrial, type ControllerId } from '../sim/trial';
import { getNetwork } from '../sim/network';

export interface McTask {
  id: number;
  cell: number;
  start: number;
  count: number;
  controller: ControllerId;
  vp: number;
  mismatch: boolean;
  kappa: number;
  d0Scale: number;
}

export const FIELDS = 7; // peak, dvy, vz, rms, sigma, success, touchdownT

export function runTask(t: McTask): Float64Array {
  const net = getNetwork();
  const out = new Float64Array(t.count * FIELDS);
  for (let i = 0; i < t.count; i++) {
    const r = runTrial({ controller: t.controller, vp: t.vp, seed: 100 + t.start + i, mismatch: t.mismatch, kappa: t.kappa, d0Scale: t.d0Scale }, net);
    const o = i * FIELDS;
    out[o] = r.peakPhi; out[o + 1] = r.dvy; out[o + 2] = r.vz; out[o + 3] = r.rmsPhi;
    out[o + 4] = r.meanSigma; out[o + 5] = r.success ? 1 : 0; out[o + 6] = r.touchdownT;
  }
  return out;
}

declare const WorkerGlobalScope: { new (): unknown } | undefined;
if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  self.onmessage = (e: MessageEvent<McTask>) => {
    const res = runTask(e.data);
    (self as unknown as Worker).postMessage({ id: e.data.id, cell: e.data.cell, start: e.data.start, count: e.data.count, data: res }, [res.buffer]);
  };
}
