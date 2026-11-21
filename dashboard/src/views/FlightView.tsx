import { useEffect, useRef, useState, useCallback, useSyncExternalStore } from 'react';
import { Play, Pause, RotateCcw, SkipForward, Shuffle, Minus, Plus, ChevronDown, Wind, Gauge, TriangleAlert, Layers, Users, Anchor, CheckCircle2, XCircle } from 'lucide-react';
import { engine, failReasons, type LogLevel } from '../engine/flight';
import { FlightScene, type CameraMode } from '../engine/scene';
import { CONTROLLERS, CONTROLLER_INFO, type ControllerId } from '../sim/trial';
import { ENVELOPE, MAX_TRAIN_SPEED, SIM } from '../sim/physics';
import { Panel, Field, Seg, Slider, Toggle, Readout } from '../ui/kit';
import { useTicker, fmt } from '../ui/hooks';
import { theme, CTRL_VAR, onThemeChange, alpha } from '../ui/theme';
import StripChart, { type StripSeries } from '../ui/StripChart';
import { RollGauge, AltitudeBar, GateRings, GateDetails, EnvelopeCheck } from './flight/Instruments';

const PRESETS: { name: string; sub: string; icon: typeof Wind; cfg: Partial<typeof engine.cfg> }[] = [
  { name: 'Calm deck', sub: 'Gated residual at 1.5 m/s', icon: Anchor, cfg: { controller: 'Res-G', vp: 1.5, mismatch: false, compare: false } },
  { name: 'Beyond training', sub: 'Gated residual at 6.0 m/s', icon: Gauge, cfg: { controller: 'Res-G', vp: 6.0, mismatch: false, compare: false } },
  { name: 'PD failure', sub: 'No integral action at 6.0 m/s', icon: TriangleAlert, cfg: { controller: 'PD', vp: 6.0, mismatch: false, compare: false, seed: 103 } },
  { name: 'Model mismatch', sub: 'All five, perturbed plant, 5.0 m/s', icon: Layers, cfg: { controller: 'Res-G', vp: 5.0, mismatch: true, compare: true } },
  { name: 'Side by side', sub: 'All five controllers at 6.0 m/s', icon: Users, cfg: { controller: 'Res-G', vp: 6.0, mismatch: false, compare: true } },
  { name: 'Stationary pad', sub: 'PID baseline at 0 m/s', icon: Wind, cfg: { controller: 'PID', vp: 0, mismatch: false, compare: false } },
];

const SHORT: Record<ControllerId, string> = { PD: 'PD', PID: 'PID', 'PID+DOB': 'PID+DOB', 'Res-NG': 'Res-NG', 'Res-G': 'Res-G' };

function useEngineVersion() {
  return useSyncExternalStore(
    (cb) => engine.subscribe(cb),
    () => `${engine.version}:${engine.playing}:${engine.primary.done}:${JSON.stringify(engine.cfg)}:${engine.autoCycle}`,
  );
}

const LEVEL_DOT: Record<LogLevel, string> = { sys: 'sys', info: 'info', ok: '', warn: 'warn', crit: 'crit' };

