/**
 * Monte Carlo campaign runner. Splits every (speed × controller) cell into
 * chunks of trials and farms them out to a pool of Web Workers, each running
 * the full TypeScript simulator + trained MLP. Falls back to time-sliced
 * main-thread execution where workers are unavailable.
 */
import type { ControllerId } from '../sim/trial';
import { wilson } from '../sim/trial';
import { FIELDS, runTask, type McTask } from './mc.worker';

export interface McCell {
  vp: number;
  controller: ControllerId;
  n: number;
  done: number;
  ok: number;
  data: Float64Array; // n * FIELDS
}

export interface McSettings {
  speeds: number[];
  controllers: ControllerId[];
  nTrials: number;
  mismatch: boolean;
  kappa: number;
  d0Scale: number;
}

export function workerCount(): number {
  const hc = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  return Math.max(2, Math.min(8, hc - 1));
}

const CHUNK = 20;

export class McCampaign {
  cells: McCell[] = [];
  settings: McSettings | null = null;
  running = false;
  startedAt = 0;
  finishedAt = 0;
  trialsDone = 0;
  trialsTotal = 0;
  inferences = 0;
  simSeconds = 0;
  mode: 'workers' | 'main' = 'workers';
  private queue: McTask[] = [];
  private workers: Worker[] = [];
  private listeners = new Set<() => void>();
  private taskId = 0;
  private gen = 0;

  subscribe(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit() { for (const f of this.listeners) f(); }

  start(s: McSettings) {
    this.abort();
    this.gen++;
    this.settings = s;
    this.cells = [];
    for (const controller of s.controllers)
      for (const vp of s.speeds)
        this.cells.push({ vp, controller, n: s.nTrials, done: 0, ok: 0, data: new Float64Array(s.nTrials * FIELDS) });
    this.queue = [];
    // interleave cells so every cell fills progressively
    for (let start = 0; start < s.nTrials; start += CHUNK) {
      this.cells.forEach((c, cell) => {
        this.queue.push({ id: ++this.taskId, cell, start, count: Math.min(CHUNK, s.nTrials - start), controller: c.controller, vp: c.vp, mismatch: s.mismatch, kappa: s.kappa, d0Scale: s.d0Scale });
      });
    }
    this.trialsDone = 0;
    this.trialsTotal = this.cells.length * s.nTrials;
    this.inferences = 0;
    this.simSeconds = 0;
    this.running = true;
    this.startedAt = performance.now();
    this.finishedAt = 0;
    this.spawn();
    this.emit();
  }

  private spawn() {
    const n = workerCount();
    try {
      for (let i = 0; i < n; i++) {
        const w = new Worker(new URL('./mc.worker.ts', import.meta.url), { type: 'module' });
        w.onmessage = (e) => this.accept(e.data, w);
        w.onerror = () => this.fallback();
        this.workers.push(w);
        this.feed(w);
      }
      this.mode = 'workers';
    } catch {
      this.fallback();
    }
  }

  private fallback() {
    if (this.mode === 'main' && !this.workers.length) return;
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.mode = 'main';
    const gen = this.gen;
    const pump = () => {
      if (gen !== this.gen || !this.running) return;
      const t0 = performance.now();
      while (this.queue.length && performance.now() - t0 < 14) {
        const task = this.queue.shift()!;
        this.accept({ cell: task.cell, start: task.start, count: task.count, data: runTask(task) }, null);
      }
      if (this.queue.length) setTimeout(pump, 0);
    };
    setTimeout(pump, 0);
  }

  private feed(w: Worker) {
    const t = this.queue.shift();
    if (t) w.postMessage(t);
  }

  private accept(msg: { cell: number; start: number; count: number; data: Float64Array }, w: Worker | null) {
    const c = this.cells[msg.cell];
    if (!c) return;
    c.data.set(msg.data, msg.start * FIELDS);
    for (let i = 0; i < msg.count; i++) {
      c.ok += msg.data[i * FIELDS + 5];
      this.simSeconds += msg.data[i * FIELDS + 6];
      if (c.controller.startsWith('Res')) this.inferences += Math.max(0, Math.round(msg.data[i * FIELDS + 6] / 0.01) - 3);
    }
    c.done += msg.count;
    this.trialsDone += msg.count;
    if (w) this.feed(w);
    if (this.trialsDone >= this.trialsTotal) {
      this.running = false;
      this.finishedAt = performance.now();
      for (const x of this.workers) x.terminate();
      this.workers = [];
    }
    this.emit();
  }

  abort() {
    this.gen++;
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.queue = [];
    if (this.running) { this.running = false; this.finishedAt = performance.now(); }
    this.emit();
  }

  elapsed(): number { return ((this.running ? performance.now() : this.finishedAt) - this.startedAt) / 1000; }
}

export function cellStats(c: McCell) {
  const [lo, hi] = wilson(c.ok, c.done);
  let peak = 0, rms = 0, dvy = 0, vz = 0, sig = 0;
  for (let i = 0; i < c.n; i++) {
    const o = i * FIELDS;
    if (!(c.data[o + 6] > 0)) continue; // slot not yet filled (chunks finish out of order)
    peak += c.data[o]; dvy += c.data[o + 1]; vz += c.data[o + 2]; rms += c.data[o + 3]; sig += c.data[o + 4];
  }
  const n = Math.max(1, c.done);
  return { rate: c.done ? c.ok / c.done : 0, lo, hi, peak: peak / n, rms: rms / n, dvy: dvy / n, vz: vz / n, sigma: sig / n };
}

export { FIELDS };
export const campaign = new McCampaign();
