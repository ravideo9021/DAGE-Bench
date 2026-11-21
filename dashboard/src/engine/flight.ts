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
    this.push('sys', 'Launch', `Seed ${this.cfg.seed} · ${this.cfg.controller} · platform ${this.cfg.vp.toFixed(1)} m/s`);
    this.push('info', 'Plant sampled', `K_φ ${P.K_phi.toFixed(3)} · A_GE ${P.A_GE.toFixed(2)} · J_x ${P.Jx.toFixed(4)} · v_p ${P.vp.toFixed(2)}`);
    this.push('info', 'Initial state', `z₀ ${SIM.z0.toFixed(2)} m · y₀ ${this.primary.y0.toFixed(2)} m · φ₀ ${(this.primary.phi0 * 57.2958).toFixed(2)}°`);
    if (this.cfg.vp > MAX_TRAIN_SPEED) this.push('warn', 'Outside training data', `Platform speed is above the ${MAX_TRAIN_SPEED.toFixed(1)} m/s training range`);
    if (this.cfg.mismatch) this.push('warn', 'Model mismatch', `Plant perturbed: K_φ ×${MISMATCH.K_phi_scale} · A_GE ×${MISMATCH.A_GE_scale} · λ ${MISMATCH.lam.toFixed(2)} · n ${MISMATCH.decay_exp}`);
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
      this.push('ok', 'Speed matched', `Relative speed ${s[3].toFixed(2)} m/s, offset ${s[2].toFixed(2)} m`, t);
    }
    if (!f.fa && s[0] < ENVELOPE.final_approach_z && !tr.done) {
      f.fa = true;
      this.milestones.finalApproach = t;
      this.push('info', 'Final approach', `Below ${ENVELOPE.final_approach_z.toFixed(1)} m · DAGE torque ${tr.trueTau().toFixed(4)} N·m`, t);
    }
    if (!f.ge && s[0] < tr.plant.R_z && !tr.done) {
      f.ge = true;
      this.milestones.groundEffect = t;
      this.push('warn', 'Ground effect', `Cushion lift ${tr.trueGE().toFixed(2)} m/s² (${((tr.trueGE() / 9.81) * 100).toFixed(0)}% of g)`, t);
    }
    if (tr.cfg.controller === 'Res-G') {
      if (!f.gateLow && tr.sigma < 0.9) {
        f.gateLow = true;
        if (!f.gate) { f.gate = true; this.milestones.gate = t; }
        this.push('warn', 'Gate engaged', `σ ${tr.sigma.toFixed(3)} · distance ${tr.d.toFixed(2)} above ${(getNetwork().d0 * this.cfg.d0Scale).toFixed(2)} · driven by ${featureLabel(tr.dIdx)}`, t);
      } else if (f.gateLow && tr.sigma > 0.995) {
        f.gateLow = false;
        this.push('ok', 'Gate released', `Back in distribution · σ ${tr.sigma.toFixed(3)}`, t);
      }
    }
    if (!f.roll && s[0] < ENVELOPE.final_approach_z && Math.abs(s[4]) > ENVELOPE.phi_max && !tr.done) {
      f.roll = true;
      this.push('crit', 'Roll limit exceeded', `|φ| ${(Math.abs(s[4]) * 57.2958).toFixed(2)}° against a ${(ENVELOPE.phi_max * 57.2958).toFixed(2)}° limit`, t);
    }
    for (const trial of this.trials) {
      if (trial.done && !this.finishedReported.has(trial)) {
        this.finishedReported.add(trial);
        const r = trial.result!;
        if (trial === tr) {
          this.milestones.touchdown = r.touchdownT;
          this.push(r.success ? 'ok' : 'crit', 'Touchdown', `${r.touchdownT.toFixed(2)} s · sink ${r.vz.toFixed(3)} m/s · slip ${r.dvy.toFixed(3)} m/s · peak roll ${r.peakPhi.toFixed(4)} rad`, r.touchdownT);
          this.push(r.success ? 'ok' : 'crit', r.success ? 'Envelope passed' : 'Envelope failed', r.success ? 'All three touchdown criteria met' : `Exceeded: ${failReasons(r).join(', ')}`, r.touchdownT);
          this.emit();
        } else {
          this.push('sys', `${trial.cfg.controller} landed`, `${r.success ? 'Passed' : 'Failed'} at ${r.touchdownT.toFixed(2)} s · peak roll ${r.peakPhi.toFixed(4)} rad`, r.touchdownT);
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
  if (r.peakPhi > ENVELOPE.phi_max) out.push('roll angle');
  if (r.vz > ENVELOPE.vz_max) out.push('impact speed');
  if (r.dvy > ENVELOPE.dvy_max) out.push('sideways slip');
  return out;
}

export const engine = new FlightEngine();
