# DAGE-Bench

**Residual Compensation of a Phenomenological Dynamic Asymmetric Ground-Effect Disturbance for UAV Landing on Moving Platforms: A Simulation Study of State-Space Safety Gating**

**Live web lab:** https://ravideo9021.github.io/DAGE-Bench/

A pure-Python simulation benchmark implementing the methods described in the accompanying research paper. DAGE-Bench provides a fully reproducible evaluation framework for comparing classical and learning-augmented controllers for UAV precision landing under dynamic asymmetric ground-effect (DAGE) disturbances.

---

## Table of Contents

- [Overview](#overview)
- [Problem Statement](#problem-statement)
- [Architecture](#architecture)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [CLI Reference](#cli-reference)
- [Module Reference](#module-reference)
  - [Dynamics Engine](#dynamics-engine-dagedynamicspy)
  - [Controllers](#controllers-dagecontrollerspy)
  - [Residual Network](#residual-network-dagenetworkpy)
  - [Training Pipeline](#training-pipeline-dagetrainingpy)
  - [Evaluation Engine](#evaluation-engine-dageevaluationpy)
  - [Statistics](#statistics-dagestatisticspy)
  - [Visualization](#visualization-dagevisualizationpy)
  - [Configuration](#configuration-dageconfigpy)
- [Reproducing Paper Results](#reproducing-paper-results)
- [Testing](#testing)
- [Project Structure](#project-structure)
- [Configuration Reference](#configuration-reference)
- [License](#license)

---

## Overview

When a multirotor UAV descends toward a moving platform (e.g., a ship deck or autonomous surface vehicle), the interaction between the vehicle's downwash and the platform surface creates a ground-effect disturbance. Unlike hovering above a static surface — where the ground effect is symmetric and vertical — a moving platform introduces an **asymmetric** roll-channel torque that scales with platform speed and intensifies as altitude decreases. This Dynamic Asymmetric Ground-Effect (DAGE) disturbance can destabilise the vehicle during the final approach, the most safety-critical phase of the landing.

This project implements five controllers of increasing sophistication and evaluates them across a Monte Carlo framework:

| Controller | Description |
|---|---|
| **PD** | Proportional-derivative only (no integral action) |
| **PID** | Full proportional-integral-derivative (baseline) |
| **PID+DOB** | PID with a first-order disturbance observer on the roll channel |
| **Res-NG** | PID + learned residual compensation (ungated) |
| **Res-G** | PID + learned residual compensation with state-space distance gate |

The key contribution is the **gated residual controller** (Res-G): a compact MLP predicts the DAGE disturbance in real time, and a state-space distance gate smoothly disables the learned correction when the vehicle enters out-of-distribution (OOD) conditions, ensuring safe fallback to the nominal PID.

---

## Problem Statement

### The DAGE Disturbance

The simulator models three coupled channels:

1. **Vertical channel** — altitude `z` and descent rate `vz`, subject to symmetric vertical ground-effect that decelerates the vehicle near the surface
2. **Roll channel** — roll angle `phi` and roll rate `p`, subject to the asymmetric DAGE torque that scales with lateral airspeed and platform velocity
3. **Lateral channel** — relative position `y_rel` and velocity `vy_rel` with respect to the platform centre, coupled to the roll channel through thrust vectoring

The state vector is `[z, vz, y_rel, vy_rel, phi, p]` (6 dimensions), integrated at 100 Hz using fourth-order Runge-Kutta (RK4).

### The DAGE Torque Model (Eq 6)

```
tau_DAGE = K_phi * [vy + lambda * (vy - vp)] * cos(phi) / (1 + (z/L)^n)
```

Where:
- `vy` is the vehicle's inertial lateral velocity
- `vp` is the platform velocity
- `K_phi` is the DAGE disturbance gain (0.12 N-m-s/m)
- `lambda` is the slip-weight fraction (0.60) — representing the platform-velocity-dependent "slip" component
- `L` is the altitude length scale (0.35 m) controlling how quickly the disturbance grows near the ground
- `n` is the decay exponent (2.0)

The first term `vy` captures the airspeed-dependent torque; the second term `lambda * (vy - vp)` captures the asymmetric effect of the platform moving beneath the vehicle.

### Vertical Ground Effect (Eq 7)

```
a_GE(z) = A_GE / (1 + (z/R_z)^n)
```

A purely upward acceleration that intensifies as the vehicle approaches the surface (z -> 0). With `A_GE = 1.8 m/s^2` and `R_z = 0.55 m`, this creates significant deceleration during the final metre of descent.

### Safety Envelope

A landing trial is classified as **successful** if all of the following hold at the moment of touchdown:

- **Roll angle**: |phi| <= 0.10 rad (~5.7 degrees)
- **Vertical impact speed**: |vz| <= 0.75 m/s
- **Lateral velocity mismatch**: |delta_vy| <= 0.75 m/s (velocity difference from platform)

---

## Architecture

### Control Architecture

```
                    ┌─────────────────────────────────┐
                    │        Residual Controller       │
                    │                                  │
  measured ────────>│  Nominal    ──> u_nom            │
  state             │  PID           │                 │
                    │                v                 │
                    │  MLP ──> residual ──> sigma*res  │
                    │  (24→64→64→32→2)     │          │
                    │                      v          │
                    │  Gate ──> sigma ──> u_total     │──> plant
                    │  (Eq 12-13)                      │
                    └─────────────────────────────────┘
```

The cascaded controller structure:

1. **Vertical PID** tracks a linear descent profile: `z_ref(t) = z0 - v_des * t`, `vz_ref = -v_des`
2. **Lateral outer loop** maps relative position/velocity error to a desired roll angle: `phi_des = -(Kp_lat * y_rel + Kd_lat * vy_rel)`
3. **Roll PID** tracks the desired roll angle, producing torque command `u_phi`
4. **Residual MLP** (when active) predicts the DAGE disturbance `[tau_hat, a_hat]` from a sliding window of recent states and control inputs
5. **Distance gate** (Res-G only) computes `sigma in [0, 1]` that smoothly scales the residual correction toward zero when the current state is far from the training distribution

### Network Architecture

```
Input (24-dim) ──> Dense(64) ──> tanh ──> Dense(64) ──> tanh ──> Dense(32) ──> tanh ──> Dense(2)
```

- **Input**: Sliding window of W=4 timesteps, each with 6 features `[phi, p, z, vz, u_phi, u_z]` = 24 dimensions
- **Output**: `[tau_phi_DAGE, a_GE]` — the estimated roll disturbance torque and vertical ground-effect acceleration
- **Parameters**: 7,906 (24×64 + 64 + 64×64 + 64 + 64×32 + 32 + 32×2 + 2)
- **MACs**: 7,744 multiply-accumulate operations per forward pass
- **Activation**: tanh (all hidden layers)
- **Output layer**: Linear (no activation)

The network operates on standardised inputs and outputs, with input/output statistics computed from the training set.

### State-Space Distance Gate (Eq 12-13)

The gate protects against out-of-distribution inputs:

```
d(x) = max_i |x_i - mu_i| / sigma_i       (Eq 12: Chebyshev distance in standardised space)
sigma(x) = exp(-max(0, d(x) - d0) / kappa)  (Eq 13: smooth exponential decay)
```

- `d0` is calibrated at the 99th percentile of distances in the validation set
- `kappa` controls the decay rate (default 1.0)
- When `d(x) < d0`: `sigma = 1.0` (full residual correction)
- When `d(x) >> d0`: `sigma -> 0` (pure nominal PID fallback)

---

## Installation

### Requirements

- Python >= 3.10
- NumPy >= 1.24
- Matplotlib >= 3.7

No deep-learning frameworks (PyTorch, TensorFlow, JAX) are required. The entire neural network — forward pass, backpropagation, and Adam optimiser — is implemented in pure NumPy.

### Install as package

```bash
cd DAGE-Bench
pip install -e .
```

This installs the `dage` command-line tool.

### Install without package (just dependencies)

```bash
pip install numpy matplotlib
python main.py run-all
```

### Development install

```bash
pip install -e ".[dev]"
```

This additionally installs `pytest` and `ruff` for testing and linting.

---

## Quick Start

### Run the complete pipeline

```bash
dage run-all -v
```

This executes all five phases in sequence:

1. **Training** — Generates 460 trajectories (400 train + 60 validation), builds windowed datasets, trains the residual MLP with Adam, calibrates the distance gate
2. **Main evaluation (Table III)** — 500 randomised Monte Carlo trials per condition across 5 platform speeds × 5 controllers = 12,500 total simulations
3. **Mismatch evaluation (Table IV)** — Tests robustness to altered disturbance parameters (K_phi +40%, A_GE +35%, L +30%, etc.)
4. **Gate ablation (Table V)** — Sweeps gate parameters kappa and d0_scale at the most challenging OOD speed (6.0 m/s)
5. **Figure generation** — Produces publication-quality figures (training curves, descent profiles, roll error, envelope comparison, heatmap)

Runtime: approximately 15–20 minutes on a modern laptop.

### Run individual phases

```bash
dage train -v              # Phase 1 only
dage evaluate -v           # Phase 2 only (requires trained model)
dage mismatch -v           # Phase 3 only (requires trained model)
dage gate-ablation -v      # Phase 4 only (requires trained model)
dage visualize -v          # Phase 5 only (requires trained model)
```

### Using from Python

```python
from dage.config import ProjectConfig
from dage.training import train_network
from dage.evaluation import run_full_evaluation
from pathlib import Path

cfg = ProjectConfig()
output = Path("results")

# Train
network = train_network(cfg.train, cfg.network, cfg.sim, cfg.control, cfg.gate, output)

# Evaluate
results = run_full_evaluation(cfg.sim, cfg.control, cfg.eval, cfg.gate, network=network)

# Inspect a single condition
r = results[(6.0, "Res-G")]
print(f"Envelope success: {r.envelope_success_rate:.1%}")
print(f"RMS roll: {r.rms_phi_mean:.4f} rad")
```

### Interactive flight console

`dashboard/` contains a browser lab, live at https://ravideo9021.github.io/DAGE-Bench/, that runs this benchmark: the plant, all five controllers and the trained residual network, ported to TypeScript and verified against NumPy at boot. It includes a real-time 3D landing view, a multi-threaded Monte Carlo runner that reproduces Table III/IV, a live network inspector, and gate and disturbance-model explorers.

```bash
cd dashboard && npm install && npm run dev
```

See [`dashboard/README.md`](dashboard/README.md).

---

## CLI Reference

All commands are accessible through the `dage` entry point (or `python -m dage.cli`).

### `dage train`

Trains the residual MLP network.

**Pipeline**:
1. Generates `n_trajectories + n_val_trajectories` (default 460) simulation trajectories under the PID baseline controller, with per-trajectory randomisation of physical parameters
2. Builds windowed input/target datasets from the trajectories
3. Subsamples the training set to `n_train_samples` (default 200,000) points
4. Computes input/output standardisation statistics
5. Trains with Adam optimiser, learning-rate decay (0.94×/epoch), dropout (5%), input noise injection (2%), gradient clipping (norm 5.0), and early stopping (patience 6)
6. Calibrates the gate threshold `d0` at the 99th percentile of Chebyshev distances on the validation set
7. Saves the model to `results/residual_model.npz`

**Output files**:
- `results/residual_model.npz` — Trained weights, standardisation parameters, gate threshold
- `results/training_curves.csv` — Per-epoch train/validation MSE for plotting

### `dage evaluate`

Runs the main Monte Carlo evaluation (Table III).

For each combination of platform speed (0.0, 1.5, 3.0, 5.0, 6.0 m/s) and controller (PD, PID, PID+DOB, Res-NG, Res-G), runs 500 independent trials. Each trial has randomised initial conditions (lateral offset, roll angle) and physical parameters (K_phi, A_GE, Jx, vp within specified ranges).

**Output files**:
- `results/evaluation_results.csv` — Full results matrix
- `results/table_iii.txt` — Formatted text table matching the paper's Table III

### `dage mismatch`

Runs the disturbance-model mismatch evaluation (Table IV).

Tests the controllers when the actual disturbance parameters differ from the training-time values. The mismatch configuration scales multiple parameters simultaneously (K_phi ×1.40, A_GE ×1.35, L ×1.30, R_z ×1.40, decay exponent changed from 2.0 to 1.6, lambda changed from 0.60 to 1.00).

**Output files**:
- `results/mismatch/evaluation_results.csv`
- `results/mismatch/table_iv.txt`

### `dage gate-ablation`

Runs the gate parameter sweep (Table V).

Evaluates the gated residual controller at `vp = 6.0 m/s` (OOD) across different combinations of:
- `kappa` ∈ {0.4, 0.8, 1.2, 2.4}
- `d0_scale` ∈ {0.6, 0.8, 1.0}

Plus baselines: ungated (sigma=1) and PID (no residual). 300 trials per cell.

**Output files**:
- `results/gate_ablation/gate_ablation.json`

### `dage visualize`

Generates publication-quality figures using Matplotlib.

Runs a quick 100-trial evaluation to collect trajectory data, then renders:

1. `fig3_training_curves.png` — Training and validation loss vs epoch
2. `fig4_descent_profile.png` — Representative altitude-vs-time trajectories at vp=3.0 m/s for PD, PID, and Res-G
3. `fig5_roll_error.png` — Roll angle magnitude on final approach
4. `envelope_comparison.png` — Grouped bar chart of envelope success rates across all speeds and controllers, with Wilson score confidence intervals
5. `rms_phi_heatmap.png` — Colour-coded matrix of RMS roll error

**Output directory**: `results/figures/`

### `dage run-all`

Executes all five phases in sequence. Equivalent to running train → evaluate → mismatch → gate-ablation → visualize, plus saving the full configuration to `results/config.json`.

### Common flags

| Flag | Description |
|---|---|
| `-v`, `--verbose` | Enable verbose (DEBUG-level) logging |

---

## Module Reference

### Dynamics Engine (`dage/dynamics.py`)

The physics core of the simulator.

#### `dage_torque(z, vy_inertial, vp, phi, K_phi, L, lam, decay_exp)`

Computes the DAGE roll torque (Eq 6). Takes the vehicle's **inertial** lateral velocity (not relative to platform) because the disturbance model depends on the total airflow, not just the relative motion.

#### `ground_effect_accel(z, A_GE, R_z, decay_exp)`

Computes the symmetric vertical ground-effect acceleration (Eq 7). Returns a positive (upward) value that decays with the inverse-polynomial of altitude.

#### `Simulator` class

The main simulation engine.

**Key methods**:

- `step_rk4(state, u_z, u_phi, vp, K_phi, A_GE, Jx, ...)` — Advances the 6D state by one timestep (dt=0.01s) using fourth-order Runge-Kutta. Accepts optional mismatch parameters (L, lam, R_z, decay_exp) for evaluating robustness.

- `derivatives(state, u_z, u_phi, vp, ...)` — Computes the time derivatives of the state vector. The equations are:
  - `dz/dt = vz`
  - `dvz/dt = u_z + a_GE(z)`
  - `dy_rel/dt = vy_rel`
  - `dvy_rel/dt = (u_z + g) * tan(phi)` (thrust-vectoring coupling)
  - `dphi/dt = p`
  - `dp/dt = (u_phi + tau_DAGE + tau_noise) / Jx`

- `add_sensor_noise(state)` — Adds Gaussian noise to each state channel with configured standard deviations, simulating realistic sensor measurements.

- `get_dage_torque(state, vp, K_phi, ...)` — Convenience method to compute the DAGE torque for the current state (used for generating training targets).

- `get_ge_accel(state, A_GE, ...)` — Convenience method to compute the ground-effect acceleration for the current state (used for generating training targets).

### Controllers (`dage/controllers.py`)

#### `ControllerState` (dataclass)

Mutable state carried across timesteps:
- `z_integral` — Vertical PID integrator
- `phi_integral` — Roll PID integrator
- `dob_state` — Internal state of the Luenberger observer
- `dob_estimate` — Current disturbance estimate from the DOB

#### `NominalController` class

Implements the cascaded PID controller (Section IV-A, Eq 8).

**Constructor flags**:
- `use_integral=True` — Enables integral action (PID vs PD)
- `use_dob=False` — Enables the disturbance observer on the roll channel

**Control law**:

*Vertical channel:*
```
z_ref(t) = z0 - v_des * t     (linear descent, NOT clamped at zero)
vz_ref = -v_des
u_z = Kp_z * (z_ref - z) + Kd_z * (vz_ref - vz) + Ki_z * integral(z_ref - z)
```

The unclamped reference is critical: when `z_ref` goes negative (after t > z0/v_des), the position error drives the controller to push through the ground-effect cushion, producing realistic impact speeds.

*Lateral outer loop:*
```
phi_des = -(Kp_lat * y_rel + Kd_lat * vy_rel)     (saturated to ±0.5 rad)
```

*Roll channel:*
```
u_phi = Jx * (Kp_phi * (phi_des - phi) + Kd_phi * (-p) + Ki_phi * integral(phi_des - phi))
```

*Disturbance observer (PID+DOB):*

A first-order Luenberger observer estimates the DAGE torque without differentiating the noisy roll rate signal:
```
dz/dt = -l*z - l^2*Jx*p - l*u_phi      (l = 1/tau_dob)
d_hat = z + l*Jx*p
u_phi_corrected = u_phi - d_hat
```

#### `ResidualController` class

Wraps a nominal controller and adds learned residual compensation (Eq 9-10, 12-13).

**Features**:
- Maintains a sliding window of W=4 timesteps of `[phi, p, z, vz, u_phi_nom, u_z_nom]`
- Once the window is full, predicts the DAGE disturbance using the MLP
- Applies the distance gate (if `use_gate=True`) to scale the correction
- Final control: `u_total = u_nom - sigma * residual_pred`

The subtraction sign is intentional: the network predicts the *disturbance*, and the controller cancels it.

### Residual Network (`dage/network.py`)

#### `ResidualMLP` class

A pure-NumPy neural network with full training support.

**Properties**:
- `n_params` — Total parameter count (7,906)
- `n_macs` — Multiply-accumulate operations per forward pass (7,744)

**Forward pass** (`forward(x, training=False)`):
1. Input standardisation: `x_std = (x - mean) / std`
2. Input noise injection (training only): `x += N(0, 0.02)`
3. Three hidden layers: `h = tanh(x @ W + b)`, with inverted dropout (training only)
4. Linear output layer: `y = h @ W_out + b_out`

**Prediction** (`predict(x)`):
1. Forward pass (inference mode)
2. De-standardise output: `y_original = y_std * target_std + target_mean`

**Backward pass** (`backward(x, targets, training=True)`):
1. Forward pass with activation caching
2. MSE loss: `L = mean((y - targets)^2)`
3. Backpropagation through all layers with tanh derivative `(1 - tanh^2(z))`
4. Returns loss value and per-layer gradients `[(dW, db), ...]`

**Serialisation**:
- `save(path)` — Saves all weights, biases, standardisation parameters, and gate threshold to a `.npz` file
- `load(path)` — Restores all parameters from a `.npz` file

#### `AdamOptimizer` class

Full Adam optimiser implementation with:
- Bias-corrected first and second moment estimates
- Per-epoch learning rate scheduling via `set_lr(lr)`
- Global gradient-norm clipping (default: 5.0)
- L2 weight decay (default: 1e-5)

### Training Pipeline (`dage/training.py`)

#### `generate_trajectories(n, sim_cfg, ctrl_cfg, max_speed, seed)`

Generates training/validation trajectories by simulating the PID baseline controller.

**Per-trajectory randomisation** (Section V-B):
- `K_phi` scaled by U(0.80, 1.20)
- `A_GE` scaled by U(0.85, 1.15)
- `Jx` scaled by U(0.90, 1.10)
- Platform speed: `vp = U(0, max_speed) * U(0.90, 1.10)`
- Initial lateral offset: `y0 ~ N(0, 0.5 m)`
- Initial roll angle: `phi0 ~ N(0, 0.03 rad)`

**Initial conditions**: The vehicle starts stationary in the inertial frame at altitude z0=4.0m, so `vy_rel = -vp` (the platform is already moving).

**Returns**: List of dictionaries containing full state/measurement/control/target trajectories.

#### `build_dataset(trajectories, window=4)`

Converts trajectories into windowed input/target arrays:
- **Input**: 4 consecutive timesteps of `[phi, p, z, vz, u_phi, u_z]` flattened to 24 dimensions
- **Target**: `[tau_DAGE, a_GE]` at the current timestep

#### `train_network(...)`

The complete training pipeline:
1. Generate 460 trajectories (400 train + 60 validation)
2. Build windowed datasets (~476,000 train, ~71,000 val samples)
3. Subsample training set to 200,000 points
4. Compute input/output standardisation statistics
5. Train with Adam: LR=8e-4, decay 0.94×/epoch, batch size 256, dropout 5%, input noise 2%
6. Early stopping with patience 6 on validation MSE
7. Calibrate gate threshold: d0 = 99th percentile of Chebyshev distances on validation set
8. Save model and training curves

### Evaluation Engine (`dage/evaluation.py`)

#### `run_single_trial(...)`

Runs one complete landing trial from initial altitude to touchdown.

**Key features**:
- **Touchdown detection**: Monitors `z` crossing zero; records interpolated state at ground contact
- **Simulation termination**: Breaks immediately at touchdown (no wasted computation)
- **Per-trial randomisation**: Same scheme as training, plus optional mismatch scaling
- **Metrics at touchdown**: RMS phi (final approach), peak phi, |vy_rel|, |vz|
- **Envelope classification**: Checks all three criteria at the touchdown state

#### `evaluate_condition(sim_cfg, ctrl_cfg, eval_cfg, vp, controller_type, ...)`

Runs N Monte Carlo trials for one (speed, controller) pair and aggregates results.

**Returns**: `ConditionResult` with:
- Per-trial metrics (rms_phi, peak_phi, delta_vy, abs_vz, envelope_success)
- Aggregate properties (means, success rate, Wilson score CIs)
- Optional trajectory storage (first trial at each speed, for plotting)

#### `run_full_evaluation(...)`

Runs the complete evaluation matrix: all platform speeds × all controllers.

**Default**: 5 speeds × 5 controllers × 500 trials = 12,500 simulations.

#### `run_gate_ablation(...)`

Sweeps gate parameters at a single challenging condition (vp=6.0 m/s, OOD).

**Grid**: 4 kappa values × 3 d0_scale values + ungated baseline + PID baseline = 14 conditions × 300 trials = 4,200 simulations.

### Statistics (`dage/statistics.py`)

#### `wilson_score_interval(successes, trials, z=1.96)`

Computes the Wilson score 95% confidence interval for a binomial proportion. Unlike the normal approximation, Wilson score intervals are well-behaved near 0% and 100% and never produce negative bounds.

#### `paired_bootstrap_ci(a, b, n_bootstrap=20000, alpha=0.05, rng=None)`

Paired bootstrap confidence interval for `mean(a) - mean(b)`. Used for comparing controllers on matched trials (same random seeds).

**Returns**: `(mean_diff, ci_lo, ci_hi, p_value)`

#### `mean_ci(values, alpha=0.05)`

Mean with 95% confidence interval using the normal approximation (for continuous metrics like RMS phi).

### Visualization (`dage/visualization.py`)

Generates publication-quality figures using Matplotlib with serif fonts, proper axis labels, and 300 DPI output.

**Colour scheme**:
| Controller | Colour | Line style |
|---|---|---|
| PD | Grey (#999999) | Dotted |
| PID | Blue (#2196F3) | Solid |
| PID+DOB | Orange (#FF9800) | Dash-dot |
| Res-NG | Green (#4CAF50) | Dashed |
| Res-G | Pink (#E91E63) | Solid |

#### Figures generated:

1. **Training curves** (`fig3_training_curves.png`) — Train/validation MSE vs epoch, showing convergence and early stopping
2. **Descent profile** (`fig4_descent_profile.png`) — Altitude vs time for PD, PID, and Res-G at vp=3.0 m/s
3. **Roll error** (`fig5_roll_error.png`) — |phi| during final approach for the same controllers
4. **Envelope comparison** (`envelope_comparison.png`) — Grouped bar chart with Wilson score error bars across all speeds, OOD conditions marked
5. **RMS phi heatmap** (`rms_phi_heatmap.png`) — Colour-coded matrix of RMS roll error (controller × speed)

#### `format_results_table(results, title="TABLE III")`

Formats evaluation results as an ASCII text table matching the paper's Table III format, with per-row Wilson score confidence intervals.

### Configuration (`dage/config.py`)

All parameters are defined as Python dataclasses with default values matching the paper's Table I.

#### `SimConfig` — Physical/simulation parameters

| Parameter | Symbol | Default | Description |
|---|---|---|---|
| `dt` | dt | 0.01 s | Integration timestep (100 Hz) |
| `horizon` | T | 12.0 s | Maximum simulation time |
| `z0` | z_0 | 4.0 m | Initial altitude above platform |
| `v_des` | v_des | 0.42 m/s | Commanded descent rate |
| `mass` | m | 1.5 kg | Vehicle mass |
| `Jx` | J_x | 0.020 kg-m^2 | Roll moment of inertia |
| `A_GE` | A_GE | 1.8 m/s^2 | Ground-effect amplitude |
| `R_z` | R_z | 0.55 m | GE altitude scale |
| `K_phi` | K_phi | 0.12 | DAGE torque gain |
| `L` | L | 0.35 m | DAGE altitude scale |
| `lam` | lambda | 0.60 | Platform slip fraction |
| `decay_exp` | n | 2.0 | Inverse-polynomial exponent |
| `sigma_z` | — | 0.010 m | Altitude sensor noise std |
| `sigma_vz` | — | 0.030 m/s | Vertical velocity noise std |
| `sigma_phi` | — | 0.004 rad | Roll angle noise std |
| `sigma_p` | — | 0.020 rad/s | Roll rate noise std |
| `sigma_y` | — | 0.010 m | Lateral position noise std |
| `sigma_vy` | — | 0.030 m/s | Lateral velocity noise std |
| `tau_noise_std` | — | 0.005 | Process noise (torque) std |

#### `ControlConfig` — Controller gains

| Parameter | Default | Description |
|---|---|---|
| `z_gains.Kp` | 2.2 | Vertical proportional gain |
| `z_gains.Kd` | 2.6 | Vertical derivative gain |
| `z_gains.Ki` | 1.6 | Vertical integral gain |
| `phi_gains.Kp` | 60.0 | Roll proportional gain |
| `phi_gains.Kd` | 11.0 | Roll derivative gain |
| `phi_gains.Ki` | 30.0 | Roll integral gain |
| `lat_Kp` | 0.40 | Lateral position gain |
| `lat_Kd` | 0.30 | Lateral velocity gain |
| `dob_tau` | 1.0 s | DOB time constant |

#### `NetworkConfig` — MLP architecture

| Parameter | Default | Description |
|---|---|---|
| `window` | 4 | History window (timesteps) |
| `features_per_step` | 6 | Features per timestep |
| `hidden_sizes` | [64, 64, 32] | Hidden layer widths |
| `activation` | "tanh" | Activation function |
| `output_size` | 2 | Output dimensions |
| `dropout` | 0.05 | Dropout rate (training) |
| `input_noise_std` | 0.02 | Input noise (training) |

#### `TrainConfig` — Training hyperparameters

| Parameter | Default | Description |
|---|---|---|
| `n_trajectories` | 400 | Training trajectories |
| `n_val_trajectories` | 60 | Validation trajectories |
| `n_train_samples` | 200,000 | Subsampled training points |
| `lr` | 8e-4 | Initial learning rate |
| `lr_decay` | 0.94 | Per-epoch LR multiplier |
| `weight_decay` | 1e-5 | L2 regularisation |
| `batch_size` | 256 | Mini-batch size |
| `max_epochs` | 200 | Maximum training epochs |
| `patience` | 6 | Early stopping patience |
| `grad_clip` | 5.0 | Gradient norm clip |
| `seed_data` | 42 | Data generation seed |
| `seed_net` | 1 | Network init seed |
| `max_train_speed` | 4.0 m/s | Max platform speed in training |

#### `GateConfig` — Distance gate

| Parameter | Default | Description |
|---|---|---|
| `d0_percentile` | 0.99 | Calibration percentile |
| `kappa` | 1.0 | Decay rate |
| `d0_scale` | 1.0 | Scale factor on calibrated d0 |

#### `EvalConfig` — Evaluation settings

| Parameter | Default | Description |
|---|---|---|
| `n_trials` | 500 | Trials per condition |
| `platform_speeds` | [0, 1.5, 3, 5, 6] | Platform speeds (m/s) |
| `phi_max` | 0.10 rad | Roll envelope limit |
| `vz_max` | 0.75 m/s | Impact speed limit |
| `dvy_max` | 0.75 m/s | Lateral velocity limit |

#### `MismatchConfig` — Mismatch study parameters

| Parameter | Default | Description |
|---|---|---|
| `K_phi_scale` | 1.40 | ×1.40 on K_phi |
| `A_GE_scale` | 1.35 | ×1.35 on A_GE |
| `L_scale` | 1.30 | ×1.30 on L |
| `R_z_scale` | 1.40 | ×1.40 on R_z |
| `decay_exp` | 1.6 | Changed from 2.0 |
| `lam` | 1.00 | Changed from 0.60 |

#### `ProjectConfig` — Top-level aggregation

Aggregates all sub-configs. Supports JSON serialisation:
```python
cfg = ProjectConfig()
cfg.save("config.json")       # Save
cfg = ProjectConfig.load("config.json")  # Load
```

---

## Reproducing Paper Results

### Table III — Main Evaluation

The following results are from 500 randomised Monte Carlo trials per condition:

| vp (m/s) | PD | PID | PID+DOB | Res-NG | Res-G |
|---|---|---|---|---|---|
| 0.0 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| 1.5 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| 3.0 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| 5.0 (OOD) | 41.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| 6.0 (OOD) | 9.8% | 89.8% | 100.0% | 100.0% | 100.0% |

Impact speeds: PD = 0.246 m/s (paper: 0.246), PID = 0.335 m/s (paper: 0.335).

### Key trends matching the paper:

1. **PD degrades rapidly** at high platform speeds (roll violations dominate)
2. **PID provides significant improvement** over PD through integral action
3. **PID+DOB further improves** by actively estimating the DAGE torque
4. **Res-NG and Res-G achieve 100%** success rate at all speeds, including OOD
5. **The gate (Res-G)** provides safety assurance with minimal performance cost

### Seed reproducibility

All random seeds are fixed:
- Data generation: seed 42
- Network initialisation: seed 1
- Evaluation: seed 100

The full configuration is saved to `results/config.json` after each pipeline run.

---

## Testing

Run the full test suite:

```bash
python -m pytest tests/ -v
```

### Test coverage (47 tests):

**`test_dynamics.py`** (12 tests):
- Ground-effect scaling, decay, and amplitude verification
- DAGE torque: zero at rest, nonzero with motion, K_phi scaling, altitude decay
- Simulator: state shape, free-fall descent, GE deceleration, sensor noise, RK4 accuracy

**`test_network.py`** (9 tests):
- Parameter count verification (7,906)
- MAC count verification (7,744)
- Forward pass shape and determinism
- Single-sample prediction
- Backward pass gradient shapes
- Save/load roundtrip fidelity
- Flat parameter get/set roundtrip
- Input size consistency

**`test_controllers.py`** (8 tests):
- PD vs PID integral accumulation
- Lateral-to-roll coupling
- Unclamped descent reference
- DOB disturbance estimation
- Residual controller output shape
- Gate suppression of OOD inputs
- Ungated sigma always equals 1.0

**`test_statistics.py`** (7 tests):
- Wilson score: edge cases (0%, 100%), half-and-half, ordering
- Mean CI: known distribution, narrow CI with large N
- Paired bootstrap: significant difference, null difference

**`test_integration.py`** (5 tests):
- PD impact speed matches paper (0.246 ± 0.01)
- PID impact speed matches paper (0.335 ± 0.01)
- Controller hierarchy at vp=6.0: PD < PID <= PID+DOB
- Training pipeline end-to-end
- Touchdown detection

---

## Project Structure

```
DAGE-Bench/
├── dage/                        # Core package
│   ├── __init__.py              # Package version (1.0.0)
│   ├── config.py                # All configuration dataclasses
│   ├── dynamics.py              # Physics engine: DAGE model + RK4 simulator
│   ├── controllers.py           # PD / PID / PID+DOB / Residual controllers
│   ├── network.py               # Pure-NumPy MLP + Adam optimiser
│   ├── training.py              # Data generation + training loop + gate calibration
│   ├── evaluation.py            # Monte Carlo evaluation engine
│   ├── statistics.py            # Wilson score intervals, paired bootstrap
│   ├── visualization.py         # Publication-quality Matplotlib figures
│   └── cli.py                   # Command-line interface (argparse)
├── tests/                       # Test suite (47 tests)
│   ├── test_dynamics.py         # Physics model tests
│   ├── test_network.py          # Network architecture tests
│   ├── test_controllers.py      # Controller behaviour tests
│   ├── test_statistics.py       # Statistical utility tests
│   └── test_integration.py      # End-to-end integration tests
├── results/                     # Output directory (generated)
│   ├── residual_model.npz       # Trained network weights
│   ├── training_curves.csv      # Training history
│   ├── evaluation_results.csv   # Main evaluation data
│   ├── table_iii.txt            # Formatted Table III
│   ├── config.json              # Full reproducibility config
│   ├── dage.log                 # Run log
│   ├── figures/                 # Publication figures
│   │   ├── fig3_training_curves.png
│   │   ├── fig4_descent_profile.png
│   │   ├── fig5_roll_error.png
│   │   ├── envelope_comparison.png
│   │   └── rms_phi_heatmap.png
│   ├── mismatch/                # Table IV results
│   └── gate_ablation/           # Table V results
├── main.py                      # Entry point
├── pyproject.toml               # Package configuration
├── .gitignore                   # Git ignore rules
└── README.md                    # This file
```

### Line counts

| Module | Lines | Description |
|---|---|---|
| `config.py` | 179 | Configuration dataclasses |
| `dynamics.py` | 175 | Physics engine |
| `controllers.py` | 198 | All controllers |
| `network.py` | 314 | MLP + Adam optimiser |
| `training.py` | 306 | Training pipeline |
| `evaluation.py` | 439 | Monte Carlo engine |
| `visualization.py` | 323 | Figure generation |
| `statistics.py` | 68 | Statistical utilities |
| `cli.py` | 291 | CLI interface |
| **Tests** | **479** | 47 test cases |
| **Total** | **2,783** | Pure Python, no frameworks |

---

## License

This software accompanies an academic research paper. Please cite the paper if you use this code in your research.
