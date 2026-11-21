import { useEffect, useRef, useState } from 'react';
import { Plane, LayoutGrid, BrainCircuit, ShieldCheck, Waves, BookOpen, ChevronRight, ArrowRight } from 'lucide-react';
import { FlightEngine } from '../engine/flight';
import { FlightScene } from '../engine/scene';
import { CONTROLLERS, CONTROLLER_INFO } from '../sim/trial';
import { getNetwork } from '../sim/network';
import { selftest } from '../sim/selftest';
import { evaluationResults } from '../data/results';
import { Readout } from '../ui/kit';
import { useTicker, fmt } from '../ui/hooks';
import { CTRL_VAR, onThemeChange } from '../ui/theme';

export type Go = (view: 'flight' | 'montecarlo' | 'model' | 'gate' | 'physics' | 'results' | 'docs') => void;

const REPO = 'https://github.com/ravideo9021/DAGE-Bench';

let hero: FlightEngine | null = null;
function heroEngine(): FlightEngine {
  if (!hero) {
    hero = new FlightEngine();
    hero.autoCycle = true;
    hero.set({ controller: 'Res-G', vp: 5.0, seed: 141, timeScale: 1 });
  }
  return hero;
}

export default function Overview({ go }: { go: Go }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const eng = heroEngine();
  useTicker(8);

  useEffect(() => {
    let scene: FlightScene;
    try { scene = new FlightScene(stageRef.current!); } catch { return; }
    scene.setCameraMode('chase');
    scene.setTrials(eng.trials);
    let ver = eng.version;
    let last = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      eng.tick(dt);
      if (eng.version !== ver) { ver = eng.version; scene.setTrials(eng.trials); }
      scene.update(eng.trials, dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const off = onThemeChange(() => scene.setTheme());
    return () => { cancelAnimationFrame(raf); off(); scene.dispose(); };
  }, [eng]);

  const tr = eng.primary;
  const s = tr.state;
  const at6 = (c: string) => evaluationResults.find((r) => r.vp === 6 && r.controller === c)!;
  const pid3 = evaluationResults.find((r) => r.vp === 3 && r.controller === 'PID')!;
  const resg3 = evaluationResults.find((r) => r.vp === 3 && r.controller === 'Res-G')!;
  const [us] = useState(() => selftest.usPerInf);

  return (
    <div className="ov">
      {/* ---------- Hero ---------- */}
      <header className="ov-hero">
        <div className="ov-kicker">DAGE-Bench</div>
        <h1>Land on a moving deck. Safely.</h1>
        <p className="lead">
          A learned correction cancels the asymmetric ground effect of a moving platform, and a safety gate hands control back to PID the moment the network is out of its depth.
        </p>
        <div className="ov-cta">
          <button type="button" className="btn primary lg" onClick={() => go('flight')}>Fly it now</button>
          <button type="button" className="btn lg" onClick={() => go('docs')}>Read the docs <ChevronRight size={16} /></button>
        </div>
        <div className="ov-stage">
          <div className="stage" ref={stageRef} />
          <div className="ov-stage-cap">
            <div className="glass ov-live">
              <span className="dot signal pulse" style={{ background: 'var(--ok)' }} />
              Live in your browser
              <span>Gated residual · {tr.plant.vp.toFixed(1)} m/s deck · seed {eng.cfg.seed}</span>
            </div>
            <div className="glass hud-big">
              <Readout label="Altitude" value={fmt.f(Math.max(0, s[0]), 2)} unit="m" />
              <Readout label="Roll" value={fmt.deg(s[4], 2)} unit="°" />
              <Readout label="Gate weight" value={tr.sigma.toFixed(3)} />
            </div>
          </div>
        </div>
      </header>

      {/* ---------- Problem ---------- */}
      <section className="ov-sec">
        <div className="ov-sec-h">
          <div className="ov-eyebrow">The problem</div>
          <h2>The last half-metre is the hardest.</h2>
          <p>When a multirotor descends onto a deck moving beneath it, its own downwash hits the surface and spills unevenly. That uneven cushion rolls the vehicle at exactly the moment a landing can least afford it.</p>
        </div>
        <div className="ov-split">
          <div className="ov-figure"><ProblemDiagram /></div>
          <div className="ov-points">
            <div className="ov-point"><h4>A cushion that isn't symmetric</h4><p>Over a static pad, ground effect only pushes up. Over a moving deck, the slip between vehicle and surface adds a roll torque.</p></div>
            <div className="ov-point"><h4>Strongest at the worst moment</h4><p>The torque grows as 1 / (1 + (z/L)²). It is negligible at altitude and dominant in the final 35 cm.</p></div>
            <div className="ov-point"><h4>Faster deck, bigger push</h4><p>The disturbance scales with platform speed. The network was trained up to 4 m/s and tested at 5 and 6 m/s.</p></div>
          </div>
        </div>
      </section>

      {/* ---------- Approach ---------- */}
      <section className="ov-sec">
        <div className="ov-sec-h">
          <div className="ov-eyebrow">The approach</div>
          <h2>Keep the PID. Add what it can't see.</h2>
          <p>A certified cascaded PID stays in charge. A compact network predicts the disturbance from 40 ms of history and subtracts it. A gate scales that correction toward zero whenever the inputs drift away from anything seen in training.</p>
        </div>
        <div className="ov-figure"><ArchitectureDiagram /></div>
      </section>

      {/* ---------- Controllers ---------- */}
      <section className="ov-sec">
        <div className="ov-sec-h">
          <div className="ov-eyebrow">Five controllers, one benchmark</div>
          <h2>From the textbook to the gated residual.</h2>
          <p>Each one lands 500 randomised times at every platform speed. The bars show how many of those landings at 6 m/s, beyond the training range, stayed inside the touchdown envelope.</p>
        </div>
        <div className="ov-ctrls">
          {CONTROLLERS.map((c) => {
            const r = at6(c);
            return (
              <div key={c} className={`ov-ctrl ${c === 'Res-G' ? 'hero' : ''}`}>
                <div className="nm"><span style={{ width: 10, height: 10, borderRadius: 5, background: CTRL_VAR[c] }} />{c}</div>
                <div className="ds">{CONTROLLER_INFO[c].desc}</div>
                <div className="rate"><span>Safe at 6 m/s</span><b>{r.envelope_pct.toFixed(1)}%</b></div>
                <div className="bar"><i style={{ width: `${r.envelope_pct}%`, background: CTRL_VAR[c] }} /></div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ---------- Results ---------- */}
      <section className="ov-sec">
        <div className="ov-sec-h">
          <div className="ov-eyebrow">Results</div>
          <h2>Robust where it matters. Small enough to fly.</h2>
          <p>12,500 Monte Carlo landings in the main study, plus a model-mismatch study and a gate ablation. All of it can be re-run from this site.</p>
        </div>
        <div className="ov-stats">
          <div className="ov-stat"><div className="v" style={{ color: 'var(--ok)' }}>{at6('Res-G').envelope_pct.toFixed(0)}<small>%</small></div><div className="l">Safe landings at 6 m/s</div><div className="d">1.5× beyond the training range. PID manages {at6('PID').envelope_pct.toFixed(1)}%, PD {at6('PD').envelope_pct.toFixed(1)}%.</div></div>
          <div className="ov-stat"><div className="v">−{((1 - resg3.rms_phi / pid3.rms_phi) * 100).toFixed(0)}<small>%</small></div><div className="l">Roll error vs PID</div><div className="d">RMS roll on final approach at 3 m/s, inside the training range.</div></div>
          <div className="ov-stat"><div className="v">{getNetwork().nParams.toLocaleString()}</div><div className="l">Parameters</div><div className="d">{getNetwork().nMacs.toLocaleString()} multiply-adds per step{us ? `, about ${us.toFixed(0)} µs here` : ''}. Pure NumPy, no framework.</div></div>
          <div className="ov-stat"><div className="v">47</div><div className="l">Tests, fixed seeds</div><div className="d">Physics, network, controllers, statistics and end-to-end checks. Every figure is reproducible.</div></div>
        </div>
        <div style={{ marginTop: 20, textAlign: 'center' }}>
          <button type="button" className="btn ghost" onClick={() => go('results')}>See every table and figure <ArrowRight size={15} /></button>
        </div>
      </section>

      {/* ---------- Explore ---------- */}
      <section className="ov-sec">
        <div className="ov-sec-h center">
          <div className="ov-eyebrow">Explore</div>
          <h2>Everything runs here. Nothing is pre-recorded.</h2>
          <p>The simulator, all five controllers and the trained network are ported to the browser and verified against the Python reference each time the page loads.</p>
        </div>
        <div className="ov-tiles">
          {[
            { id: 'flight', icon: Plane, t: 'Flight', d: 'Watch a landing in 3D with live instruments, or race all five controllers on the same seed.' },
            { id: 'montecarlo', icon: LayoutGrid, t: 'Monte Carlo', d: 'Run thousands of randomised landings across parallel threads and compare with the paper.' },
            { id: 'model', icon: BrainCircuit, t: 'Network', d: 'See the residual network think: live activations, trained weights and prediction quality.' },
            { id: 'gate', icon: ShieldCheck, t: 'Safety gate', d: 'Tune the gate against real distance distributions and re-fly the ablation study.' },
            { id: 'physics', icon: Waves, t: 'Disturbance', d: 'Explore the torque field across altitude and deck speed, nominal or mismatched.' },
            { id: 'docs', icon: BookOpen, t: 'Documentation', d: 'Install the benchmark, run the pipeline, and use every module from Python.' },
          ].map((x) => {
            const I = x.icon;
            return (
              <button key={x.id} type="button" className="ov-tile" onClick={() => go(x.id as Parameters<Go>[0])}>
                <I size={26} strokeWidth={1.7} />
                <h4>{x.t}</h4>
                <p>{x.d}</p>
                <span className="go">Open <ChevronRight size={15} /></span>
              </button>
            );
          })}
        </div>
      </section>

      <footer className="ov-foot">
        <span>DAGE-Bench 1.0 · Residual compensation of dynamic asymmetric ground effect for UAV landing on moving platforms.</span>
        <span><a href={REPO} target="_blank" rel="noopener noreferrer">Source on GitHub</a> · MIT licence</span>
      </footer>
    </div>
  );
}

function ProblemDiagram() {
  return (
    <svg viewBox="0 0 640 380" width="100%" role="img" aria-label="Downwash spilling unevenly over a moving deck, producing a roll torque">
      <defs>
        <marker id="pd-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--text-3)" /></marker>
        <marker id="pd-arrow-o" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--disturb)" /></marker>
        <marker id="pd-arrow-a" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--accent)" /></marker>
        <linearGradient id="pd-deck" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--text-2)" stopOpacity="0.9" /><stop offset="1" stopColor="var(--text-2)" stopOpacity="0.6" /></linearGradient>
      </defs>
      {/* sea */}
      <rect x="0" y="318" width="640" height="62" fill="var(--fill)" />
      {/* deck */}
      <rect x="110" y="282" width="420" height="22" rx="4" fill="url(#pd-deck)" />
      <path d="M126 304 L514 304 L488 330 L150 330 Z" fill="var(--fill-strong)" />
      <line x1="230" y1="350" x2="410" y2="350" stroke="var(--accent)" strokeWidth="2.5" markerEnd="url(#pd-arrow-a)" />
      <text x="320" y="372" textAnchor="middle" fontSize="13" fill="var(--accent-text)" fontWeight="600">deck moves at v_p</text>
      {/* altitude bracket */}
      <line x1="560" y1="130" x2="560" y2="280" stroke="var(--text-4)" strokeWidth="1.5" />
      <line x1="552" y1="130" x2="568" y2="130" stroke="var(--text-4)" strokeWidth="1.5" />
      <line x1="552" y1="280" x2="568" y2="280" stroke="var(--text-4)" strokeWidth="1.5" />
      <text x="576" y="200" fontSize="13" fill="var(--text-2)" fontWeight="600">z</text>
      <text x="576" y="218" fontSize="11.5" fill="var(--text-3)">altitude</text>
      {/* downwash */}
      {[-36, -12, 12, 36].map((dx) => (
        <line key={dx} x1={320 + dx} y1="158" x2={320 + dx * 1.15} y2="268" stroke="var(--text-3)" strokeWidth="1.6" strokeDasharray="5 5" markerEnd="url(#pd-arrow)" />
      ))}
      {/* asymmetric outwash: long downstream (left), short upstream (right) */}
      <path d="M300 278 C 260 276, 200 272, 150 266" fill="none" stroke="var(--disturb)" strokeWidth="3" markerEnd="url(#pd-arrow-o)" />
      <path d="M340 278 C 360 276, 380 274, 398 271" fill="none" stroke="var(--disturb)" strokeWidth="3" markerEnd="url(#pd-arrow-o)" opacity="0.65" />
      <text x="150" y="252" fontSize="12" fill="var(--disturb)" fontWeight="600">strong spill</text>
      <text x="368" y="258" fontSize="12" fill="var(--disturb)" fontWeight="600" opacity="0.8">weak</text>
      {/* drone (tilted) */}
      <g transform="rotate(-9 320 140)">
        <rect x="258" y="136" width="124" height="6" rx="3" fill="var(--text-2)" />
        <rect x="296" y="124" width="48" height="24" rx="12" fill="var(--card)" stroke="var(--text-2)" strokeWidth="2" />
        <rect x="296" y="133" width="48" height="5" fill="var(--accent)" />
        <ellipse cx="258" cy="128" rx="30" ry="4" fill="var(--text-4)" />
        <ellipse cx="382" cy="128" rx="30" ry="4" fill="var(--text-4)" />
        <rect x="254" y="128" width="8" height="10" rx="2" fill="var(--text-2)" />
        <rect x="378" y="128" width="8" height="10" rx="2" fill="var(--text-2)" />
      </g>
      {/* torque arc */}
      <path d="M 252 82 A 80 80 0 0 0 214 150" fill="none" stroke="var(--disturb)" strokeWidth="3.5" strokeLinecap="round" markerEnd="url(#pd-arrow-o)" />
      <text x="150" y="88" fontSize="14" fill="var(--disturb)" fontWeight="700">τ_DAGE</text>
      <text x="150" y="106" fontSize="12" fill="var(--text-3)">roll torque</text>
    </svg>
  );
}

function ArchitectureDiagram() {
  const box = (x: number, y: number, w: number, title: string, sub: string, accent = false) => (
    <g>
      <rect x={x} y={y} width={w} height={64} rx={14} fill={accent ? 'color-mix(in srgb, var(--accent) 10%, var(--card))' : 'var(--card-2)'} stroke={accent ? 'var(--accent)' : 'var(--sep)'} strokeWidth={accent ? 1.5 : 1} />
      <text x={x + w / 2} y={y + 28} textAnchor="middle" fontSize="14.5" fontWeight="600" fill="var(--text)">{title}</text>
      <text x={x + w / 2} y={y + 47} textAnchor="middle" fontSize="12" fill="var(--text-3)">{sub}</text>
    </g>
  );
  const arrow = (d: string, accent = false, label?: { x: number; y: number; t: string }) => (
    <g>
      <path d={d} fill="none" stroke={accent ? 'var(--accent)' : 'var(--text-3)'} strokeWidth={2} markerEnd={accent ? 'url(#ad-a)' : 'url(#ad-g)'} />
      {label && <text x={label.x} y={label.y} fontSize="12" fill={accent ? 'var(--accent-text)' : 'var(--text-3)'} fontWeight="600" textAnchor="middle">{label.t}</text>}
    </g>
  );
  return (
    <svg viewBox="0 0 1040 330" width="100%" role="img" aria-label="Control architecture: PID plus gated residual network">
      <defs>
        <marker id="ad-g" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--text-3)" /></marker>
        <marker id="ad-a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--accent)" /></marker>
      </defs>
      <text x="20" y="22" fontSize="12" fontWeight="600" fill="var(--text-3)">Nominal path</text>
      <text x="124" y="196" fontSize="12" fontWeight="600" fill="var(--accent-text)">Learned residual path</text>
      {box(20, 40, 170, 'Sensors', 'noisy state, 100 Hz')}
      {box(250, 40, 190, 'Cascaded PID', 'altitude · lateral · roll')}
      <circle cx="540" cy="72" r="22" fill="var(--card-2)" stroke="var(--text-3)" strokeWidth="1.5" />
      <text x="540" y="78" textAnchor="middle" fontSize="18" fontWeight="600" fill="var(--text)">Σ</text>
      {box(640, 40, 190, 'Vehicle + DAGE', 'RK4 plant, Eq. 5–7')}
      {arrow('M190 72 L246 72')}
      {arrow('M440 72 L514 72', false, { x: 478, y: 62, t: 'u_nom' })}
      {arrow('M562 72 L636 72', false, { x: 598, y: 62, t: 'u' })}
      {arrow('M735 104 L735 140 L105 140 L105 108')}
      <text x="420" y="134" fontSize="12" fill="var(--text-3)" textAnchor="middle">measured state</text>

      {box(20, 214, 170, 'History window', '4 steps × 6 features', true)}
      {box(250, 214, 210, 'Residual network', '24 · 64 · 64 · 32 · 2 tanh', true)}
      {box(520, 214, 170, 'Safety gate', 'σ = exp(−(d − d₀)⁺ / κ)', true)}
      {arrow('M105 140 L105 210', true)}
      {arrow('M190 246 L246 246', true, { x: 218, y: 236, t: 'x' })}
      {arrow('M460 246 L516 246', true, { x: 488, y: 236, t: 'r̂' })}
      {arrow('M605 214 L605 160 L540 160 L540 98', true, { x: 640, y: 182, t: '− σ · r̂' })}
      <path d="M105 296 L605 296 L605 282" fill="none" stroke="var(--accent)" strokeWidth={1.5} strokeDasharray="4 4" markerEnd="url(#ad-a)" />
      <text x="355" y="316" fontSize="12" fill="var(--accent-text)" textAnchor="middle">distance d(x) from the training distribution</text>

      <g>
        <rect x="870" y="196" width="150" height="110" rx="14" fill="var(--card-2)" stroke="var(--sep)" />
        <text x="886" y="224" fontSize="12.5" fontWeight="600" fill="var(--text)">When d ≤ d₀</text>
        <text x="886" y="242" fontSize="12" fill="var(--text-3)">full correction</text>
        <text x="886" y="272" fontSize="12.5" fontWeight="600" fill="var(--text)">When d ≫ d₀</text>
        <text x="886" y="290" fontSize="12" fill="var(--text-3)">pure PID fallback</text>
      </g>
    </svg>
  );
}
