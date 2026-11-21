import { useEffect, useRef, useState, useCallback, useSyncExternalStore } from 'react';
import { Play, Pause, RotateCcw, SkipForward, Dices } from 'lucide-react';
import { engine, COLORS, failReasons } from '../engine/flight';
import { FlightScene, type CameraMode } from '../engine/scene';
import { CONTROLLERS, CONTROLLER_INFO, type ControllerId } from '../sim/trial';
import { ENVELOPE, MAX_TRAIN_SPEED, SIM } from '../sim/physics';
import { Panel, Field, Seg, Slider, Toggle, Readout } from '../ui/kit';
import { useTicker, fmt } from '../ui/hooks';
import StripChart, { type StripSeries } from '../ui/StripChart';
import { Attitude, AltTape, GateMonitor, EnvelopeCheck } from './flight/Instruments';

const PRESETS: { name: string; sub: string; cfg: Partial<typeof engine.cfg> }[] = [
  { name: 'Calm deck', sub: 'Res-G · 1.5 m/s', cfg: { controller: 'Res-G', vp: 1.5, mismatch: false, compare: false } },
  { name: 'OOD sprint', sub: 'Res-G · 6.0 m/s', cfg: { controller: 'Res-G', vp: 6.0, mismatch: false, compare: false } },
  { name: 'PD failure', sub: 'PD · 6.0 m/s', cfg: { controller: 'PD', vp: 6.0, mismatch: false, compare: false, seed: 103 } },
  { name: 'Model mismatch', sub: 'All · 5.0 m/s · Δplant', cfg: { controller: 'Res-G', vp: 5.0, mismatch: true, compare: true } },
  { name: 'Fleet duel', sub: 'All 5 · 6.0 m/s', cfg: { controller: 'Res-G', vp: 6.0, mismatch: false, compare: true } },
  { name: 'Static pad', sub: 'PID · 0.0 m/s', cfg: { controller: 'PID', vp: 0, mismatch: false, compare: false } },
];

function useEngineVersion() {
  return useSyncExternalStore(
    (cb) => engine.subscribe(cb),
    () => `${engine.version}:${engine.playing}:${engine.primary.done}:${JSON.stringify(engine.cfg)}:${engine.autoCycle}`,
  );
}

