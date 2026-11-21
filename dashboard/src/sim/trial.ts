/**
 * Controllers + single-trial runner — port of dage/controllers.py and
 * dage/evaluation.py::run_single_trial, restructured as a steppable object so
 * the console can animate a trial in real time and record full telemetry.
 */
import { Rng } from './rng';
import {
  SIM, CONTROL, ENVELOPE, RANDOMISATION, MISMATCH,
  type Plant, stepRK4, dageTorque, geAccel,
} from './physics';
import { gateSigma, type ResidualMLP } from './network';

export const CONTROLLERS = ['PD', 'PID', 'PID+DOB', 'Res-NG', 'Res-G'] as const;
export type ControllerId = (typeof CONTROLLERS)[number];

export const CONTROLLER_INFO: Record<ControllerId, { name: string; short: string; desc: string }> = {
  PD: { name: 'Proportional–Derivative', short: 'PD', desc: 'Cascaded PD, no integral action. Lower bound.' },
  PID: { name: 'PID Baseline', short: 'PID', desc: 'Full cascaded PID. The nominal controller.' },
  'PID+DOB': { name: 'PID + Disturbance Observer', short: 'DOB', desc: 'First-order Luenberger observer on the roll channel.' },
  'Res-NG': { name: 'Residual · Ungated', short: 'RES-NG', desc: 'PID + learned residual, σ ≡ 1.' },
  'Res-G': { name: 'Residual · Gated', short: 'RES-G', desc: 'PID + learned residual with state-space distance gate.' },
};

export interface TrialConfig {
  controller: ControllerId;
  vp: number;           // nominal platform speed (m/s)
  seed: number;
  mismatch: boolean;
  kappa: number;
  d0Scale: number;
}

export interface TrialResult {
  rmsPhi: number;
  peakPhi: number;
  dvy: number;
  vz: number;
  success: boolean;
  rollViolation: boolean;
  meanSigma: number;
  touchdownT: number;
  touchdownY: number;
}

export const CHANNELS = [
  't', 'z', 'vz', 'y', 'vy', 'phi', 'p', 'uphi', 'uz',
  'tauTrue', 'tauHat', 'aTrue', 'aHat', 'sigma', 'd', 'phiDes', 'xp', 'dob',
] as const;
export type Channel = (typeof CHANNELS)[number];

const N_STEPS = Math.round(SIM.horizon / SIM.dt);

export class Trial {
  readonly cfg: TrialConfig;
  readonly plant: Plant;
  readonly y0: number;
  readonly phi0: number;
  readonly state = new Float64Array(6);
  readonly meas = new Float64Array(6);
  readonly hist: Record<Channel, Float32Array> | null;
  step = 0;
  t = 0;
  done = false;
  result: TrialResult | null = null;

  // live readouts
  sigma = 1;
  d = 0;
  dIdx = 0;
  tauHat = 0;
  aHat = 0;
  uphi = 0;
  uz = 0;
  phiDes = 0;

  private readonly net: ResidualMLP | null;
  private readonly simRng: Rng;
  private readonly useI: boolean;
  private readonly useDob: boolean;
  private readonly useRes: boolean;
  private readonly useGate: boolean;
  private zInt = 0;
  private phiInt = 0;
  private dobZ = 0;
  dobEst = 0;
  readonly win = new Float64Array(24);
  private winCount = 0;
  private readonly res = new Float64Array(2);

  private sumPhi2 = 0;
  private nPhi = 0;
  private peakPhi = 0;
  private sumSigma = 0;
  private nSigma = 0;

