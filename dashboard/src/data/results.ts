export const trainingCurves = [
  { epoch: 1, train: 0.04927, val: 0.00721 },
  { epoch: 2, train: 0.01939, val: 0.00554 },
  { epoch: 3, train: 0.01621, val: 0.00455 },
  { epoch: 4, train: 0.01461, val: 0.00453 },
  { epoch: 5, train: 0.01359, val: 0.00410 },
  { epoch: 6, train: 0.01271, val: 0.00410 },
  { epoch: 7, train: 0.01204, val: 0.00344 },
  { epoch: 8, train: 0.01166, val: 0.00360 },
  { epoch: 9, train: 0.01117, val: 0.00293 },
  { epoch: 10, train: 0.01086, val: 0.00277 },
  { epoch: 11, train: 0.01060, val: 0.00307 },
  { epoch: 12, train: 0.01040, val: 0.00292 },
  { epoch: 13, train: 0.01021, val: 0.00296 },
  { epoch: 14, train: 0.01008, val: 0.00268 },
  { epoch: 15, train: 0.01000, val: 0.00274 },
  { epoch: 16, train: 0.00991, val: 0.00277 },
  { epoch: 17, train: 0.00979, val: 0.00276 },
  { epoch: 18, train: 0.00973, val: 0.00256 },
  { epoch: 19, train: 0.00959, val: 0.00262 },
  { epoch: 20, train: 0.00958, val: 0.00264 },
  { epoch: 21, train: 0.00948, val: 0.00244 },
  { epoch: 22, train: 0.00940, val: 0.00265 },
  { epoch: 23, train: 0.00934, val: 0.00242 },
  { epoch: 24, train: 0.00935, val: 0.00240 },
  { epoch: 25, train: 0.00930, val: 0.00239 },
  { epoch: 26, train: 0.00921, val: 0.00250 },
  { epoch: 27, train: 0.00921, val: 0.00280 },
  { epoch: 28, train: 0.00921, val: 0.00248 },
  { epoch: 29, train: 0.00916, val: 0.00242 },
  { epoch: 30, train: 0.00910, val: 0.00234 },
  { epoch: 31, train: 0.00907, val: 0.00239 },
  { epoch: 32, train: 0.00897, val: 0.00230 },
  { epoch: 33, train: 0.00900, val: 0.00241 },
  { epoch: 34, train: 0.00899, val: 0.00237 },
  { epoch: 35, train: 0.00899, val: 0.00238 },
  { epoch: 36, train: 0.00892, val: 0.00235 },
  { epoch: 37, train: 0.00888, val: 0.00237 },
  { epoch: 38, train: 0.00893, val: 0.00237 },
];

export interface EvalRow {
  vp: number;
  controller: string;
  rms_phi: number;
  peak_phi: number;
  delta_vy: number;
  abs_vz: number;
  envelope_pct: number;
  envelope_ci_lo: number;
  envelope_ci_hi: number;
  roll_viol_pct: number;
  mean_sigma: number | null;
}

