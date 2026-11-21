import { useEffect, useState, type ReactNode } from 'react';
import { Copy, Check, Info } from 'lucide-react';
import { SIM, CONTROL, ENVELOPE, MISMATCH, RANDOMISATION, MAX_TRAIN_SPEED } from '../sim/physics';
import { getNetwork } from '../sim/network';
import { evaluationResults } from '../data/results';
import { CONTROLLERS } from '../sim/trial';
import { CTRL_VAR } from '../ui/theme';

const SECTIONS = [
  ['install', 'Installation'],
  ['quickstart', 'Quick start'],
  ['cli', 'Command line'],
  ['python', 'Python API'],
  ['model', 'How it works'],
  ['modules', 'Modules'],
  ['config', 'Configuration'],
  ['rl', 'Reinforcement learning'],
  ['reproduce', 'Reproducing the paper'],
  ['testing', 'Testing'],
  ['web', 'Web lab'],
  ['structure', 'Project structure'],
  ['licence', 'Licence'],
] as const;

function Code({ lang, children }: { lang: string; children: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(children.trim()); setDone(true); setTimeout(() => setDone(false), 1400); } catch { /* clipboard unavailable */ }
  };
  const lines = children.trim().split('\n');
  return (
    <div className="code">
      <div className="code-h">
        <span>{lang}</span>
        <button type="button" className="btn ghost sm" onClick={copy} aria-label="Copy code">{done ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}</button>
      </div>
      <pre>
        {lines.map((l, i) => {
          const hash = l.indexOf('#');
          if (hash >= 0 && (lang === 'Shell' || lang === 'Python')) {
            return <span key={i}>{l.slice(0, hash)}<span className="c">{l.slice(hash)}</span>{'\n'}</span>;
          }
          return <span key={i}>{l}{'\n'}</span>;
        })}
      </pre>
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="table-card">
      <table className="tbl">
        <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{typeof c === 'string' && c.length > 1 && c.startsWith('`') && c.endsWith('`') ? <code>{c.slice(1, -1)}</code> : c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <div className="callout"><Info size={17} /><div>{children}</div></div>;
}

export default function Docs() {
  const [active, setActive] = useState<string>('install');

  useEffect(() => {
    const root = document.querySelector('.main');
    const els = SECTIONS.map(([id]) => document.getElementById(`doc-${id}`)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver((entries) => {
      const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (vis[0]) setActive(vis[0].target.id.replace('doc-', ''));
    }, { root, rootMargin: '-10% 0px -70% 0px' });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);

  const jump = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById(`doc-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const net = getNetwork();

  return (
    <div className="docs">
      <nav className="toc" aria-label="On this page">
        <div className="side-h">On this page</div>
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#docs`} className={active === id ? 'on' : ''} onClick={jump(id)}>{label}</a>
        ))}
      </nav>

      <article className="doc">
        <h1>Documentation</h1>
        <p className="lead">DAGE-Bench is a pure-Python simulation benchmark for UAV landing on moving platforms under dynamic asymmetric ground effect. It compares five controllers, from PD to a gated learned residual, with a fully reproducible Monte Carlo protocol.</p>

        <section id="doc-install">
          <h2>Installation</h2>
          <p>You need Python 3.10 or newer, NumPy 1.24+ and Matplotlib 3.7+. No deep-learning framework is required: the network, backpropagation and the Adam optimiser are written in NumPy.</p>
          <Code lang="Shell">{`git clone https://github.com/ravideo9021/DAGE-Bench.git
cd DAGE-Bench
pip install -e .            # installs the \`dage\` command`}</Code>
          <h3>Optional extras</h3>
          <Code lang="Shell">{`pip install -e ".[dev]"     # pytest and ruff
pip install -e ".[rl]"      # Gymnasium environment
pip install numpy matplotlib && python main.py run-all   # without installing the package`}</Code>
        </section>

        <section id="doc-quickstart">
          <h2>Quick start</h2>
          <p>One command runs the whole study: training, the main evaluation, the mismatch study, the gate ablation and the figures. It takes about 15–20 minutes on a modern laptop.</p>
          <Code lang="Shell">{`dage run-all -v`}</Code>
          <ol style={{ paddingLeft: 20, margin: '0 0 14px' }}>
            <li><b>Training.</b> Generates 460 PID trajectories (400 train, 60 validation), trains the residual network and calibrates the gate.</li>
            <li><b>Main evaluation (Table III).</b> 5 speeds × 5 controllers × 500 trials = 12,500 landings.</li>
            <li><b>Mismatch study (Table IV).</b> Re-runs with the disturbance parameters perturbed.</li>
            <li><b>Gate ablation (Table V).</b> Sweeps κ and the d₀ scale at 6 m/s.</li>
            <li><b>Figures.</b> Training curves, descent profile, roll error, envelope comparison and heatmap.</li>
          </ol>
          <p>Outputs land in <code>results/</code>: the trained model <code>residual_model.npz</code>, CSV tables, formatted text tables, <code>config.json</code> and the figures.</p>
        </section>

        <section id="doc-cli">
          <h2>Command line</h2>
          <p>Every phase can also run on its own. The phases after training load <code>results/residual_model.npz</code>.</p>
          <Table head={['Command', 'What it does', 'Writes']} rows={[
            ['`dage train`', 'Generates trajectories, trains the MLP with Adam (decay 0.94/epoch, dropout 5%, input noise 2%, early stopping), calibrates d₀ at the 99th percentile.', '`residual_model.npz, training_curves.csv`'],
            ['`dage evaluate`', '500 randomised trials per (speed, controller) for speeds 0, 1.5, 3, 5, 6 m/s.', '`evaluation_results.csv, table_iii.txt`'],
            ['`dage mismatch`', `Evaluation with K_φ ×${MISMATCH.K_phi_scale}, A_GE ×${MISMATCH.A_GE_scale}, L ×${MISMATCH.L_scale}, R_z ×${MISMATCH.R_z_scale}, n ${MISMATCH.decay_exp}, λ ${MISMATCH.lam}.`, '`mismatch/table_iv.txt`'],
            ['`dage gate-ablation`', 'κ ∈ {0.4, 0.8, 1.2, 2.4} × d₀ scale ∈ {0.6, 0.8, 1.0} at 6 m/s, plus ungated and PID baselines, 300 trials per cell.', '`gate_ablation/gate_ablation.json`'],
            ['`dage visualize`', 'Runs a quick 100-trial evaluation and renders the publication figures at 300 DPI.', '`figures/*.png`'],
            ['`dage run-all`', 'All of the above in order, plus the full configuration.', '`config.json`'],
          ]} />
          <p>Add <code>-v</code> to any command for debug-level logging. <code>python -m dage.cli</code> works without installing the entry point.</p>
        </section>

        <section id="doc-python">
          <h2>Python API</h2>
          <p>Each phase is a plain function over dataclass configs, so you can script variations directly.</p>
          <Code lang="Python">{`from pathlib import Path
from dage.config import ProjectConfig
from dage.training import train_network
from dage.evaluation import run_full_evaluation

cfg = ProjectConfig()
network = train_network(cfg.train, cfg.network, cfg.sim, cfg.control, cfg.gate, Path("results"))

results = run_full_evaluation(cfg.sim, cfg.control, cfg.eval, cfg.gate, network=network)
r = results[(6.0, "Res-G")]
print(f"Envelope success: {r.envelope_success_rate:.1%}")   # 100.0%
print(f"RMS roll: {r.rms_phi_mean:.4f} rad")`}</Code>
          <p>Configurations round-trip through JSON with <code>cfg.save("config.json")</code> and <code>ProjectConfig.load("config.json")</code>.</p>
        </section>

        <section id="doc-model">
          <h2>How it works</h2>
          <h3>Plant</h3>
          <p>The state is <code>[z, v_z, y_rel, v_y,rel, φ, p]</code>: altitude, sink rate, lateral offset and velocity relative to the platform, roll and roll rate. It is integrated with RK4 at {1 / SIM.dt} Hz with Gaussian sensor noise on every channel and torque process noise.</p>
          <div className="eq"><span className="lbl">Eq. 6 · DAGE roll torque</span>τ<sub>φ</sub> = <var>K</var><sub>φ</sub> [ v<sub>y</sub> + <var>λ</var>(v<sub>y</sub> − v<sub>p</sub>) ] cos φ / ( 1 + (z/<var>L</var>)<sup><var>n</var></sup> )</div>
          <div className="eq"><span className="lbl">Eq. 7 · vertical ground effect</span>a<sub>GE</sub> = <var>A</var><sub>GE</sub> / ( 1 + (z/<var>R</var><sub>z</sub>)<sup><var>n</var></sup> )</div>
          <p>v<sub>y</sub> is the vehicle's inertial lateral velocity. The first term is the airspeed component; the λ term is the slip between vehicle and deck that makes the cushion asymmetric.</p>
          <h3>Touchdown envelope</h3>
          <p>A landing succeeds when, at ground contact, peak roll on final approach is at most {ENVELOPE.phi_max} rad ({(ENVELOPE.phi_max * 57.3).toFixed(1)}°), sink rate is at most {ENVELOPE.vz_max} m/s, and lateral slip relative to the deck is at most {ENVELOPE.dvy_max} m/s.</p>
          <h3>Controllers</h3>
          <div className="cards">
            {CONTROLLERS.map((c) => {
              const r = evaluationResults.find((x) => x.vp === 6 && x.controller === c)!;
              const desc: Record<string, string> = {
                PD: 'Proportional–derivative cascade without integral action.',
                PID: 'Vertical PID on a linear descent profile, lateral loop to roll set-point, roll PID.',
                'PID+DOB': 'PID plus a first-order Luenberger observer that estimates and cancels roll torque.',
                'Res-NG': 'PID plus the learned residual, always fully applied.',
                'Res-G': 'PID plus the learned residual, scaled by the state-space distance gate.',
              };
              return (
                <div key={c} className="card-s">
                  <h4><span style={{ width: 9, height: 9, borderRadius: 5, background: CTRL_VAR[c] }} />{c}</h4>
                  <p>{desc[c]} {r.envelope_pct.toFixed(1)}% safe at 6 m/s.</p>
                </div>
              );
            })}
          </div>
          <h3>Residual network</h3>
          <p>A {net.layers.map((l) => l.nIn).concat(2).join(' → ')} MLP with tanh hidden layers ({net.nParams.toLocaleString()} parameters, {net.nMacs.toLocaleString()} multiply-adds). Its input is the last four steps of <code>[φ, p, z, v_z, u_φ, u_z]</code>; its output is the predicted <code>[τ_φ, a_GE]</code>. Inputs and outputs are z-scored with training statistics. The controller applies <code>u = u_nom − σ · r̂</code>.</p>
          <h3>Safety gate</h3>
          <div className="eq"><span className="lbl">Eq. 12–13</span>d(<var>x</var>) = max<sub>i</sub> |<var>x</var><sub>i</sub> − μ<sub>i</sub>| / σ<sub>i</sub>   ·   σ(<var>x</var>) = exp( −max(0, d − d₀) / κ )</div>
          <p>d₀ is calibrated at the 99th percentile of validation distances (d₀ = {net.d0.toFixed(3)}). Inside the training distribution σ = 1; far outside it the correction fades and the vehicle flies on PID alone.</p>
        </section>

        <section id="doc-modules">
          <h2>Modules</h2>
          <div className="cards">
            {[
              ['dage/dynamics.py', 'DAGE torque, ground effect and the RK4 Simulator with sensor noise.'],
              ['dage/controllers.py', 'NominalController (PD, PID, PID+DOB) and ResidualController with the gate.'],
              ['dage/network.py', 'ResidualMLP with forward, backward and save/load, plus AdamOptimizer.'],
              ['dage/training.py', 'Trajectory generation, windowed datasets, training loop, gate calibration.'],
              ['dage/evaluation.py', 'Single trials with touchdown detection, Monte Carlo conditions, ablation.'],
              ['dage/statistics.py', 'Wilson score intervals, normal-approximation means, paired bootstrap.'],
              ['dage/visualization.py', 'Publication figures and the formatted Table III.'],
              ['dage/config.py', 'Dataclasses for every constant, with JSON save and load.'],
              ['dage/envs.py', 'Gymnasium environment for reinforcement-learning baselines.'],
              ['dage/cli.py', 'The dage command and its subcommands.'],
            ].map(([f, d]) => <div key={f} className="card-s"><h4><code>{f}</code></h4><p>{d}</p></div>)}
          </div>
        </section>

        <section id="doc-config">
          <h2>Configuration</h2>
          <p>Every constant lives in <code>dage/config.py</code>. The defaults match Table I of the paper.</p>
          <h3>Simulation · SimConfig</h3>
          <Table head={['Field', 'Default', 'Meaning']} rows={[
            ['`dt`', `${SIM.dt} s`, 'Integration step (100 Hz)'],
            ['`horizon`', `${SIM.horizon} s`, 'Maximum trial length'],
            ['`z0`', `${SIM.z0} m`, 'Initial altitude'],
            ['`v_des`', `${SIM.v_des} m/s`, 'Commanded descent rate'],
            ['`mass`', `${SIM.mass} kg`, 'Vehicle mass'],
            ['`Jx`', `${SIM.Jx} kg·m²`, 'Roll inertia'],
            ['`A_GE`', `${SIM.A_GE} m/s²`, 'Ground-effect amplitude'],
            ['`R_z`', `${SIM.R_z} m`, 'Ground-effect length scale'],
            ['`K_phi`', `${SIM.K_phi}`, 'DAGE torque gain'],
            ['`L`', `${SIM.L} m`, 'DAGE altitude scale'],
            ['`lam`', `${SIM.lam}`, 'Slip weight λ'],
            ['`decay_exp`', `${SIM.decay_exp}`, 'Inverse-polynomial exponent n'],
            ['`sigma_*`', 'z 0.010 · v_z 0.030 · φ 0.004 · p 0.020 · y 0.010 · v_y 0.030', 'Sensor noise standard deviations'],
            ['`tau_noise_std`', `${SIM.tau_noise_std}`, 'Process (torque) noise'],
          ]} />
          <h3>Control · ControlConfig</h3>
          <Table head={['Field', 'Default', 'Meaning']} rows={[
            ['`z_gains`', `Kp ${CONTROL.z.Kp} · Kd ${CONTROL.z.Kd} · Ki ${CONTROL.z.Ki}`, 'Vertical PID'],
            ['`phi_gains`', `Kp ${CONTROL.phi.Kp} · Kd ${CONTROL.phi.Kd} · Ki ${CONTROL.phi.Ki}`, 'Roll PID'],
            ['`lat_Kp / lat_Kd`', `${CONTROL.lat_Kp} / ${CONTROL.lat_Kd}`, 'Lateral position and velocity to roll set-point'],
            ['`dob_tau`', `${CONTROL.dob_tau} s`, 'Disturbance-observer time constant'],
          ]} />
          <h3>Network and training · NetworkConfig, TrainConfig</h3>
          <Table head={['Field', 'Default', 'Meaning']} rows={[
            ['`window`', '4', 'History steps'],
            ['`hidden_sizes`', '[64, 64, 32]', 'Hidden widths, tanh'],
            ['`dropout / input_noise_std`', '0.05 / 0.02', 'Training regularisation'],
            ['`n_trajectories / n_val_trajectories`', '400 / 60', 'Simulated trajectories'],
            ['`n_train_samples`', '200,000', 'Sub-sampled training points'],
            ['`lr / lr_decay`', '8e-4 / 0.94', 'Adam learning rate and per-epoch decay'],
            ['`batch_size / patience`', '256 / 6', 'Mini-batch size and early stopping'],
            ['`grad_clip / weight_decay`', '5.0 / 1e-5', 'Gradient norm clip and L2'],
            ['`max_train_speed`', `${MAX_TRAIN_SPEED} m/s`, 'Platform speeds seen in training'],
            ['`seed_data / seed_net`', '42 / 1', 'Fixed seeds'],
          ]} />
          <h3>Gate and evaluation · GateConfig, EvalConfig</h3>
          <Table head={['Field', 'Default', 'Meaning']} rows={[
            ['`d0_percentile`', '0.99', 'Calibration percentile for d₀'],
            ['`kappa / d0_scale`', '1.0 / 1.0', 'Gate decay and threshold scale'],
            ['`n_trials`', '500', 'Trials per condition'],
            ['`platform_speeds`', '[0, 1.5, 3, 5, 6]', 'Speeds evaluated (m/s)'],
            ['`phi_max / vz_max / dvy_max`', `${ENVELOPE.phi_max} / ${ENVELOPE.vz_max} / ${ENVELOPE.dvy_max}`, 'Touchdown envelope'],
            ['`*_range`', `K_φ ${RANDOMISATION.K_phi.join('–')} · A_GE ${RANDOMISATION.A_GE.join('–')} · J_x ${RANDOMISATION.Jx.join('–')} · v_p ${RANDOMISATION.vp.join('–')}`, 'Per-trial randomisation (multipliers)'],
            ['`y0_std / phi0_std`', `${RANDOMISATION.y0_std} m / ${RANDOMISATION.phi0_std} rad`, 'Initial offset and roll'],
            ['`seed`', '100', 'Evaluation seed base (trial i uses 100 + i)'],
          ]} />
        </section>

        <section id="doc-rl">
          <h2>Reinforcement learning</h2>
          <p><code>dage/envs.py</code> wraps the same plant as a Gymnasium environment, so learned policies can be compared with the controllers above.</p>
          <Code lang="Python">{`import gymnasium as gym
from dage.envs import register_envs

register_envs()
env = gym.make("DAGELanding-OOD-v0")          # 6 m/s platform
obs, info = env.reset(seed=0)
obs, reward, terminated, truncated, info = env.step(env.action_space.sample())`}</Code>
          <Table head={['Environment', 'Platform speed', 'Episode limit']} rows={[
            ['`DAGELanding-v0`', '3.0 m/s', '1,200 steps'],
            ['`DAGELanding-Random-v0`', 'Uniform 0–6 m/s each episode', '1,200 steps'],
            ['`DAGELanding-OOD-v0`', '6.0 m/s', '1,200 steps'],
          ]} />
          <ul>
            <li><b>Observation</b> (8): <code>[z, v_z, y_rel, v_y,rel, φ, p, t_norm, v_p,norm]</code>, clipped to the observation box.</li>
            <li><b>Action</b> (2): <code>u_z ∈ [−15, 5] m/s²</code>, <code>u_φ ∈ [−2, 2] N·m</code>.</li>
            <li><b>Reward</b>: −0.1(φ² + 0.5 y²) tracking, +0.01 while descending, −0.001(u_z² + u_φ²) effort. +100 for a landing inside the envelope plus up to +20 for softness; −50 and proportional penalties outside it; −30 on timeout.</li>
          </ul>
        </section>

        <section id="doc-reproduce">
          <h2>Reproducing the paper</h2>
          <p>Seeds are fixed throughout: data generation 42, network initialisation 1, evaluation 100. Envelope success from Table III:</p>
          <Table head={['Platform speed', ...CONTROLLERS]} rows={[0, 1.5, 3, 5, 6].map((vp) => [
            `${vp.toFixed(1)} m/s${vp > MAX_TRAIN_SPEED ? ' *' : ''}`,
            ...CONTROLLERS.map((c) => {
              const v = evaluationResults.find((r) => r.vp === vp && r.controller === c)!.envelope_pct;
              return <span key={c} style={{ color: v < 99.5 ? (v < 50 ? 'var(--crit)' : 'var(--warn)') : undefined, fontWeight: v < 99.5 ? 600 : 400 }}>{v.toFixed(1)}%</span>;
            }),
          ])} />
          <p>* Beyond the training range. Impact speeds: PD 0.246 m/s, PID 0.335 m/s.</p>
          <Note>The web lab reproduces these figures independently in your browser. Its Monte Carlo view runs the same protocol and marks every cell that falls inside the paper's 95% interval.</Note>
        </section>

        <section id="doc-testing">
          <h2>Testing</h2>
          <Code lang="Shell">{`python -m pytest tests/ -v`}</Code>
          <Table head={['File', 'Tests', 'Covers']} rows={[
            ['`test_dynamics.py`', '12', 'Ground-effect scaling, DAGE torque, simulator shape, free fall, RK4 accuracy, noise'],
            ['`test_network.py`', '9', 'Parameter and MAC counts, forward/backward shapes, save/load, flat parameters'],
            ['`test_controllers.py`', '8', 'Integral action, lateral coupling, unclamped reference, observer, gate suppression'],
            ['`test_statistics.py`', '7', 'Wilson intervals at the edges, mean CI, paired bootstrap'],
            ['`test_integration.py`', '5', 'Impact speeds match the paper, controller ordering at 6 m/s, training end to end'],
          ]} />
        </section>

        <section id="doc-web">
          <h2>Web lab</h2>
          <p>This site lives in <code>dashboard/</code>. It is a TypeScript port of the plant, controllers and trained network, with a three.js viewport and a Web Worker pool for Monte Carlo runs.</p>
          <Code lang="Shell">{`cd dashboard
npm install
npm run dev              # local development server
npm run validate         # compare the TypeScript port with NumPy and the paper
npm run export-model     # refresh weights after retraining (needs NumPy)
npm run build            # static site in dashboard/dist`}</Code>
          <p>The port matches the NumPy forward pass to 4e-16 and the RK4 step exactly. Its random number generator differs from NumPy's, so individual trials differ while the statistics agree.</p>
        </section>

        <section id="doc-structure">
          <h2>Project structure</h2>
          <Code lang="Text">{`DAGE-Bench/
├── dage/                 core package (config, dynamics, controllers,
│                         network, training, evaluation, statistics,
│                         visualization, envs, cli)
├── tests/                47 tests
├── results/              trained model, tables, figures, config.json
├── dashboard/            this web lab (Vite + React + three.js)
├── main.py               entry point without installing
└── pyproject.toml`}</Code>
        </section>

        <section id="doc-licence">
          <h2>Licence</h2>
          <p>Released under the MIT licence. The software accompanies an academic paper on residual compensation of dynamic asymmetric ground effect; please cite it if you use this code in your research.</p>
        </section>
      </article>
    </div>
  );
}