  /**
   * @param probe  run the network alongside a non-residual controller without applying
   *               its output (open-loop evaluation, as in training).
   */
  constructor(cfg: TrialConfig, net: ResidualMLP | null, record = true, probe = false) {
    this.cfg = cfg;
    const rng = new Rng(cfg.seed * 2654435761 + 12345);
    const kS = rng.uniform(RANDOMISATION.K_phi[0], RANDOMISATION.K_phi[1]);
    const aS = rng.uniform(RANDOMISATION.A_GE[0], RANDOMISATION.A_GE[1]);
    const jS = rng.uniform(RANDOMISATION.Jx[0], RANDOMISATION.Jx[1]);
    const vS = rng.uniform(RANDOMISATION.vp[0], RANDOMISATION.vp[1]);
    this.y0 = rng.normal(0, RANDOMISATION.y0_std);
    this.phi0 = rng.normal(0, RANDOMISATION.phi0_std);

    const P: Plant = {
      vp: cfg.vp * vS,
      K_phi: SIM.K_phi * kS,
      A_GE: SIM.A_GE * aS,
      Jx: SIM.Jx * jS,
      L: SIM.L, lam: SIM.lam, R_z: SIM.R_z, n: SIM.decay_exp,
    };
    if (cfg.mismatch) {
      P.K_phi *= MISMATCH.K_phi_scale;
      P.A_GE *= MISMATCH.A_GE_scale;
      P.L *= MISMATCH.L_scale;
      P.R_z *= MISMATCH.R_z_scale;
      P.n = MISMATCH.decay_exp;
      P.lam = MISMATCH.lam;
    }
    this.plant = P;
    this.simRng = new Rng(rng.nextU32());

    this.useI = cfg.controller !== 'PD';
    this.useDob = cfg.controller === 'PID+DOB';
    this.useRes = cfg.controller === 'Res-NG' || cfg.controller === 'Res-G';
    this.useGate = cfg.controller === 'Res-G';
    this.net = this.useRes || probe ? net : null;

    // Vehicle starts stationary in the inertial frame → vy_rel = −vp
    this.state.set([SIM.z0, 0, this.y0, -P.vp, this.phi0, 0]);

    this.hist = record
      ? (Object.fromEntries(CHANNELS.map((c) => [c, new Float32Array(N_STEPS + 1)])) as Record<Channel, Float32Array>)
      : null;
  }

  get length(): number { return this.step; }

  /** Advance one 10 ms control/integration step. Returns false once landed. */
  advance(): boolean {
    if (this.done) return false;
    if (this.step >= N_STEPS) { this.finish(this.state); return false; }
    const s = this.state;
    const m = this.meas;
    const rng = this.simRng;
    const sg = SIM.sigma;
    const dt = SIM.dt;
    const t = this.step * dt;
    this.t = t;

    m[0] = s[0] + rng.normal(0, sg.z);
    m[1] = s[1] + rng.normal(0, sg.vz);
    m[2] = s[2] + rng.normal(0, sg.y);
    m[3] = s[3] + rng.normal(0, sg.vy);
    m[4] = s[4] + rng.normal(0, sg.phi);
    m[5] = s[5] + rng.normal(0, sg.p);

    // ---- Nominal cascaded controller (Eq 8) ----
    const ez = SIM.z0 - SIM.v_des * t - m[0];
    const evz = -SIM.v_des - m[1];
    if (this.useI) this.zInt = clamp(this.zInt + ez * dt, -2, 2);
    let uz = CONTROL.z.Kp * ez + CONTROL.z.Kd * evz;
    if (this.useI) uz += CONTROL.z.Ki * this.zInt;

    const phiDes = clamp(-(CONTROL.lat_Kp * m[2] + CONTROL.lat_Kd * m[3]), -0.5, 0.5);
    const ePhi = phiDes - m[4];
    if (this.useI) this.phiInt = clamp(this.phiInt + ePhi * dt, -0.5, 0.5);
    const Jn = SIM.Jx;
    let uphi = Jn * (CONTROL.phi.Kp * ePhi + CONTROL.phi.Kd * -m[5]);
    if (this.useI) uphi += Jn * CONTROL.phi.Ki * this.phiInt;

    if (this.useDob) {
      const l = 1 / CONTROL.dob_tau;
      this.dobZ += dt * (-l * this.dobZ - l * l * Jn * m[5] - l * uphi);
      this.dobEst = this.dobZ + l * Jn * m[5];
      uphi -= this.dobEst;
    }

    // ---- Residual correction (Eq 9–10, 12–13) ----
    let sigma = 1;
    this.tauHat = 0;
    this.aHat = 0;
    if (this.net) {
      const w = this.win;
      w.copyWithin(0, 6);
      w[18] = m[4]; w[19] = m[5]; w[20] = m[0]; w[21] = m[1]; w[22] = uphi; w[23] = uz;
      this.winCount++;
      if (this.winCount >= 4) {
        this.net.predict(w, this.res);
        const { d, idx } = this.net.distance(w);
        this.d = d;
        this.dIdx = idx;
        if (this.useGate) sigma = gateSigma(d, this.net.d0 * this.cfg.d0Scale, this.cfg.kappa);
        this.tauHat = this.res[0];
        this.aHat = this.res[1];
        if (this.useRes) {
          uphi -= sigma * this.res[0];
          uz -= sigma * this.res[1];
        }
      }
      this.sumSigma += sigma;
      this.nSigma++;
    }
    this.sigma = sigma;
    this.uphi = uphi;
    this.uz = uz;
    this.phiDes = phiDes;

    if (s[0] < ENVELOPE.final_approach_z) {
      const a = Math.abs(s[4]);
      this.sumPhi2 += a * a;
      this.nPhi++;
      if (a > this.peakPhi) this.peakPhi = a;
    }

    if (this.hist) this.record(t);

    const prevZ = s[0];
    const tauNoise = rng.normal(0, SIM.tau_noise_std);
    stepRK4(s, uz, uphi, this.plant, tauNoise);
    this.step++;

    if (prevZ > 0 && s[0] <= 0) {
      const contact = Float64Array.from(s);
      contact[0] = 0;
      s[0] = 0;
      this.t = this.step * dt;
      if (this.hist) this.record(this.t);
      this.finish(contact);
      return false;
    }
    if (s[0] < 0) s[0] = 0;
    return true;
  }

