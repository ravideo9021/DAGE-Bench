/**
 * FlightEngine — owns the live trials for the Flight console, advances them in
 * simulated time (100 Hz physics, decoupled from display refresh), and emits a
 * mission event log derived from the actual state of the simulation.
 */
import { Trial, CONTROLLERS, type ControllerId } from '../sim/trial';
import { getNetwork, FEATURE_NAMES } from '../sim/network';
import { SIM, ENVELOPE, MAX_TRAIN_SPEED, MISMATCH } from '../sim/physics';

export type LogLevel = 'sys' | 'info' | 'ok' | 'warn' | 'crit';
export interface LogEntry { id: number; t: number; level: LogLevel; key: string; msg: string }

export interface FlightConfig {
  controller: ControllerId;
  vp: number;
  seed: number;
  mismatch: boolean;
  kappa: number;
  d0Scale: number;
  compare: boolean;
  timeScale: number;
}

export interface Milestones { finalApproach?: number; groundEffect?: number; gate?: number; touchdown?: number }

export const COLORS: Record<ControllerId, string> = {
  PD: '#7c8794',
  PID: '#59a8ff',
  'PID+DOB': '#e8c547',
  'Res-NG': '#a78bfa',
  'Res-G': '#ff6b1a',
};

export function featureLabel(idx: number): string {
  const step = Math.floor(idx / 6);
  const f = FEATURE_NAMES[idx % 6];
  const lag = 3 - step;
  return lag === 0 ? `${f}[k]` : `${f}[k−${lag}]`;
}

type Listener = () => void;

export class FlightEngine {
  cfg: FlightConfig = {
    controller: 'Res-G',
    vp: 6.0,
    seed: 117,
    mismatch: false,
    kappa: 1.0,
    d0Scale: 1.0,
    compare: false,
    timeScale: 1.0,
  };
  trials: Trial[] = [];
  playing = true;
  version = 0;
  log: LogEntry[] = [];
  milestones: Milestones = {};
  autoCycle = false;
  private acc = 0;
  private logId = 0;
  private listeners = new Set<Listener>();
  private frameListeners = new Set<Listener>();
  private flags = { fa: false, ge: false, gate: false, gateLow: false, roll: false, capture: false };
  private finishedReported = new Set<Trial>();
  private cycleTimer = 0;

  constructor() { this.reset(); }

  get primary(): Trial { return this.trials[0]; }

  subscribe(fn: Listener): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  onFrame(fn: Listener): () => void { this.frameListeners.add(fn); return () => this.frameListeners.delete(fn); }
  private emit() { for (const f of this.listeners) f(); }
  emitFrame() { for (const f of this.frameListeners) f(); }

  set(partial: Partial<FlightConfig>, reset = true) {
    this.cfg = { ...this.cfg, ...partial };
    if (reset) this.reset();
    else this.emit();
  }

  reset() {
    const net = getNetwork();
    const ids: ControllerId[] = this.cfg.compare
      ? [this.cfg.controller, ...CONTROLLERS.filter((c) => c !== this.cfg.controller)]
      : [this.cfg.controller];
    this.trials = ids.map((controller) => new Trial({
      controller, vp: this.cfg.vp, seed: this.cfg.seed, mismatch: this.cfg.mismatch,
      kappa: this.cfg.kappa, d0Scale: this.cfg.d0Scale,
    }, net));
    this.acc = 0;
    this.version++;
    this.milestones = {};
    this.flags = { fa: false, ge: false, gate: false, gateLow: false, roll: false, capture: false };
    this.finishedReported.clear();
    this.cycleTimer = 0;
    this.log = [];
    const P = this.primary.plant;
    this.push('sys', 'LAUNCH', `Trial #${String(this.cfg.seed).padStart(4, '0')} · ${this.cfg.controller} · v_p ${this.cfg.vp.toFixed(1)} m/s nominal`);
    this.push('info', 'PLANT', `K_φ ${P.K_phi.toFixed(3)} · A_GE ${P.A_GE.toFixed(2)} · J_x ${P.Jx.toFixed(4)} · v_p ${P.vp.toFixed(2)}`);
    this.push('info', 'INIT', `z₀ ${SIM.z0.toFixed(2)} m · y₀ ${this.primary.y0.toFixed(2)} m · φ₀ ${(this.primary.phi0 * 57.2958).toFixed(2)}°`);
    if (this.cfg.vp > MAX_TRAIN_SPEED) this.push('warn', 'OOD', `Platform speed exceeds training envelope [0, ${MAX_TRAIN_SPEED.toFixed(1)}] m/s`);
    if (this.cfg.mismatch) this.push('warn', 'MISMATCH', `Plant perturbed: K_φ ×${MISMATCH.K_phi_scale} · A_GE ×${MISMATCH.A_GE_scale} · λ ${MISMATCH.lam.toFixed(2)} · n ${MISMATCH.decay_exp}`);
    this.emit();
  }

  togglePlay() {
    if (this.primary.done && this.trials.every((t) => t.done)) { this.reset(); this.playing = true; }
    else this.playing = !this.playing;
    this.emit();
  }

