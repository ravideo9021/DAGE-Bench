/**
 * Reduced-order DAGE plant — a line-for-line port of dage/dynamics.py.
 *
 * State convention: [z, vz, y_rel, vy_rel, phi, p]
 * Integrated at 100 Hz with classical RK4.
 */

export const SIM = {
  dt: 0.01,
  horizon: 12.0,
  z0: 4.0,
  v_des: 0.42,
  mass: 1.5,
  Jx: 0.02,
  g: 9.81,
  A_GE: 1.8,
  R_z: 0.55,
  K_phi: 0.12,
  L: 0.35,
  lam: 0.6,
  decay_exp: 2.0,
  sigma: { z: 0.01, vz: 0.03, y: 0.01, vy: 0.03, phi: 0.004, p: 0.02 },
  tau_noise_std: 0.005,
} as const;

export const CONTROL = {
  z: { Kp: 2.2, Kd: 2.6, Ki: 1.6 },
  phi: { Kp: 60.0, Kd: 11.0, Ki: 30.0 },
  lat_Kp: 0.4,
  lat_Kd: 0.3,
  dob_tau: 1.0,
} as const;

export const ENVELOPE = {
  phi_max: 0.1,
  vz_max: 0.75,
  dvy_max: 0.75,
  final_approach_z: 1.0,
} as const;

export const RANDOMISATION = {
  K_phi: [0.8, 1.2],
  A_GE: [0.85, 1.15],
  Jx: [0.9, 1.1],
  vp: [0.9, 1.1],
  y0_std: 0.5,
  phi0_std: 0.03,
} as const;

export const MISMATCH = {
  K_phi_scale: 1.4,
  A_GE_scale: 1.35,
  L_scale: 1.3,
  R_z_scale: 1.4,
  decay_exp: 1.6,
  lam: 1.0,
} as const;

export const MAX_TRAIN_SPEED = 4.0;

/** Per-trial physical parameters actually used by the plant. */
export interface Plant {
  vp: number;
  K_phi: number;
  A_GE: number;
  Jx: number;
  L: number;
  lam: number;
  R_z: number;
  n: number;
}

/** DAGE roll torque, Eq 6. vy is the INERTIAL lateral velocity. */
export function dageTorque(
  z: number, vy: number, vp: number, phi: number,
  K: number, L: number, lam: number, n: number,
): number {
  return (K * ((vy + lam * (vy - vp)) * Math.cos(phi))) / (1 + Math.pow(z / L, n));
}

/** Symmetric vertical ground-effect acceleration, Eq 7. */
export function geAccel(z: number, A: number, Rz: number, n: number): number {
  return A / (1 + Math.pow(z / Rz, n));
}

function derivs(
  s: Float64Array, o: Float64Array,
  uz: number, uphi: number, P: Plant, tauNoise: number,
): void {
  const z = s[0] > 0.01 ? s[0] : 0.01;
  const vyI = s[3] + P.vp;
  o[0] = s[1];
  o[1] = uz + geAccel(z, P.A_GE, P.R_z, P.n);
  o[2] = s[3];
  o[3] = (uz + SIM.g) * Math.tan(s[4]);
  o[4] = s[5];
  o[5] = (uphi + dageTorque(z, vyI, P.vp, s[4], P.K_phi, P.L, P.lam, P.n) + tauNoise) / P.Jx;
}

const k1 = new Float64Array(6);
const k2 = new Float64Array(6);
const k3 = new Float64Array(6);
const k4 = new Float64Array(6);
const tmp = new Float64Array(6);

/** One RK4 step, in place. */
export function stepRK4(s: Float64Array, uz: number, uphi: number, P: Plant, tauNoise: number): void {
  const dt = SIM.dt;
  derivs(s, k1, uz, uphi, P, tauNoise);
  for (let i = 0; i < 6; i++) tmp[i] = s[i] + 0.5 * dt * k1[i];
  derivs(tmp, k2, uz, uphi, P, tauNoise);
  for (let i = 0; i < 6; i++) tmp[i] = s[i] + 0.5 * dt * k2[i];
  derivs(tmp, k3, uz, uphi, P, tauNoise);
  for (let i = 0; i < 6; i++) tmp[i] = s[i] + dt * k3[i];
  derivs(tmp, k4, uz, uphi, P, tauNoise);
  for (let i = 0; i < 6; i++) s[i] = s[i] + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
}
