import { lazy, Suspense, useEffect, useState } from 'react';
import { Plane, Grid3x3, BrainCircuit, ShieldCheck, Waves, FileBarChart2, Keyboard } from 'lucide-react';
import Boot from './views/Boot';
import FlightView from './views/FlightView';
import { getNetwork } from './sim/network';
import { workerCount } from './engine/montecarlo';

const MonteCarloView = lazy(() => import('./views/MonteCarloView'));
const ModelView = lazy(() => import('./views/ModelView'));
const GateView = lazy(() => import('./views/GateView'));
const PhysicsView = lazy(() => import('./views/PhysicsView'));
const ResultsView = lazy(() => import('./views/ResultsView'));

const VIEWS = [
  { id: 'flight', label: 'FLIGHT', title: 'Live flight simulation', icon: Plane },
  { id: 'montecarlo', label: 'MONTE C.', title: 'Monte Carlo campaign', icon: Grid3x3 },
  { id: 'model', label: 'MODEL', title: 'Residual network', icon: BrainCircuit },
  { id: 'gate', label: 'GATE', title: 'Safety gate lab', icon: ShieldCheck },
  { id: 'physics', label: 'PHYSICS', title: 'Disturbance model', icon: Waves },
  { id: 'results', label: 'RESULTS', title: 'Published results', icon: FileBarChart2 },
] as const;
type ViewId = (typeof VIEWS)[number]['id'];

function readHash(): ViewId {
  const h = window.location.hash.replace('#', '') as ViewId;
  return VIEWS.some((v) => v.id === h) ? h : 'flight';
}

export default function App() {
  const [view, setView] = useState<ViewId>(readHash);
  const [booted, setBooted] = useState(() => {
    try { return sessionStorage.getItem('dage-booted') === '1'; } catch { return false; }
  });
  const [help, setHelp] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const onHash = () => setView(readHash());
    window.addEventListener('hashchange', onHash);
    const id = window.setInterval(() => setNow(new Date()), 1000);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '?') setHelp((h) => !h);
      if (e.key === 'Escape') setHelp(false);
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('hashchange', onHash); window.clearInterval(id); window.removeEventListener('keydown', onKey); };
  }, []);

  const go = (v: ViewId) => { history.pushState(null, '', `#${v}`); setView(v); };
  const meta = VIEWS.find((v) => v.id === view)!;
  const net = getNetwork();

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
            <path d="M6 23h20" stroke="#ff6b1a" strokeWidth="2.4" strokeLinecap="round" />
            <path d="M16 6v11M11 12l5 5 5-5" fill="none" stroke="#e8ecef" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="brand-title">
          <b>DAGE · FLIGHT CONSOLE</b>
          <span>Gated residual landing control</span>
        </div>
        <div className="topbar-view"><i>/</i>{meta.title}</div>
        <div className="topbar-spacer" />
        <div className="chips">
          <div className="chip keep"><span className="dot" /> MODEL <b>VERIFIED</b></div>
          <div className="chip opt">NET <b>{net.nParams.toLocaleString()}</b> params</div>
          <div className="chip opt">SIM <b>100 Hz</b> RK4</div>
          <div className="chip opt">GATE d₀ <b>{net.d0.toFixed(2)}</b></div>
          <div className="chip opt">WORKERS <b>{workerCount()}</b></div>
          <div className="chip"><b className="mono">{now.toISOString().slice(11, 19)}</b> UTC</div>
          <button type="button" className="chip" style={{ background: 'none', border: 0, borderLeft: '1px solid var(--line)' }} onClick={() => setHelp(true)} aria-label="Keyboard shortcuts">
            <Keyboard size={14} />
          </button>
        </div>
      </header>

      <nav className="rail" aria-label="Views">
        {VIEWS.map((v) => {
          const I = v.icon;
          return (
            <button key={v.id} type="button" className="rail-btn" aria-current={view === v.id ? 'page' : undefined} onClick={() => go(v.id)} title={v.title}>
              <I size={18} strokeWidth={1.6} />
              {v.label}
            </button>
          );
        })}
        <div className="rail-spacer" />
        <div className="rail-foot">v1.0<br />DAGE</div>
      </nav>

      <main className="view">
        <Suspense fallback={<div style={{ padding: 30 }} className="mono"><span className="spinner" style={{ display: 'inline-block', marginRight: 10 }} />Loading module…</div>}>
          {view === 'flight' && <FlightView />}
          {view === 'montecarlo' && <MonteCarloView />}
          {view === 'model' && <ModelView />}
          {view === 'gate' && <GateView />}
          {view === 'physics' && <PhysicsView />}
          {view === 'results' && <ResultsView />}
        </Suspense>
      </main>

      {!booted && <Boot onDone={() => { setBooted(true); try { sessionStorage.setItem('dage-booted', '1'); } catch { /* ignore */ } }} />}

      {help && (
        <div className="help-overlay" onClick={() => setHelp(false)}>
          <div className="panel help-card" onClick={(e) => e.stopPropagation()}>
            <header className="panel-h"><span className="tag">SYS</span><h3>Keyboard</h3><div className="right"><button type="button" className="btn sm ghost" onClick={() => setHelp(false)}>Close</button></div></header>
            <div className="panel-b">
              <dl className="kv">
                <dt>Play / pause</dt><dd><span className="kbd">Space</span></dd>
                <dt>Reset trial</dt><dd><span className="kbd">R</span></dd>
                <dt>Next seed</dt><dd><span className="kbd">N</span></dd>
                <dt>Select controller</dt><dd><span className="kbd">1</span>–<span className="kbd">5</span></dd>
                <dt>Compare all controllers</dt><dd><span className="kbd">C</span></dd>
                <dt>Toggle model mismatch</dt><dd><span className="kbd">M</span></dd>
                <dt>Cycle camera</dt><dd><span className="kbd">V</span></dd>
                <dt>This panel</dt><dd><span className="kbd">?</span></dd>
              </dl>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