export default function FlightView() {
  useEngineVersion();
  const cfg = engine.cfg;
  const stageRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<FlightScene | null>(null);
  const [cam, setCam] = useState<CameraMode>('chase');
  const [ch3, setCh3] = useState<'sigma' | 'alt' | 'slip'>('sigma');
  const [tab, setTab] = useState<'inst' | 'setup' | 'events'>('inst');
  const [menu, setMenu] = useState(false);
  useTicker(15, engine.playing);

  useEffect(() => {
    const el = stageRef.current!;
    let scene: FlightScene;
    try { scene = new FlightScene(el); } catch (e) { console.error(e); return; }
    sceneRef.current = scene;
    scene.setTrials(engine.trials);
    let ver = engine.version;
    let last = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      engine.tick(dt);
      if (engine.version !== ver) { ver = engine.version; scene.setTrials(engine.trials); }
      scene.update(engine.trials, dt);
      engine.emitFrame();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const offTheme = onThemeChange(() => scene.setTheme());
    return () => { cancelAnimationFrame(raf); offTheme(); scene.dispose(); sceneRef.current = null; };
  }, []);

  useEffect(() => { sceneRef.current?.setCameraMode(cam); }, [cam]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'range') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === ' ') { e.preventDefault(); engine.togglePlay(); }
      else if (k === 'r') engine.reset();
      else if (k === 'n') engine.nextSeed();
      else if (k === 'c') engine.set({ compare: !engine.cfg.compare });
      else if (k === 'm') engine.set({ mismatch: !engine.cfg.mismatch });
      else if (['1', '2', '3', '4', '5'].includes(k)) engine.set({ controller: CONTROLLERS[Number(k) - 1] });
      else if (k === 'v') setCam((c) => (['chase', 'side', 'top', 'deck'] as CameraMode[])[(['chase', 'side', 'top', 'deck'].indexOf(c) + 1) % 4]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.menu-wrap')) setMenu(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  const tr = engine.primary;
  const s = tr.state;
  const P = tr.plant;
  const res = tr.result;
  const sub = useCallback((cb: () => void) => engine.onFrame(cb), []);
  const isRes = cfg.controller.startsWith('Res');
  const allDone = engine.trials.every((t) => t.done);
  const phase = tr.done ? 'Landed' : !engine.playing ? 'Paused' : s[0] < P.R_z ? 'Ground effect' : s[0] < 1 ? 'Final approach' : tr.t < 0.6 ? 'Released' : 'Descending';
  const latest = engine.log[engine.log.length - 1];
  const showBanner = latest && !allDone && latest.t > 0 && tr.t - latest.t < 2.2;

  const rollSeries = (): StripSeries[] => engine.trials.map((t, i) => ({
    trial: t, ch: 'phi', color: theme().ctrl[t.cfg.controller], width: i === 0 ? 2 : 1.4, alpha: i === 0 ? 1 : 0.8, fill: i === 0 && engine.trials.length === 1,
  }));
  const distSeries = (): StripSeries[] => {
    const t = engine.primary;
    const th = theme();
    const out: StripSeries[] = [{ trial: t, ch: 'tauTrue', color: th.disturb, width: 2, fill: true }];
    if (t.cfg.controller.startsWith('Res')) out.push({ trial: t, ch: 'tauHat', color: th.text, width: 1.2, alpha: 0.55 });
    if (t.cfg.controller === 'PID+DOB') out.push({ trial: t, ch: 'dob', color: th.ctrl['PID+DOB'], width: 1.4, dash: [4, 4] });
    return out;
  };
  const ch3Series = (): StripSeries[] => {
    const th = theme();
    if (ch3 === 'sigma') {
      const t = engine.trials.find((x) => x.cfg.controller === 'Res-G') ?? engine.primary;
      return [{ trial: t, ch: 'sigma', color: th.ok, width: 2, fill: true }];
    }
    const ch = ch3 === 'alt' ? 'z' : 'vy';
    return engine.trials.map((t, i) => ({ trial: t, ch, color: th.ctrl[t.cfg.controller], width: i === 0 ? 2 : 1.4, alpha: i === 0 ? 1 : 0.8, fill: i === 0 && engine.trials.length === 1 && ch === 'z' }));
  };

  const ctrlLegend = (
    <div className="legend">
      {engine.trials.map((t) => <span key={t.cfg.controller}><i style={{ background: CTRL_VAR[t.cfg.controller] }} />{SHORT[t.cfg.controller]}</span>)}
    </div>
  );
  const crit = alpha(theme().crit, 0.7);

  return (
    <div className="flight">
      <header className="flight-head">
        <div>
          <h1>Flight</h1>
          <div className="sub">
            {CONTROLLER_INFO[cfg.controller].name} · platform {cfg.vp.toFixed(1)} m/s · seed {cfg.seed}
            {cfg.mismatch ? ' · model mismatch' : ''}{cfg.compare ? ' · comparing all five' : ''}
          </div>
        </div>
        <div className="spacer" />
        <Seg
          label="Controller"
          value={cfg.controller}
          onChange={(v) => engine.set({ controller: v })}
          className="ctl-seg"
          options={CONTROLLERS.map((c) => ({ value: c, label: <><span className="dotc" style={{ background: CTRL_VAR[c] }} />{SHORT[c]}</> }))}
        />
        <div className="menu-wrap">
          <button type="button" className="btn" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            Scenarios <ChevronDown size={14} />
          </button>
          {menu && (
            <div className="menu" role="menu">
              {PRESETS.map((p) => {
                const I = p.icon;
                return (
                  <button key={p.name} type="button" role="menuitem" onClick={() => { engine.set(p.cfg); engine.playing = true; setMenu(false); }}>
                    <I size={17} strokeWidth={1.8} />
                    <b>{p.name}</b>
                    <span>{p.sub}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="btn-row">
          <button type="button" className="btn icon" onClick={() => engine.reset()} aria-label="Restart landing" title="Restart (R)"><RotateCcw size={15} /></button>
          <button type="button" className="btn icon primary" onClick={() => engine.togglePlay()} aria-label={engine.playing && !allDone ? 'Pause' : 'Play'} title="Play / pause (Space)">
            {engine.playing && !allDone ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" style={{ marginLeft: 2 }} />}
          </button>
          <button type="button" className="btn icon" onClick={() => engine.nextSeed()} aria-label="Next seed" title="Next seed (N)"><SkipForward size={15} /></button>
        </div>
      </header>

      <section className="flight-stage" aria-label="3D flight view">
        <div className="stage" ref={stageRef} />
        <div className="stage-hud">
          <div className="hud-tl">
            <div className="glass phase">
              <span className={`dot ${tr.done ? (res?.success ? '' : 'crit') : engine.playing ? 'signal pulse' : 'warn'}`} />
              {phase}
              <span className="t">{tr.t.toFixed(1)} s</span>
            </div>
          </div>
          {showBanner && (
            <div className="hud-tc">
              <div key={latest.id} className="glass banner">
                <span className={`dot ${LEVEL_DOT[latest.level]}`} />
                <b>{latest.key}</b>
                <span>{latest.msg}</span>
              </div>
            </div>
          )}
          <div className="hud-tr">
            <div className="glass" style={{ padding: 3, borderRadius: 11 }}>
              <Seg options={[{ value: 'chase', label: 'Chase' }, { value: 'side', label: 'Side' }, { value: 'top', label: 'Top' }, { value: 'deck', label: 'Deck' }] as const} value={cam} onChange={setCam} label="Camera" />
            </div>
          </div>
          <div className="hud-bl">
            <div className="glass hud-big">
              <Readout label="Altitude" value={fmt.f(Math.max(0, s[0]), 2)} unit="m" />
              <Readout label="Sink rate" value={fmt.f(Math.abs(s[1]), 2)} unit="m/s" />
              <Readout label="Roll" value={fmt.deg(s[4], 2)} unit="°" color={Math.abs(s[4]) > ENVELOPE.phi_max && s[0] < ENVELOPE.final_approach_z ? 'var(--crit)' : undefined} />
              <Readout label="Offset" value={fmt.s(s[2], 2)} unit="m" />
              <Readout label="Slip" value={fmt.s(s[3], 2)} unit="m/s" />
            </div>
          </div>
          {res && allDone && <Verdict />}
        </div>
      </section>

      <div className="flight-charts">
        <Panel title="Roll angle" right={ctrlLegend}>
          <StripChart series={rollSeries} subscribe={sub} range={{ auto: true, min: 0.04 }} fmtY={(v) => v.toFixed(2)}
            hlines={[{ y: ENVELOPE.phi_max, color: crit, label: 'Limit' }, { y: -ENVELOPE.phi_max, color: crit }]} />
        </Panel>
        <Panel title="Roll disturbance" right={
          <div className="legend">
            <span><i style={{ background: 'var(--disturb)' }} />Actual</span>
            {isRes && <span><i style={{ background: 'var(--text-3)' }} />Network</span>}
            {cfg.controller === 'PID+DOB' && <span style={{ color: 'var(--c-dob)' }}><i className="dash" />Observer</span>}
          </div>
        }>
          <StripChart series={distSeries} subscribe={sub} range={{ auto: true, min: 0.02 }} />
        </Panel>
        <Panel className="chart-optional" title={ch3 === 'sigma' ? 'Gate weight' : ch3 === 'alt' ? 'Altitude' : 'Sideways slip'}
          right={<Seg options={[{ value: 'sigma', label: 'σ' }, { value: 'alt', label: 'z' }, { value: 'slip', label: 'Δv' }] as const} value={ch3} onChange={setCh3} label="Chart channel" style={{ width: 120 }} />}>
          {ch3 === 'sigma' && <StripChart key="s" series={ch3Series} subscribe={sub} range={[0, 1.08]} fmtY={(v) => v.toFixed(1)} />}
          {ch3 === 'alt' && <StripChart key="a" series={ch3Series} subscribe={sub} range={[0, 4.4]} bands={[{ y0: 0, y1: SIM.R_z, color: alpha(theme().warn, 0.1) }]} />}
          {ch3 === 'slip' && <StripChart key="v" series={ch3Series} subscribe={sub} range={{ auto: true, min: 1 }}
            hlines={[{ y: ENVELOPE.dvy_max, color: crit, label: 'Limit' }, { y: -ENVELOPE.dvy_max, color: crit }]} />}
        </Panel>
      </div>

      <aside className="panel inspector" aria-label="Inspector">
        <div className="inspector-tabs">
          <Seg options={[{ value: 'inst', label: 'Instruments' }, { value: 'setup', label: 'Setup' }, { value: 'events', label: 'Events' }] as const} value={tab} onChange={setTab} label="Inspector" />
        </div>
        <div className="inspector-body">
          {tab === 'inst' && <InstrumentsTab />}
          {tab === 'setup' && <SetupTab />}
          {tab === 'events' && <EventsTab />}
        </div>
      </aside>
    </div>
  );
}

function InstrumentsTab() {
  const tr = engine.primary;
  const P = tr.plant;
  const res = tr.result;
  const isRes = tr.cfg.controller.startsWith('Res');
  const nRes = engine.trials.filter((t) => t.cfg.controller.startsWith('Res')).length;
  return (
    <>
      <section className="insp-sec">
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}><RollGauge tr={tr} /></div>
          <AltitudeBar tr={tr} />
        </div>
      </section>
      <section className="insp-sec">
        <div className="insp-h"><h4>Safety gate</h4>{isRes ? <span className={`badge ${tr.cfg.controller === 'Res-NG' ? 'warn' : tr.sigma > 0.98 ? 'ok' : 'warn'}`}>{tr.cfg.controller === 'Res-NG' ? 'Ungated' : tr.sigma > 0.98 ? 'In distribution' : 'Attenuating'}</span> : <span className="badge">Not used</span>}</div>
        <GateRings tr={tr} />
        <div style={{ marginTop: 12 }}><GateDetails tr={tr} /></div>
      </section>
      <section className="insp-sec">
        <div className="insp-h"><h4>Touchdown envelope</h4>{res ? <span className={`badge ${res.success ? 'ok' : 'crit'}`}>{res.success ? 'Passed' : 'Failed'}</span> : <span className="badge">Monitoring</span>}</div>
        <EnvelopeCheck tr={tr} />
      </section>
      <section className="insp-sec">
        <div className="insp-h"><h4>This landing</h4></div>
        <dl className="kv">
          <dt>Platform speed</dt><dd>{P.vp.toFixed(2)}<small>m/s</small></dd>
          <dt>Disturbance gain K_φ</dt><dd>{P.K_phi.toFixed(4)}</dd>
          <dt>Ground-effect lift A_GE</dt><dd>{P.A_GE.toFixed(3)}<small>m/s²</small></dd>
          <dt>Roll inertia J_x</dt><dd>{P.Jx.toFixed(4)}<small>kg·m²</small></dd>
          <dt>Network inferences</dt><dd>{(isRes ? Math.max(0, tr.step - 3) * nRes : 0).toLocaleString()}</dd>
        </dl>
      </section>
    </>
  );
}

function SetupTab() {
  const cfg = engine.cfg;
  return (
    <>
      <section className="insp-sec">
        <Field
          label="Platform speed"
          value={<span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>{cfg.vp > MAX_TRAIN_SPEED && <span className="badge warn">Beyond training</span>}{cfg.vp.toFixed(1)} m/s</span>}
          hint={`The network was trained on 0–${MAX_TRAIN_SPEED.toFixed(0)} m/s. Faster decks test how it extrapolates.`}
        >
          <Slider min={0} max={7} step={0.1} value={cfg.vp} label="Platform speed" onChange={(v) => engine.set({ vp: v })}
            scale={[0, 1, 2, 3, 4, 5, 6, 7].map((v) => ({ at: v, label: String(v) }))} />
        </Field>
      </section>
      <section className="insp-sec">
        <Field label="Seed" hint="Sets the sampled plant, starting state and sensor noise. Same seed, same landing.">
          <div className="stepper">
            <button type="button" className="btn icon" onClick={() => engine.set({ seed: Math.max(0, cfg.seed - 1) })} aria-label="Previous seed"><Minus size={15} /></button>
            <span className="val">{cfg.seed}</span>
            <button type="button" className="btn icon" onClick={() => engine.set({ seed: cfg.seed + 1 })} aria-label="Next seed"><Plus size={15} /></button>
            <button type="button" className="btn" onClick={() => engine.set({ seed: 100 + Math.floor(Math.random() * 9000) })}><Shuffle size={14} /> Random</button>
          </div>
        </Field>
      </section>
      <section className="insp-sec">
        <Toggle checked={cfg.compare} onChange={(v) => engine.set({ compare: v })} label="Compare all controllers" desc="Five vehicles, same seed, side by side" />
        <Toggle checked={cfg.mismatch} onChange={(v) => engine.set({ mismatch: v })} label="Model mismatch" desc="Plant differs from what the network learned" />
        <Toggle checked={engine.autoCycle} onChange={(v) => { engine.autoCycle = v; engine.set({}, false); }} label="Keep flying" desc="Start the next seed after each touchdown" />
      </section>
      {(cfg.controller === 'Res-G' || cfg.compare) && (
        <section className="insp-sec">
          <Field label="Gate decay κ" value={cfg.kappa.toFixed(1)}>
            <Slider min={0.2} max={3} step={0.1} value={cfg.kappa} label="Gate decay" onChange={(v) => engine.set({ kappa: v })} />
          </Field>
          <Field label="Gate threshold" value={`${cfg.d0Scale.toFixed(2)} × d₀`}>
            <Slider min={0.4} max={1.4} step={0.05} value={cfg.d0Scale} label="Gate threshold" onChange={(v) => engine.set({ d0Scale: v })} />
          </Field>
        </section>
      )}
      <section className="insp-sec">
        <Field label="Playback speed">
          <Seg options={[0.25, 0.5, 1, 2, 4].map((v) => ({ value: v, label: `${v}×` }))} value={cfg.timeScale} onChange={(v) => engine.set({ timeScale: v }, false)} label="Playback speed" />
        </Field>
      </section>
    </>
  );
}

function EventsTab() {
  const ref = useRef<HTMLDivElement>(null);
  const last = engine.log[engine.log.length - 1]?.id;
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' }); }, [last]);
  return (
    <div className="log" ref={ref} style={{ paddingTop: 6 }}>
      {engine.log.map((e) => (
        <div key={e.id} className="log-row">
          <span className={`dot ${LEVEL_DOT[e.level]}`} />
          <span><span className="lk">{e.key}</span><span className="lt">{e.t.toFixed(2)} s</span></span>
          <span className="lm">{e.msg}</span>
        </div>
      ))}
    </div>
  );
}

function Verdict() {
  const tr = engine.primary;
  const r = tr.result!;
  const others = engine.trials.slice(1);
  const ok = r.success;
  const Icon = ok ? CheckCircle2 : XCircle;
  return (
    <div className="verdict glass" role="status">
      <div className="verdict-h">
        <Icon size={40} strokeWidth={1.7} style={{ color: ok ? 'var(--ok)' : 'var(--crit)', flex: 'none' }} />
        <div>
          <h2>{ok ? 'Safe touchdown' : 'Unsafe touchdown'}</h2>
          <p>{CONTROLLER_INFO[tr.cfg.controller].name} · {r.touchdownT.toFixed(2)} s · {Math.abs(r.touchdownY).toFixed(2)} m from centre</p>
        </div>
      </div>
      <div className="verdict-sub">
        {ok ? 'Roll, sink rate and sideways slip were all inside the landing envelope.' : <>Outside the envelope on {failReasons(r).join(' and ')}.</>}
        {tr.cfg.controller === 'Res-G' && <> Average gate weight {r.meanSigma.toFixed(3)}.</>}
      </div>
      <div className="verdict-grid">
        <Readout label="Peak roll" value={r.peakPhi.toFixed(3)} unit="rad" color={r.peakPhi > ENVELOPE.phi_max ? 'var(--crit)' : undefined} />
        <Readout label="RMS roll" value={r.rmsPhi.toFixed(3)} unit="rad" />
        <Readout label="Sink" value={r.vz.toFixed(2)} unit="m/s" color={r.vz > ENVELOPE.vz_max ? 'var(--crit)' : undefined} />
        <Readout label="Slip" value={r.dvy.toFixed(2)} unit="m/s" color={r.dvy > ENVELOPE.dvy_max ? 'var(--crit)' : undefined} />
      </div>
      {others.length > 0 && (
        <div style={{ padding: '10px 10px 0' }}>
          <table className="tbl" style={{ fontSize: 12.5 }}>
            <thead><tr><th>Controller</th><th>Peak roll</th><th>Slip</th><th>Sink</th><th>Result</th></tr></thead>
            <tbody>
              {engine.trials.map((t) => (
                <tr key={t.cfg.controller}>
                  <td><span style={{ display: 'inline-block', width: 8, height: 8, background: CTRL_VAR[t.cfg.controller], marginRight: 8, borderRadius: 4 }} />{t.cfg.controller}</td>
                  <td>{t.result!.peakPhi.toFixed(3)}</td><td>{t.result!.dvy.toFixed(2)}</td><td>{t.result!.vz.toFixed(2)}</td>
                  <td style={{ color: t.result!.success ? 'var(--ok)' : 'var(--crit)', fontWeight: 600 }}>{t.result!.success ? 'Pass' : 'Fail'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="verdict-f">
        <button type="button" className="btn" onClick={() => engine.reset()}><RotateCcw size={14} /> Fly again</button>
        <button type="button" className="btn primary" onClick={() => engine.nextSeed()}>Next seed <SkipForward size={14} /></button>
      </div>
    </div>
  );
}