  private record(t: number): void {
    const h = this.hist!;
    const s = this.state;
    const P = this.plant;
    const i = this.step;
    const z = s[0] > 0.01 ? s[0] : 0.01;
    h.t[i] = t;
    h.z[i] = s[0];
    h.vz[i] = s[1];
    h.y[i] = s[2];
    h.vy[i] = s[3];
    h.phi[i] = s[4];
    h.p[i] = s[5];
    h.uphi[i] = this.uphi;
    h.uz[i] = this.uz;
    h.tauTrue[i] = dageTorque(z, s[3] + P.vp, P.vp, s[4], P.K_phi, P.L, P.lam, P.n);
    h.tauHat[i] = this.tauHat;
    h.aTrue[i] = geAccel(z, P.A_GE, P.R_z, P.n);
    h.aHat[i] = this.aHat;
    h.sigma[i] = this.sigma;
    h.d[i] = this.d;
    h.phiDes[i] = this.phiDes;
    h.xp[i] = P.vp * t;
    h.dob[i] = this.dobEst;
  }

  private finish(contact: Float64Array): void {
    this.done = true;
    const peak = this.nPhi ? this.peakPhi : Math.abs(contact[4]);
    const rms = this.nPhi ? Math.sqrt(this.sumPhi2 / this.nPhi) : peak;
    const dvy = Math.abs(contact[3]);
    const vz = Math.abs(contact[1]);
    this.result = {
      rmsPhi: rms,
      peakPhi: peak,
      dvy,
      vz,
      success: peak <= ENVELOPE.phi_max && vz <= ENVELOPE.vz_max && dvy <= ENVELOPE.dvy_max,
      rollViolation: peak > ENVELOPE.phi_max,
      meanSigma: this.nSigma ? this.sumSigma / this.nSigma : 1,
      touchdownT: this.step * SIM.dt,
      touchdownY: contact[2],
    };
  }

  /** Current DAGE torque acting on the vehicle (truth, for display). */
  trueTau(): number {
    const s = this.state;
    const P = this.plant;
    return dageTorque(Math.max(s[0], 0.01), s[3] + P.vp, P.vp, s[4], P.K_phi, P.L, P.lam, P.n);
  }

  trueGE(): number {
    const P = this.plant;
    return geAccel(Math.max(this.state[0], 0.01), P.A_GE, P.R_z, P.n);
  }
}

export function runTrial(cfg: TrialConfig, net: ResidualMLP | null): TrialResult {
  const tr = new Trial(cfg, net, false);
  while (tr.advance());
  return tr.result!;
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const p = k / n;
  const den = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / den;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