export const evaluationResults: EvalRow[] = [
  { vp: 0.0, controller: "PD", rms_phi: 0.002769, peak_phi: 0.006298, delta_vy: 0.006616, abs_vz: 0.245548, envelope_pct: 100.0, envelope_ci_lo: 99.24, envelope_ci_hi: 100.0, roll_viol_pct: 0.0, mean_sigma: null },
  { vp: 0.0, controller: "PID", rms_phi: 0.003130, peak_phi: 0.006767, delta_vy: 0.006649, abs_vz: 0.335241, envelope_pct: 100.0, envelope_ci_lo: 99.24, envelope_ci_hi: 100.0, roll_viol_pct: 0.0, mean_sigma: null },
  { vp: 0.0, controller: "PID+DOB", rms_phi: 0.003171, peak_phi: 0.006839, delta_vy: 0.006391, abs_vz: 0.335241, envelope_pct: 100.0, envelope_ci_lo: 99.24, envelope_ci_hi: 100.0, roll_viol_pct: 0.0, mean_sigma: null },
  { vp: 0.0, controller: "Res-G", rms_phi: 0.003401, peak_phi: 0.007505, delta_vy: 0.008655, abs_vz: 0.390307, envelope_pct: 100.0, envelope_ci_lo: 99.24, envelope_ci_hi: 100.0, roll_viol_pct: 0.0, mean_sigma: 0.999921 },
  { vp: 0.0, controller: "Res-NG", rms_phi: 0.003401, peak_phi: 0.007505, delta_vy: 0.008655, abs_vz: 0.390307, envelope_pct: 100.0, envelope_ci_lo: 99.24, envelope_ci_hi: 100.0, roll_viol_pct: 0.0, mean_sigma: 1.0 },
  { vp: 1.5, controller: "PD", rms_phi: 0.007252, peak_phi: 0.013795, delta_vy: 0.190826, abs_vz: 0.245548, envelope_pct: 100.0, envelope_ci_lo: 99.24, envelope_ci_hi: 100.0, roll_viol_pct: 0.0, mean_sigma: null },
  { vp: 1.5, controller: "PID", rms_phi: 0.006688, peak_phi: 0.012979, delta_vy: 0.133913, abs_vz: 0.335241, envelope_pct: 100.0, envelope_ci_lo: 99.24, envelope_ci_hi: 100.0, roll_viol_pct: 0.0, mean_sigma: null },
  { vp: 1.5, controller: "PID+DOB", rms_phi: 0.004663, peak_phi: 0.010063, delta_vy: 0.069329, abs_vz: 0.335241, envelope_pct: 100.0, envelope_ci_lo: 99.24, envelope_ci_hi: 100.0, roll_viol_pct: 0.0, mean_sigma: null },
  { vp: 1.5, controller: "Res-G", rms_phi: 0.004676, peak_phi: 0.009948, delta_vy: 0.063831, abs_vz: 0.394460, envelope_pct: 100.0, envelope_ci_lo: 99.24, envelope_ci_hi: 100.0, roll_viol_pct: 0.0, mean_sigma: 0.998798 },
  { vp: 1.5, controller: "Res-NG", rms_phi: 0.004676, peak_phi: 0.009948, delta_vy: 0.063831, abs_vz: 0.394461, envelope_pct: 100.0, envelope_ci_lo: 99.24, envelope_ci_hi: 100.0, roll_viol_pct: 0.0, mean_sigma: 1.0 },
  { vp: 3.0, controller: "PD", rms_phi: 0.013626, peak_phi: 0.023736, delta_vy: 0.381066, abs_vz: 0.245548, envelope_pct: 100.0, envelope_ci_lo: 99.24, envelope_ci_hi: 100.0, roll_viol_pct: 0.0, mean_sigma: null },
  { vp: 3.0, controller: "PID", rms_phi: 0.012215, peak_phi: 0.022112, delta_vy: 0.267894, abs_vz: 0.335241, envelope_pct: 100.0, envelope_ci_lo: 99.24, envelope_ci_hi: 100.0, roll_viol_pct: 0.0, mean_sigma: null },
  { vp: 3.0, controller: "PID+DOB", rms_phi: 0.007553, peak_phi: 0.016339, delta_vy: 0.138690, abs_vz: 0.335241, envelope_pct: 100.0, envelope_ci_lo: 99.24, envelope_ci_hi: 100.0, roll_viol_pct: 0.0, mean_sigma: null },
  { vp: 3.0, controller: "Res-G", rms_phi: 0.008933, peak_phi: 0.017639, delta_vy: 0.155779, abs_vz: 0.393709, envelope_pct: 100.0, envelope_ci_lo: 99.24, envelope_ci_hi: 100.0, roll_viol_pct: 0.0, mean_sigma: 0.995639 },
  { vp: 3.0, controller: "Res-NG", rms_phi: 0.008932, peak_phi: 0.017639, delta_vy: 0.155770, abs_vz: 0.393713, envelope_pct: 100.0, envelope_ci_lo: 99.24, envelope_ci_hi: 100.0, roll_viol_pct: 0.0, mean_sigma: 1.0 },
  { vp: 5.0, controller: "PD", rms_phi: 0.040410, peak_phi: 0.129376, delta_vy: 0.939902, abs_vz: 0.245548, envelope_pct: 41.0, envelope_ci_lo: 36.77, envelope_ci_hi: 45.36, roll_viol_pct: 52.8, mean_sigma: null },
  { vp: 5.0, controller: "PID", rms_phi: 0.019956, peak_phi: 0.035011, delta_vy: 0.450685, abs_vz: 0.335241, envelope_pct: 100.0, envelope_ci_lo: 99.24, envelope_ci_hi: 100.0, roll_viol_pct: 0.0, mean_sigma: null },
  { vp: 5.0, controller: "PID+DOB", rms_phi: 0.011867, peak_phi: 0.026255, delta_vy: 0.231161, abs_vz: 0.335241, envelope_pct: 100.0, envelope_ci_lo: 99.24, envelope_ci_hi: 100.0, roll_viol_pct: 0.0, mean_sigma: null },
  { vp: 5.0, controller: "Res-G", rms_phi: 0.013137, peak_phi: 0.023629, delta_vy: 0.248001, abs_vz: 0.395008, envelope_pct: 100.0, envelope_ci_lo: 99.24, envelope_ci_hi: 100.0, roll_viol_pct: 0.0, mean_sigma: 0.978879 },
  { vp: 5.0, controller: "Res-NG", rms_phi: 0.013126, peak_phi: 0.023608, delta_vy: 0.247854, abs_vz: 0.394999, envelope_pct: 100.0, envelope_ci_lo: 99.24, envelope_ci_hi: 100.0, roll_viol_pct: 0.0, mean_sigma: 1.0 },
  { vp: 6.0, controller: "PD", rms_phi: 0.081045, peak_phi: 0.272905, delta_vy: 1.625826, abs_vz: 0.245548, envelope_pct: 9.8, envelope_ci_lo: 7.49, envelope_ci_hi: 12.72, roll_viol_pct: 86.0, mean_sigma: null },
  { vp: 6.0, controller: "PID", rms_phi: 0.025162, peak_phi: 0.046259, delta_vy: 0.572497, abs_vz: 0.335241, envelope_pct: 89.8, envelope_ci_lo: 86.84, envelope_ci_hi: 92.16, roll_viol_pct: 3.6, mean_sigma: null },
  { vp: 6.0, controller: "PID+DOB", rms_phi: 0.014085, peak_phi: 0.031405, delta_vy: 0.277387, abs_vz: 0.335241, envelope_pct: 100.0, envelope_ci_lo: 99.24, envelope_ci_hi: 100.0, roll_viol_pct: 0.0, mean_sigma: null },
  { vp: 6.0, controller: "Res-G", rms_phi: 0.015648, peak_phi: 0.027424, delta_vy: 0.303067, abs_vz: 0.398150, envelope_pct: 100.0, envelope_ci_lo: 99.24, envelope_ci_hi: 100.0, roll_viol_pct: 0.0, mean_sigma: 0.974034 },
  { vp: 6.0, controller: "Res-NG", rms_phi: 0.015633, peak_phi: 0.027389, delta_vy: 0.302830, abs_vz: 0.398130, envelope_pct: 100.0, envelope_ci_lo: 99.24, envelope_ci_hi: 100.0, roll_viol_pct: 0.0, mean_sigma: 1.0 },
];

