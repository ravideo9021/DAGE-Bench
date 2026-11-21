import { useEffect } from 'react';
import type { Trial, Channel } from '../sim/trial';
import { useCanvas } from './hooks';
import { theme, alpha, FONT, onThemeChange } from './theme';

export interface StripSeries {
  trial: Trial;
  ch: Channel;
  color: string;
  width?: number;
  dash?: number[];
  alpha?: number;
  scale?: number;
  abs?: boolean;
  fill?: boolean;
}

interface Props {
  series: () => StripSeries[];
  range: [number, number] | { auto: true; min: number; symmetric?: boolean };
  hlines?: { y: number; color: string; label?: string; dash?: number[] }[];
  bands?: { y0: number; y1: number; color: string }[];
  tMax?: number;
  subscribe: (cb: () => void) => () => void;
  fmtY?: (v: number) => string;
}

export default function StripChart(p: Props) {
  const { ref, redraw } = useCanvas(({ ctx, w, h }) => {
    const th = theme();
    const L = 40, R = 10, T = 10, B = 20;
    const pw = w - L - R;
    const ph = h - T - B;
    const tMax = p.tMax ?? 12;
    const ser = p.series();

    let lo: number, hi: number;
    if (Array.isArray(p.range)) [lo, hi] = p.range;
    else {
      let m = p.range.min;
      let mn = Infinity, mx = -Infinity;
      for (const s of ser) {
        const hist = s.trial.hist;
        if (!hist) continue;
        const d = hist[s.ch];
        const k = s.scale ?? 1;
        for (let i = 0; i < s.trial.step; i++) {
          let v = d[i] * k;
          if (s.abs) v = Math.abs(v);
          if (v < mn) mn = v;
          if (v > mx) mx = v;
          if (Math.abs(v) > m) m = Math.abs(v);
        }
      }
      if (p.range.symmetric !== false) { lo = -m * 1.12; hi = m * 1.12; }
      else {
        if (!Number.isFinite(mn)) { mn = 0; mx = p.range.min; }
        lo = Math.min(0, mn); hi = Math.max(p.range.min, mx * 1.1);
      }
    }
    const X = (t: number) => L + (t / tMax) * pw;
    const Y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * ph;

    for (const b of p.bands ?? []) {
      ctx.fillStyle = b.color;
      const y0 = Y(Math.min(hi, Math.max(lo, b.y1)));
      const y1 = Y(Math.min(hi, Math.max(lo, b.y0)));
      ctx.fillRect(L, y0, pw, y1 - y0);
    }

    ctx.font = `500 10.5px ${FONT}`;
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;
    const step = niceStep((hi - lo) / 4);
    ctx.textAlign = 'right';
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
      const y = Math.round(Y(v)) + 0.5;
      ctx.strokeStyle = Math.abs(v) < 1e-9 ? th.sep : th.grid;
      ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke();
      ctx.fillStyle = th.text3;
      ctx.fillText((p.fmtY ?? defaultFmt(step))(v), L - 8, y);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = th.text3;
    for (let t = 0; t <= tMax; t += 2) ctx.fillText(t === 0 ? '0 s' : `${t}`, X(t), T + ph + 6);

    for (const hl of p.hlines ?? []) {
      if (hl.y < lo || hl.y > hi) continue;
      const y = Math.round(Y(hl.y)) + 0.5;
      ctx.strokeStyle = hl.color;
      ctx.setLineDash(hl.dash ?? [4, 4]);
      ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke();
      ctx.setLineDash([]);
      if (hl.label) {
        ctx.fillStyle = hl.color;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText(hl.label, L + pw - 2, y - 3);
      }
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(L, T - 4, pw, ph + 8);
    ctx.clip();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (let si = ser.length - 1; si >= 0; si--) {
      const s = ser[si];
      const hist = s.trial.hist;
      if (!hist) continue;
      const d = hist[s.ch];
      const tt = hist.t;
      const n = s.trial.step + (s.trial.done ? 1 : 0);
      if (n < 2) continue;
      const k = s.scale ?? 1;
      const stride = n > pw * 2 ? 2 : 1;
      const path = new Path2D();
      let lastX = 0;
      for (let i = 0; i < n; i += stride) {
        let v = d[i] * k;
        if (s.abs) v = Math.abs(v);
        const x = X(tt[i]);
        if (i === 0) path.moveTo(x, Y(v)); else path.lineTo(x, Y(v));
        lastX = x;
      }
      if (s.fill) {
        const area = new Path2D(path);
        const base = Y(Math.max(lo, Math.min(hi, 0)));
        area.lineTo(lastX, base);
        area.lineTo(X(tt[0]), base);
        area.closePath();
        const g = ctx.createLinearGradient(0, T, 0, T + ph);
        g.addColorStop(0, alpha(s.color, 0.22));
        g.addColorStop(1, alpha(s.color, 0));
        ctx.fillStyle = g;
        ctx.globalAlpha = 1;
        ctx.fill(area);
      }
      ctx.strokeStyle = s.color;
      ctx.globalAlpha = s.alpha ?? 1;
      ctx.lineWidth = s.width ?? 1.6;
      ctx.setLineDash(s.dash ?? []);
      ctx.stroke(path);
      if (si === 0 && !s.trial.done) {
        const i = n - 1;
        let v = d[i] * k;
        if (s.abs) v = Math.abs(v);
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        ctx.fillStyle = alpha(s.color, 0.22);
        ctx.beginPath(); ctx.arc(X(tt[i]), Y(v), 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = s.color;
        ctx.beginPath(); ctx.arc(X(tt[i]), Y(v), 3, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
  });

  const { subscribe } = p;
  useEffect(() => subscribe(redraw), [subscribe, redraw]);
  useEffect(() => onThemeChange(redraw), [redraw]);
  return <div className="chart-wrap"><canvas ref={ref} /></div>;
}

function niceStep(raw: number): number {
  const e = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const f = raw / e;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * e;
}

function defaultFmt(step: number) {
  const d = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
  return (v: number) => (Math.abs(v) < 1e-12 ? '0' : v.toFixed(d));
}
