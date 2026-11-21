import { lazy, Suspense, useEffect, useState } from 'react';
import { Plane, LayoutGrid, BrainCircuit, ShieldCheck, Waves, BarChart3, BadgeCheck, Sun, Moon, MonitorSmartphone, House, BookOpen } from 'lucide-react';
import FlightView from './views/FlightView';
import { VerifySheet } from './views/Verify';
import { runChecks, CHECK_COUNT, type Check } from './sim/checks';
import { getAppearance, setAppearance, type Appearance } from './ui/theme';
import { Seg } from './ui/kit';

const MonteCarloView = lazy(() => import('./views/MonteCarloView'));
const ModelView = lazy(() => import('./views/ModelView'));
const GateView = lazy(() => import('./views/GateView'));
const PhysicsView = lazy(() => import('./views/PhysicsView'));
const ResultsView = lazy(() => import('./views/ResultsView'));
const Overview = lazy(() => import('./views/Overview'));
const Docs = lazy(() => import('./views/Docs'));

const VIEWS = [
  { id: 'overview', label: 'Overview', short: 'Home', icon: House, group: 'Project', tab: true },
  { id: 'docs', label: 'Documentation', short: 'Docs', icon: BookOpen, group: 'Project', tab: true },
  { id: 'flight', label: 'Flight', short: 'Flight', icon: Plane, group: 'Simulate', tab: true },
  { id: 'montecarlo', label: 'Monte Carlo', short: 'Batch', icon: LayoutGrid, group: 'Simulate', tab: true },
  { id: 'model', label: 'Network', short: 'Network', icon: BrainCircuit, group: 'Understand', tab: true },
  { id: 'gate', label: 'Safety Gate', short: 'Gate', icon: ShieldCheck, group: 'Understand', tab: false },
  { id: 'physics', label: 'Disturbance', short: 'Physics', icon: Waves, group: 'Understand', tab: false },
  { id: 'results', label: 'Results', short: 'Results', icon: BarChart3, group: 'Publish', tab: true },
] as const;
type ViewId = (typeof VIEWS)[number]['id'];
const GROUPS = ['Project', 'Simulate', 'Understand', 'Publish'] as const;

function readHash(): ViewId {
  const h = window.location.hash.replace('#', '') as ViewId;
  return VIEWS.some((v) => v.id === h) ? h : 'overview';
}

export default function App() {
  const [view, setView] = useState<ViewId>(readHash);
  const [checks, setChecks] = useState<Check[]>([]);
  const [sheet, setSheet] = useState<'verify' | 'keys' | null>(null);
  const [appearance, setApp] = useState<Appearance>(getAppearance);

  useEffect(() => {
    runChecks(setChecks);
    const onHash = () => setView(readHash());
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' && (e.target as HTMLInputElement).type === 'text') return;
      if (e.key === '?') setSheet((s) => (s === 'keys' ? null : 'keys'));
      if (e.key === 'Escape') setSheet(null);
    };
    window.addEventListener('hashchange', onHash);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('hashchange', onHash); window.removeEventListener('keydown', onKey); };
  }, []);

  const go = (v: ViewId) => {
    history.replaceState(null, '', `#${v}`);
    setView(v);
    document.querySelector('.main')?.scrollTo({ top: 0 });
  };
  const changeAppearance = (a: Appearance) => { setAppearance(a); setApp(a); };
  const done = checks.length === CHECK_COUNT;
  const allOk = done && checks.every((c) => c.ok);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v10M7.5 8.5 12 13l4.5-4.5" />
              <path d="M4 19h16" opacity="0.85" />
            </svg>
          </div>
          <div>
            <div className="brand-name">DAGE-Bench</div>
            <div className="brand-sub">Landing control lab</div>
          </div>
        </div>
        <nav aria-label="Sections">
          {GROUPS.map((g) => (
            <div key={g}>
              <div className="side-h">{g}</div>
              {VIEWS.filter((v) => v.group === g).map((v) => {
                const I = v.icon;
                return (
                  <button key={v.id} type="button" className="side-item" aria-current={view === v.id ? 'page' : undefined} onClick={() => go(v.id)}>
                    <I size={17} strokeWidth={1.9} />
                    {v.label}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="side-spacer" />
        <div className="side-foot">
          <Seg
            label="Appearance"
            value={appearance}
            onChange={changeAppearance}
            options={[
              { value: 'light', label: <Sun size={14} aria-label="Light" /> },
              { value: 'system', label: <MonitorSmartphone size={14} aria-label="Automatic" /> },
              { value: 'dark', label: <Moon size={14} aria-label="Dark" /> },
            ]}
          />
          <button type="button" className="verify-pill" onClick={() => setSheet('verify')}>
            {done ? <BadgeCheck size={22} strokeWidth={1.8} style={{ color: allOk ? 'var(--ok)' : 'var(--crit)', flex: 'none' }} /> : <span className="spinner" style={{ flex: 'none' }} />}
            <span>
              <b>{done ? (allOk ? 'Verified' : 'Check failed') : 'Verifying…'}</b>
              <span>{done ? `${checks.filter((c) => c.ok).length} of ${CHECK_COUNT} checks passed` : `${checks.length} of ${CHECK_COUNT}`}</span>
            </span>
          </button>
        </div>
      </aside>

      <main className="main">
        <Suspense fallback={<div className="view-scroll"><span className="spinner" /></div>}>
          {view === 'overview' && <Overview go={go} />}
          {view === 'docs' && <Docs />}
          {view === 'flight' && <FlightView />}
          {view === 'montecarlo' && <MonteCarloView />}
          {view === 'model' && <ModelView />}
          {view === 'gate' && <GateView />}
          {view === 'physics' && <PhysicsView />}
          {view === 'results' && <ResultsView />}
        </Suspense>
      </main>

      <nav className="tabbar" aria-label="Sections">
        {VIEWS.filter((v) => v.tab).map((v) => {
          const I = v.icon;
          return (
            <button key={v.id} type="button" aria-current={view === v.id ? 'page' : undefined} onClick={() => go(v.id)}>
              <I size={21} strokeWidth={1.8} />
              {v.short}
            </button>
          );
        })}
      </nav>

      {sheet === 'verify' && <VerifySheet checks={checks} onClose={() => setSheet(null)} />}
      {sheet === 'keys' && (
        <div className="sheet-backdrop" onClick={() => setSheet(null)}>
          <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-h"><div><h2>Keyboard shortcuts</h2><p>Available on the Flight view.</p></div></div>
            <div className="sheet-b">
              <dl className="kv">
                <dt>Play or pause</dt><dd><span className="kbd">Space</span></dd>
                <dt>Restart this landing</dt><dd><span className="kbd">R</span></dd>
                <dt>Next seed</dt><dd><span className="kbd">N</span></dd>
                <dt>Choose controller</dt><dd><span className="kbd">1</span> – <span className="kbd">5</span></dd>
                <dt>Compare all controllers</dt><dd><span className="kbd">C</span></dd>
                <dt>Model mismatch</dt><dd><span className="kbd">M</span></dd>
                <dt>Change camera</dt><dd><span className="kbd">V</span></dd>
              </dl>
            </div>
            <div className="sheet-f"><button type="button" className="btn primary" onClick={() => setSheet(null)}>Done</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