export const mismatchResults: EvalRow[] = [
  { vp: 1.5, controller: "PD", rms_phi: 0.008262, peak_phi: 0.015039, delta_vy: 0.246459, abs_vz: 0.242226, envelope_pct: 100.0, envelope_ci_lo: 99.24, envelope_ci_hi: 100.0, roll_viol_pct: 0.0, mean_sigma: null },
  { vp: 1.5, controller: "PID", rms_phi: 0.007562, peak_phi: 0.014024, delta_vy: 0.156713, abs_vz: 0.350082, envelope_pct: 100.0, envelope_ci_lo: 99.24, envelope_ci_hi: 100.0, roll_viol_pct: 0.0, mean_sigma: null },
  { vp: 1.5, controller: "Res-G", rms_phi: 0.004965, peak_phi: 0.010288, delta_vy: 0.072999, abs_vz: 0.377598, envelope_pct: 100.0, envelope_ci_lo: 99.24, envelope_ci_hi: 100.0, roll_viol_pct: 0.0, mean_sigma: 0.999057 },
  { vp: 1.5, controller: "Res-NG", rms_phi: 0.004965, peak_phi: 0.010288, delta_vy: 0.072999, abs_vz: 0.377598, envelope_pct: 100.0, envelope_ci_lo: 99.24, envelope_ci_hi: 100.0, roll_viol_pct: 0.0, mean_sigma: 1.0 },
  { vp: 3.0, controller: "PD", rms_phi: 0.025531, peak_phi: 0.086399, delta_vy: 0.620528, abs_vz: 0.242226, envelope_pct: 66.4, envelope_ci_lo: 62.15, envelope_ci_hi: 70.40, roll_viol_pct: 33.6, mean_sigma: null },
  { vp: 3.0, controller: "PID", rms_phi: 0.014275, peak_phi: 0.025340, delta_vy: 0.316735, abs_vz: 0.350082, envelope_pct: 100.0, envelope_ci_lo: 99.24, envelope_ci_hi: 100.0, roll_viol_pct: 0.0, mean_sigma: null },
  { vp: 3.0, controller: "Res-G", rms_phi: 0.009017, peak_phi: 0.016975, delta_vy: 0.160943, abs_vz: 0.375989, envelope_pct: 100.0, envelope_ci_lo: 99.24, envelope_ci_hi: 100.0, roll_viol_pct: 0.0, mean_sigma: 0.996082 },
  { vp: 3.0, controller: "Res-NG", rms_phi: 0.009017, peak_phi: 0.016976, delta_vy: 0.160936, abs_vz: 0.375993, envelope_pct: 100.0, envelope_ci_lo: 99.24, envelope_ci_hi: 100.0, roll_viol_pct: 0.0, mean_sigma: 1.0 },
  { vp: 5.0, controller: "PD", rms_phi: 0.202216, peak_phi: 0.656678, delta_vy: 3.768114, abs_vz: 0.242226, envelope_pct: 0.0, envelope_ci_lo: 0.0, envelope_ci_hi: 0.76, roll_viol_pct: 100.0, mean_sigma: null },
  { vp: 5.0, controller: "PID", rms_phi: 0.051228, peak_phi: 0.159348, delta_vy: 0.846211, abs_vz: 0.350082, envelope_pct: 33.8, envelope_ci_lo: 29.79, envelope_ci_hi: 38.06, roll_viol_pct: 66.2, mean_sigma: null },
  { vp: 5.0, controller: "Res-G", rms_phi: 0.014719, peak_phi: 0.027175, delta_vy: 0.280622, abs_vz: 0.380829, envelope_pct: 99.8, envelope_ci_lo: 98.88, envelope_ci_hi: 99.96, roll_viol_pct: 0.2, mean_sigma: 0.979134 },
  { vp: 5.0, controller: "Res-NG", rms_phi: 0.014688, peak_phi: 0.026725, delta_vy: 0.280069, abs_vz: 0.382236, envelope_pct: 100.0, envelope_ci_lo: 99.24, envelope_ci_hi: 100.0, roll_viol_pct: 0.0, mean_sigma: 1.0 },
];