  nextSeed() { this.set({ seed: this.cfg.seed + 1 }); this.playing = true; }

  /** Advance by a wall-clock delta (seconds). */
  tick(dtReal: number) {
    if (!this.playing) return;
    const all = this.trials.every((t) => t.done);
    if (all) {
      if (this.autoCycle) {
        this.cycleTimer += dtReal;
        if (this.cycleTimer > 4.5) this.nextSeed();
      }
      return;
    }
    this.acc += Math.min(dtReal, 0.1) * this.cfg.timeScale;
    let n = Math.floor(this.acc / SIM.dt);
    this.acc -= n * SIM.dt;
    n = Math.min(n, 200);
    for (let i = 0; i < n; i++) {
      let any = false;
      for (const t of this.trials) if (t.advance()) any = true;
      this.observe();
      if (!any) break;
    }
  }

  private observe() {
    const tr = this.primary;
    const s = tr.state;
    const t = tr.t;
    const f = this.flags;
    if (!f.capture && Math.abs(s[3]) < 0.25 && Math.abs(s[2]) < 0.6 && t > 0.5) {
      f.capture = true;
      this.push('ok', 'CAPTURE', `Platform speed matched · Δv_y ${s[3].toFixed(2)} m/s · y_rel ${s[2].toFixed(2)} m`, t);
    }
    if (!f.fa && s[0] < ENVELOPE.final_approach_z && !tr.done) {
      f.fa = true;
      this.milestones.finalApproach = t;
      this.push('info', 'FINAL', `Final approach · z < ${ENVELOPE.final_approach_z.toFixed(2)} m · DAGE torque ${tr.trueTau().toFixed(4)} N·m`, t);
    }
    if (!f.ge && s[0] < tr.plant.R_z && !tr.done) {
      f.ge = true;
      this.milestones.groundEffect = t;
      this.push('warn', 'GND EFF', `Ground-effect cushion · a_GE ${tr.trueGE().toFixed(2)} m/s² (${((tr.trueGE() / 9.81) * 100).toFixed(0)}% g)`, t);
    }
    if (tr.cfg.controller === 'Res-G') {
      if (!f.gateLow && tr.sigma < 0.9) {
        f.gateLow = true;
        if (!f.gate) { f.gate = true; this.milestones.gate = t; }
        this.push('warn', 'GATE', `Attenuating residual · σ ${tr.sigma.toFixed(3)} · d ${tr.d.toFixed(2)} > d₀ ${(getNetwork().d0 * this.cfg.d0Scale).toFixed(2)} · driver ${featureLabel(tr.dIdx)}`, t);
      } else if (f.gateLow && tr.sigma > 0.995) {
        f.gateLow = false;
        this.push('ok', 'GATE', `Back in distribution · σ → ${tr.sigma.toFixed(3)}`, t);
      }
    }
    if (!f.roll && s[0] < ENVELOPE.final_approach_z && Math.abs(s[4]) > ENVELOPE.phi_max && !tr.done) {
      f.roll = true;
      this.push('crit', 'ROLL', `Roll exceedance · |φ| ${(Math.abs(s[4]) * 57.2958).toFixed(2)}° > ${(ENVELOPE.phi_max * 57.2958).toFixed(2)}°`, t);
    }
    for (const trial of this.trials) {
      if (trial.done && !this.finishedReported.has(trial)) {
        this.finishedReported.add(trial);
        const r = trial.result!;
        if (trial === tr) {
          this.milestones.touchdown = r.touchdownT;
          this.push(r.success ? 'ok' : 'crit', 'TOUCHDOWN', `t ${r.touchdownT.toFixed(2)} s · |v_z| ${r.vz.toFixed(3)} · |Δv_y| ${r.dvy.toFixed(3)} · peak |φ| ${r.peakPhi.toFixed(4)} rad`, r.touchdownT);
          this.push(r.success ? 'ok' : 'crit', 'ENVELOPE', r.success ? 'PASS — all three touchdown criteria satisfied' : `FAIL — ${failReasons(r).join(', ')}`, r.touchdownT);
          this.emit();
        } else {
          this.push('sys', trial.cfg.controller.toUpperCase(), `landed t ${r.touchdownT.toFixed(2)} s · ${r.success ? 'PASS' : 'FAIL'} · peak |φ| ${r.peakPhi.toFixed(4)}`, r.touchdownT);
        }
      }
    }
  }

  private push(level: LogLevel, key: string, msg: string, t = 0) {
    this.log.push({ id: ++this.logId, t, level, key, msg });
    if (this.log.length > 120) this.log.shift();
  }
}

export function failReasons(r: { peakPhi: number; vz: number; dvy: number }): string[] {
  const out: string[] = [];
  if (r.peakPhi > ENVELOPE.phi_max) out.push('roll');
  if (r.vz > ENVELOPE.vz_max) out.push('impact speed');
  if (r.dvy > ENVELOPE.dvy_max) out.push('lateral slip');
  return out;
}

export const engine = new FlightEngine();
