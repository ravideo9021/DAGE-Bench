import { useCallback, useEffect, useLayoutEffect, useReducer, useRef } from 'react';
import { onThemeChange } from './theme';

/** Re-render at a fixed rate while `active`. */
export function useTicker(hz: number, active = true): number {
  const [n, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(bump, 1000 / hz);
    return () => window.clearInterval(id);
  }, [hz, active]);
  return n;
}

export interface CanvasCtx { ctx: CanvasRenderingContext2D; w: number; h: number; dpr: number }

/**
 * Sized, DPR-aware canvas. `draw` is called on resize and whenever `redraw()`
 * is invoked by the returned handle (e.g. from an animation loop).
 */
export function useCanvas(draw: (c: CanvasCtx) => void) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  useLayoutEffect(() => { drawRef.current = draw; });
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const redraw = useCallback(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx || !size.current.w) return;
    const { w, h, dpr } = size.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    drawRef.current({ ctx, w, h, dpr });
  }, []);
  useLayoutEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ro = new ResizeObserver(() => {
      const r = cv.parentElement!.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      size.current = { w: r.width, h: r.height, dpr };
      cv.width = Math.max(1, Math.round(r.width * dpr));
      cv.height = Math.max(1, Math.round(r.height * dpr));
      redraw();
    });
    ro.observe(cv.parentElement!);
    return () => ro.disconnect();
  }, [redraw]);
  useEffect(() => onThemeChange(redraw), [redraw]);
  return { ref, redraw };
}

export const fmt = {
  f: (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d).replace('-', '−') : '—'),
  s: (v: number, d = 2) => (Number.isFinite(v) ? (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d) : '—'),
  deg: (rad: number, d = 2) => (rad * 57.29578).toFixed(d).replace('-', '−'),
};