export interface GateAblationRow {
  kappa: number | string | null;
  d0_scale: number | string | null;
  mean_sigma: number | null;
  rms_phi: number;
  envelope_pct: number;
}

export const gateAblation: GateAblationRow[] = [
  { kappa: null, d0_scale: null, mean_sigma: 1.0, rms_phi: 0.015692, envelope_pct: 100.0 },
  { kappa: 0.4, d0_scale: 0.6, mean_sigma: 0.684, rms_phi: 0.038621, envelope_pct: 61.33 },
  { kappa: 0.4, d0_scale: 0.8, mean_sigma: 0.835, rms_phi: 0.015785, envelope_pct: 99.33 },
  { kappa: 0.4, d0_scale: 1.0, mean_sigma: 0.966, rms_phi: 0.015711, envelope_pct: 100.0 },
  { kappa: 0.8, d0_scale: 0.6, mean_sigma: 0.734, rms_phi: 0.033345, envelope_pct: 67.0 },
  { kappa: 0.8, d0_scale: 0.8, mean_sigma: 0.883, rms_phi: 0.015737, envelope_pct: 100.0 },
  { kappa: 0.8, d0_scale: 1.0, mean_sigma: 0.972, rms_phi: 0.015708, envelope_pct: 100.0 },
  { kappa: 1.2, d0_scale: 0.6, mean_sigma: 0.777, rms_phi: 0.028305, envelope_pct: 72.67 },
  { kappa: 1.2, d0_scale: 0.8, mean_sigma: 0.908, rms_phi: 0.015724, envelope_pct: 100.0 },
  { kappa: 1.2, d0_scale: 1.0, mean_sigma: 0.976, rms_phi: 0.015706, envelope_pct: 100.0 },
  { kappa: 2.4, d0_scale: 0.6, mean_sigma: 0.854, rms_phi: 0.018962, envelope_pct: 85.0 },
  { kappa: 2.4, d0_scale: 0.8, mean_sigma: 0.943, rms_phi: 0.015711, envelope_pct: 100.0 },
  { kappa: 2.4, d0_scale: 1.0, mean_sigma: 0.984, rms_phi: 0.015701, envelope_pct: 100.0 },
  { kappa: "PID", d0_scale: "PID", mean_sigma: null, rms_phi: 0.025267, envelope_pct: 89.0 },
];

export const controllerColors: Record<string, string> = {
  PD: "#6B7280",
  PID: "#06B6D4",
  "PID+DOB": "#F59E0B",
  "Res-NG": "#10B981",
  "Res-G": "#EC4899",
};

export const networkStats = {
  architecture: "24 → 64 → 64 → 32 → 2",
  parameters: 7906,
  macs: 7744,
  activation: "tanh",
  epochs: 38,
  finalTrainLoss: 0.00893,
  finalValLoss: 0.00237,
};

export const simStats = {
  dt: 0.01,
  frequency: 100,
  channels: 3,
  stateDim: 6,
  integrator: "RK4",
  z0: 4.0,
  vDes: 0.42,
  mass: 1.5,
  totalTrials: 12500,
};