export default function FlightView() {
  useEngineVersion();
  const cfg = engine.cfg;
  const stageRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<FlightScene | null>(null);
  const [cam, setCam] = useState<CameraMode>('chase');
  const [ch3, setCh3] = useState<'slip' | 'sigma' | 'alt'>('sigma');
  useTicker(15, engine.playing);

  // Scene + main loop
  useEffect(() => {
    const el = stageRef.current!;
    let scene: FlightScene;
    try {
      scene = new FlightScene(el);
    } catch (e) {
      console.error(e);
      return;
    }
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
    return () => { cancelAnimationFrame(raf); scene.dispose(); sceneRef.current = null; };
  }, []);

  useEffect(() => { sceneRef.current?.setCameraMode(cam); }, [cam]);

  // Keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' && (e.target as HTMLInputElement).type !== 'range') return;
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

  const tr = engine.primary;
  const s = tr.state;
  const P = tr.plant;
  const res = tr.result;
  const sub = useCallback((cb: () => void) => engine.onFrame(cb), []);
  const isRes = cfg.controller.startsWith('Res');
  const phase = tr.done ? 'LANDED' : !engine.playing ? 'HOLD' : s[0] < P.R_z ? 'GROUND EFFECT' : s[0] < 1 ? 'FINAL APPROACH' : tr.t < 0.6 ? 'RELEASE' : 'DESCENT';

  const rollSeries = (): StripSeries[] => engine.trials.map((t, i) => ({
    trial: t, ch: 'phi', color: COLORS[t.cfg.controller], width: i === 0 ? 1.8 : 1.1, alpha: i === 0 ? 1 : 0.75,
  }));
  const distSeries = (): StripSeries[] => {
    const t = engine.primary;
    const out: StripSeries[] = [{ trial: t, ch: 'tauTrue', color: '#ff6b1a', width: 1.8 }];
    if (t.cfg.controller.startsWith('Res')) out.push({ trial: t, ch: 'tauHat', color: '#e8ecef', width: 1.3, dash: [4, 3] });
    if (t.cfg.controller === 'PID+DOB') out.push({ trial: t, ch: 'dob', color: '#e8c547', width: 1.3, dash: [4, 3] });
    return out;
  };
  const ch3Series = (): StripSeries[] => {
    if (ch3 === 'sigma') {
      const t = engine.trials.find((x) => x.cfg.controller === 'Res-G') ?? engine.primary;
      return [{ trial: t, ch: 'sigma', color: '#3dd68c', width: 1.8 }];
    }
    if (ch3 === 'alt') return engine.trials.map((t, i) => ({ trial: t, ch: 'z', color: COLORS[t.cfg.controller], width: i === 0 ? 1.8 : 1.1, alpha: i === 0 ? 1 : 0.7 }));
    return engine.trials.map((t, i) => ({ trial: t, ch: 'vy', color: COLORS[t.cfg.controller], width: i === 0 ? 1.8 : 1.1, alpha: i === 0 ? 1 : 0.7 }));
  };

  const ms = engine.milestones;
  const tMax = SIM.horizon;

  return (
    <div className="flight">
      {/* ---------------- Left: mission configuration ---------------- */}
      <Panel tag="CFG-01" title="Mission configuration" className="flight-left">
        <Field label="Scenario presets">
          <div className="presets">
            {PRESETS.map((p) => (
              <button key={p.name} type="button" className="preset" onClick={() => { engine.set(p.cfg); engine.playing = true; }}>
                <b>{p.name}</b><span>{p.sub}</span>
              </button>
            ))}
          </div>
        </Field>

        <Field label="Controller" value={<span className="mono" style={{ fontSize: 10, color: 'var(--text-3)' }}>keys 1–5</span>}>
          <div className="ctl-list">
            {CONTROLLERS.map((c, i) => (
              <button key={c} type="button" className="ctl-opt" aria-pressed={cfg.controller === c} onClick={() => engine.set({ controller: c as ControllerId })}>
                <span className="sw" style={{ background: COLORS[c] }} />
                <span><span className="nm">{CONTROLLER_INFO[c].name}</span><span className="ds">{CONTROLLER_INFO[c].desc}</span></span>
                <span className="id">{i + 1}</span>
              </button>
            ))}
          </div>
        </Field>

        <Field
          label="Platform speed v_p"
          value={<>{cfg.vp.toFixed(1)} <span style={{ color: 'var(--text-3)', fontSize: 10 }}>m/s</span> {cfg.vp > MAX_TRAIN_SPEED && <span className="badge warn" style={{ marginLeft: 4 }}>OOD</span>}</>}
          hint={<>Training covered 0–{MAX_TRAIN_SPEED.toFixed(1)} m/s. Above that the network is extrapolating.</>}
        >
          <Slider min={0} max={7} step={0.1} value={cfg.vp} label="Platform speed" onChange={(v) => engine.set({ vp: v })}
            scale={[{ at: 0, label: '0' }, { at: 1.5, label: '1.5' }, { at: 3, label: '3' }, { at: 4, label: '4 ┃' }, { at: 5, label: '5' }, { at: 6, label: '6' }, { at: 7, label: '7' }]} />
        </Field>

        <Field label="Trial seed" value={`#${String(cfg.seed).padStart(4, '0')}`} hint="Seeds the plant randomisation, initial state and sensor noise.">
          <div className="btn-row">
            <button type="button" className="btn sm" onClick={() => engine.set({ seed: Math.max(0, cfg.seed - 1) })} aria-label="Previous seed">−</button>
            <button type="button" className="btn sm" style={{ flex: 1 }} onClick={() => engine.set({ seed: 100 + Math.floor(Math.random() * 9000) })}><Dices size={13} /> Random</button>
            <button type="button" className="btn sm" onClick={() => engine.set({ seed: cfg.seed + 1 })} aria-label="Next seed">+</button>
          </div>
        </Field>

        <div className="field" style={{ gap: 4 }}>
          <div className="field-l"><span>Experiment</span></div>
          <Toggle checked={cfg.compare} onChange={(v) => engine.set({ compare: v })} label="Compare all controllers" desc="Same seed, five vehicles, side-by-side lanes" />
          <Toggle checked={cfg.mismatch} onChange={(v) => engine.set({ mismatch: v })} label="Disturbance-model mismatch" desc="K_φ ×1.4 · A_GE ×1.35 · L ×1.3 · λ 1.0 · n 1.6" />
          <Toggle checked={engine.autoCycle} onChange={(v) => { engine.autoCycle = v; engine.set({}, false); }} label="Auto-cycle seeds" desc="Re-fly with the next seed after touchdown" />
        </div>

        {cfg.controller === 'Res-G' || cfg.compare ? (
          <>
            <Field label="Gate decay κ" value={cfg.kappa.toFixed(1)}>
              <Slider min={0.2} max={3} step={0.1} value={cfg.kappa} label="Gate kappa" onChange={(v) => engine.set({ kappa: v })} />
            </Field>
            <Field label="Gate threshold scale" value={`${cfg.d0Scale.toFixed(2)} × d₀`}>
              <Slider min={0.4} max={1.4} step={0.05} value={cfg.d0Scale} label="Gate d0 scale" onChange={(v) => engine.set({ d0Scale: v })} />
            </Field>
          </>
        ) : null}

        <Field label="Time scale" value={`${cfg.timeScale}×`}>
          <Seg options={[0.25, 0.5, 1, 2, 4].map((v) => ({ value: v, label: `${v}×` }))} value={cfg.timeScale} onChange={(v) => engine.set({ timeScale: v }, false)} label="Time scale" />
        </Field>
      </Panel>

      {/* ---------------- Stage ---------------- */}
      <section className="panel flight-stage">
        <div className="stage" ref={stageRef} />
        <div className="stage-hud">
          <div className="hud-tl">
            <div className="hud-card" style={{ minWidth: 230 }}>
              <div className="hud-phase">
                <span className={`dot ${tr.done ? (res?.success ? '' : 'crit') : engine.playing ? 'signal pulse' : 'warn'}`} />
                {phase}
                <span style={{ marginLeft: 'auto', color: 'var(--text-4)' }}>T+{tr.t.toFixed(2)}s</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 8, height: 8, background: COLORS[cfg.controller], borderRadius: 2 }} />
                <b style={{ fontSize: 13 }}>{CONTROLLER_INFO[cfg.controller].name}</b>
              </div>
              <div className="mono" style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 3 }}>
                #{String(cfg.seed).padStart(4, '0')} · v_p {P.vp.toFixed(2)} m/s{cfg.mismatch ? ' · MISMATCH' : ''}{cfg.compare ? ' · 5-WAY' : ''}
              </div>
            </div>
          </div>
          <div className="hud-tr">
            <Seg options={[{ value: 'chase', label: 'Chase' }, { value: 'side', label: 'Side' }, { value: 'top', label: 'Top' }, { value: 'deck', label: 'Deck' }] as const} value={cam} onChange={setCam} label="Camera" />
          </div>
          <div className="hud-bl">
            <div className="hud-card hud-big">
              <Readout label="Alt z" value={fmt.f(Math.max(0, s[0]), 2)} unit="m" />
              <Readout label="Sink v_z" value={fmt.f(s[1], 2)} unit="m/s" />
              <Readout label="Roll φ" value={fmt.deg(s[4], 2)} unit="°" color={Math.abs(s[4]) > ENVELOPE.phi_max ? 'var(--crit)' : undefined} />
              <Readout label="Offset y" value={fmt.s(s[2], 2)} unit="m" />
              <Readout label="Slip Δv_y" value={fmt.s(s[3], 2)} unit="m/s" />
            </div>
            <div className="hud-card timeline" style={{ height: 52, padding: '8px 14px' }}>
              <div style={{ position: 'absolute', left: 14, right: 14, top: 0, bottom: 0 }}>
                <div className="timeline-track" />
                <div className="timeline-fill" style={{ width: `${(tr.t / tMax) * 100}%` }} />
                {ms.finalApproach !== undefined && <div className="timeline-mark" style={{ left: `${(ms.finalApproach / tMax) * 100}%`, background: 'var(--info)' }}><span>FINAL</span></div>}
                {ms.groundEffect !== undefined && <div className="timeline-mark" style={{ left: `${(ms.groundEffect / tMax) * 100}%`, background: 'var(--warn)' }}><span style={{ transform: 'translateX(-10%)' }}>GE</span></div>}
                {ms.touchdown !== undefined && <div className="timeline-mark" style={{ left: `${(ms.touchdown / tMax) * 100}%`, background: res?.success ? 'var(--ok)' : 'var(--crit)', height: 14 }}><span>TD</span></div>}
              </div>
            </div>
            <div className="btn-row" style={{ pointerEvents: 'auto' }}>
              <button type="button" className="btn icon primary" onClick={() => engine.togglePlay()} aria-label={engine.playing ? 'Pause' : 'Play'}>
                {engine.playing && !tr.done ? <Pause size={14} /> : <Play size={14} />}
              </button>
              <button type="button" className="btn icon" onClick={() => engine.reset()} aria-label="Reset trial"><RotateCcw size={14} /></button>
              <button type="button" className="btn icon" onClick={() => engine.nextSeed()} aria-label="Next seed"><SkipForward size={14} /></button>
            </div>
          </div>

          {tr.done && res && engine.trials.every((t) => t.done) && (
            <Verdict />
          )}
        </div>
      </section>

      {/* ---------------- Right: instruments ---------------- */}
      <div className="flight-right" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Panel tag="INS-01" title="Attitude · altitude">
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: 0 }}><Attitude tr={tr} /></div>
            <AltTape tr={tr} />
          </div>
        </Panel>
        <Panel tag="NN-01" title="Residual · gate" right={isRes ? <span className="badge signal">Live inference</span> : <span className="badge">Inactive</span>}>
          <GateMonitor tr={tr} />
        </Panel>
        <Panel tag="ENV-01" title="Envelope" right={res ? <span className={`badge ${res.success ? 'ok' : 'crit'}`}>{res.success ? 'Pass' : 'Fail'}</span> : <span className="badge">Monitoring</span>}>
          <EnvelopeCheck tr={tr} />
        </Panel>
        <Panel tag="MAN-01" title="Trial manifest">
          <dl className="kv">
            <dt>K_φ DAGE gain</dt><dd>{P.K_phi.toFixed(4)}</dd>
            <dt>A_GE ground effect</dt><dd>{P.A_GE.toFixed(3)}<small>m/s²</small></dd>
            <dt>J_x roll inertia</dt><dd>{P.Jx.toFixed(4)}<small>kg·m²</small></dd>
            <dt>L · λ · n</dt><dd>{P.L.toFixed(3)} · {P.lam.toFixed(2)} · {P.n.toFixed(1)}</dd>
            <dt>Steps · inferences</dt><dd>{tr.step} · {isRes ? Math.max(0, tr.step - 3) * engine.trials.filter((t) => t.cfg.controller.startsWith('Res')).length : 0}</dd>
          </dl>
        </Panel>
      </div>

      {/* ---------------- Bottom: telemetry ---------------- */}
      <div className="flight-bottom">
        <Panel tag="TLM-01" title="Roll φ" right={<div className="legend">{engine.trials.map((t) => <span key={t.cfg.controller}><i style={{ background: COLORS[t.cfg.controller] }} />{CONTROLLER_INFO[t.cfg.controller].short}</span>)}</div>} bodyClass="chart-body" style={{ minHeight: 0 }}>
          <StripChart series={rollSeries} subscribe={sub} range={{ auto: true, min: 0.04 }}
            hlines={[{ y: ENVELOPE.phi_max, color: 'rgba(255,77,79,0.6)', label: 'φ_max' }, { y: -ENVELOPE.phi_max, color: 'rgba(255,77,79,0.6)' }]} />
        </Panel>
        <Panel tag="TLM-02" title="Disturbance τ" right={<div className="legend"><span><i style={{ background: '#ff6b1a' }} />true DAGE</span>{isRes && <span style={{ color: '#e8ecef' }}><i className="dash" style={{ color: '#e8ecef' }} />NN τ̂</span>}{cfg.controller === 'PID+DOB' && <span><i className="dash" style={{ color: '#e8c547' }} />DOB d̂</span>}</div>}>
          <StripChart series={distSeries} subscribe={sub} range={{ auto: true, min: 0.02 }} />
        </Panel>
        <Panel tag="TLM-03" className="chart-optional" title={ch3 === 'sigma' ? 'Gate weight σ' : ch3 === 'alt' ? 'Altitude z' : 'Lateral slip Δv_y'}
          right={<Seg options={[{ value: 'sigma', label: 'σ' }, { value: 'alt', label: 'z' }, { value: 'slip', label: 'Δv' }] as const} value={ch3} onChange={setCh3} label="Channel" />}>
          {ch3 === 'sigma' && <StripChart key="s" series={ch3Series} subscribe={sub} range={[0, 1.08]} hlines={[{ y: 1, color: 'rgba(61,214,140,0.35)' }]} fmtY={(v) => v.toFixed(1)} />}
          {ch3 === 'alt' && <StripChart key="a" series={ch3Series} subscribe={sub} range={[0, 4.4]} bands={[{ y0: 0, y1: SIM.R_z, color: 'rgba(245,184,61,0.08)' }]} hlines={[{ y: 1, color: 'rgba(89,168,255,0.5)', label: 'final approach' }]} />}
          {ch3 === 'slip' && <StripChart key="v" series={ch3Series} subscribe={sub} range={{ auto: true, min: 1 }} hlines={[{ y: ENVELOPE.dvy_max, color: 'rgba(255,77,79,0.6)', label: 'Δv_max' }, { y: -ENVELOPE.dvy_max, color: 'rgba(255,77,79,0.6)' }]} />}
        </Panel>
        <Panel tag="LOG-01" title="Mission event log" right={<span className="mono" style={{ fontSize: 9.5, color: 'var(--text-4)' }}>{engine.log.length} events</span>} flush bodyClass="log-body">
          <EventLog />
        </Panel>
      </div>
    </div>
  );
}

