/**
 * Theme bridge. All colours live as CSS custom properties in styles.css; this
 * module exposes them to canvas / WebGL code and tracks appearance changes
 * (system setting, the in-app switch, or a host-provided data-theme).
 */
import type { ControllerId } from '../sim/trial';

export const FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', Inter, 'Segoe UI', system-ui, sans-serif";

export const CTRL_VAR: Record<ControllerId, string> = {
  PD: 'var(--c-pd)',
  PID: 'var(--c-pid)',
  'PID+DOB': 'var(--c-dob)',
  'Res-NG': 'var(--c-resng)',
  'Res-G': 'var(--c-resg)',
};

export interface Theme {
  dark: boolean;
  bg: string;
  card: string;
  text: string;
  text2: string;
  text3: string;
  text4: string;
  grid: string;
  sep: string;
  fill: string;
  accent: string;
  ok: string;
  warn: string;
  crit: string;
  info: string;
  disturb: string;
  ctrl: Record<ControllerId, string>;
}

let cached: Theme | null = null;
const listeners = new Set<() => void>();

function read(): Theme {
  const s = getComputedStyle(document.documentElement);
  const v = (n: string) => s.getPropertyValue(n).trim();
  return {
    dark: v('--is-dark') === '1',
    bg: v('--bg'),
    card: v('--card'),
    text: v('--text'),
    text2: v('--text-2'),
    text3: v('--text-3'),
    text4: v('--text-4'),
    grid: v('--grid'),
    sep: v('--sep'),
    fill: v('--fill'),
    accent: v('--accent'),
    ok: v('--ok'),
    warn: v('--warn'),
    crit: v('--crit'),
    info: v('--info'),
    disturb: v('--disturb'),
    ctrl: { PD: v('--c-pd'), PID: v('--c-pid'), 'PID+DOB': v('--c-dob'), 'Res-NG': v('--c-resng'), 'Res-G': v('--c-resg') },
  };
}

export function theme(): Theme {
  if (!cached) cached = read();
  return cached;
}

export function onThemeChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function invalidate() {
  cached = null;
  // let the cascade settle before consumers re-read
  requestAnimationFrame(() => listeners.forEach((f) => f()));
}

/** Translucent version of a hex / rgb colour. */
export function alpha(color: string, a: number): string {
  const c = color.trim();
  if (c.startsWith('#')) {
    const h = c.length === 4 ? c.slice(1).split('').map((x) => x + x).join('') : c.slice(1, 7);
    const n = parseInt(h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const [r, g, b] = m[1].split(',').map((x) => x.trim());
    return `rgba(${r},${g},${b},${a})`;
  }
  return c;
}

// ---- appearance -----------------------------------------------------------
export type Appearance = 'system' | 'light' | 'dark';
const root = document.documentElement;
const hostTheme = root.getAttribute('data-theme'); // a host (e.g. an embedding page) may set this
let appearance: Appearance = 'system';
try {
  const saved = localStorage.getItem('dage-appearance');
  if (saved === 'light' || saved === 'dark') appearance = saved;
} catch { /* storage unavailable */ }
apply();

function apply() {
  if (appearance === 'system') {
    if (hostTheme) root.setAttribute('data-theme', hostTheme);
    else root.removeAttribute('data-theme');
  } else root.setAttribute('data-theme', appearance);
}

export function getAppearance(): Appearance { return appearance; }
export function setAppearance(a: Appearance) {
  appearance = a;
  try { localStorage.setItem('dage-appearance', a); } catch { /* ignore */ }
  apply();
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', invalidate);
new MutationObserver(invalidate).observe(root, { attributes: true, attributeFilter: ['data-theme'] });

/** [r, g, b] of a hex or rgb() colour. */
export function rgbOf(color: string): [number, number, number] {
  const c = color.trim();
  if (c.startsWith('#')) {
    const h = c.length === 4 ? c.slice(1).split('').map((x) => x + x).join('') : c.slice(1, 7);
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (m) { const [r, g, b] = m[1].split(',').map((x) => parseFloat(x)); return [r, g, b]; }
  return [128, 128, 128];
}