function EventLog() {
  const ref = useRef<HTMLDivElement>(null);
  const n = engine.log.length;
  const last = engine.log[n - 1]?.id;
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight }); }, [last]);
  return (
    <div className="log" ref={ref}>
      {engine.log.map((e) => (
        <div key={e.id} className={`log-row ${e.level}`}>
          <span className="lt">T+{e.t.toFixed(2)}</span>
          <span className="lk">{e.key}</span>
          <span>{e.msg}</span>
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
  return (
    <div className="verdict" role="status">
      <div className="verdict-band" style={{ background: ok ? 'var(--ok)' : 'var(--crit)' }} />
      <div className="verdict-h">
        <span className={`badge ${ok ? 'ok' : 'crit'}`}>{ok ? 'Envelope pass' : 'Envelope fail'}</span>
        <h2>{ok ? 'Touchdown nominal' : 'Unsafe touchdown'}</h2>
      </div>
      <div className="verdict-sub">
        {CONTROLLER_INFO[tr.cfg.controller].name} landed at T+{r.touchdownT.toFixed(2)} s, {Math.abs(r.touchdownY).toFixed(2)} m from pad centre.
        {!ok && <> Violated: {failReasons(r).join(', ')}.</>}
        {tr.cfg.controller === 'Res-G' && <> Mean gate weight σ̄ = {r.meanSigma.toFixed(3)}.</>}
      </div>
      <div className="verdict-grid">
        <Readout label="Peak |φ|" value={r.peakPhi.toFixed(4)} unit="rad" color={r.peakPhi > ENVELOPE.phi_max ? 'var(--crit)' : undefined} />
        <Readout label="RMS φ" value={r.rmsPhi.toFixed(4)} unit="rad" />
        <Readout label="|v_z|" value={r.vz.toFixed(3)} unit="m/s" color={r.vz > ENVELOPE.vz_max ? 'var(--crit)' : undefined} />
        <Readout label="|Δv_y|" value={r.dvy.toFixed(3)} unit="m/s" color={r.dvy > ENVELOPE.dvy_max ? 'var(--crit)' : undefined} />
      </div>
      {others.length > 0 && (
        <div style={{ borderTop: '1px solid var(--line-2)', padding: '8px 14px' }}>
          <table className="tbl" style={{ fontSize: 10.5 }}>
            <thead><tr><th>Controller</th><th>Peak |φ|</th><th>|Δv_y|</th><th>|v_z|</th><th>Result</th></tr></thead>
            <tbody>
              {engine.trials.map((t) => (
                <tr key={t.cfg.controller}>
                  <td><span style={{ display: 'inline-block', width: 7, height: 7, background: COLORS[t.cfg.controller], marginRight: 7, borderRadius: 1 }} />{t.cfg.controller}</td>
                  <td>{t.result!.peakPhi.toFixed(4)}</td><td>{t.result!.dvy.toFixed(3)}</td><td>{t.result!.vz.toFixed(3)}</td>
                  <td style={{ color: t.result!.success ? 'var(--ok)' : 'var(--crit)' }}>{t.result!.success ? 'PASS' : 'FAIL'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="verdict-f">
        <button type="button" className="btn sm" onClick={() => engine.reset()}><RotateCcw size={12} /> Re-fly</button>
        <button type="button" className="btn sm primary" onClick={() => engine.nextSeed()}>Next seed <SkipForward size={12} /></button>
      </div>
    </div>
  );
}
