"""Monte Carlo evaluation engine (Section V-D, VII)."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from .config import (
    SimConfig, ControlConfig, EvalConfig, GateConfig,
    MismatchConfig, NetworkConfig,
)
from .dynamics import Simulator
from .controllers import NominalController, ResidualController, ControllerState
from .network import ResidualMLP
from .statistics import wilson_score_interval, mean_ci, paired_bootstrap_ci

logger = logging.getLogger(__name__)


@dataclass
class TrialResult:
    """Per-trial metrics."""
    rms_phi: float = 0.0
    peak_phi: float = 0.0
    delta_vy: float = 0.0
    abs_vz: float = 0.0
    envelope_success: bool = False
    roll_violation: bool = False
    mean_sigma: float = 1.0
    # Full trajectory data for visualization
    trajectory: np.ndarray | None = None
    times: np.ndarray | None = None


@dataclass
class ConditionResult:
    """Aggregated results for one controller at one platform speed."""
    controller_name: str
    vp: float
    n_trials: int
    trials: list[TrialResult] = field(default_factory=list)

    @property
    def rms_phi_mean(self) -> float:
        return float(np.mean([t.rms_phi for t in self.trials]))

    @property
    def peak_phi_mean(self) -> float:
        return float(np.mean([t.peak_phi for t in self.trials]))

    @property
    def delta_vy_mean(self) -> float:
        return float(np.mean([t.delta_vy for t in self.trials]))

    @property
    def abs_vz_mean(self) -> float:
        return float(np.mean([t.abs_vz for t in self.trials]))

    @property
    def envelope_success_rate(self) -> float:
        return sum(1 for t in self.trials if t.envelope_success) / len(self.trials)

    @property
    def roll_violation_rate(self) -> float:
        return sum(1 for t in self.trials if t.roll_violation) / len(self.trials)

    @property
    def mean_sigma(self) -> float:
        return float(np.mean([t.mean_sigma for t in self.trials]))

    def envelope_ci(self) -> tuple[float, float]:
        n_success = sum(1 for t in self.trials if t.envelope_success)
        return wilson_score_interval(n_success, len(self.trials))

    def summary_row(self) -> dict:
        n = len(self.trials)
        env_n = sum(1 for t in self.trials if t.envelope_success)
        env_lo, env_hi = wilson_score_interval(env_n, n)
        return {
            "vp": self.vp,
            "controller": self.controller_name,
            "rms_phi": self.rms_phi_mean,
            "peak_phi": self.peak_phi_mean,
            "delta_vy": self.delta_vy_mean,
            "abs_vz": self.abs_vz_mean,
            "envelope_pct": self.envelope_success_rate * 100,
            "envelope_ci_lo": env_lo * 100,
            "envelope_ci_hi": env_hi * 100,
            "roll_viol_pct": self.roll_violation_rate * 100,
            "mean_sigma": self.mean_sigma if "Res" in self.controller_name else None,
        }


def run_single_trial(
    sim_cfg: SimConfig,
    ctrl_cfg: ControlConfig,
    eval_cfg: EvalConfig,
    vp_nominal: float,
    controller_type: str,
    network: ResidualMLP | None,
    gate_cfg: GateConfig | None,
    trial_seed: int,
    mismatch: MismatchConfig | None = None,
    store_trajectory: bool = False,
) -> TrialResult:
    """Run a single trial and compute metrics."""
    rng = np.random.default_rng(trial_seed)

    # Per-trial randomization (Section V-B)
    K_phi_scale = rng.uniform(*eval_cfg.K_phi_range)
    A_GE_scale = rng.uniform(*eval_cfg.A_GE_range)
    Jx_scale = rng.uniform(*eval_cfg.Jx_range)
    vp_scale = rng.uniform(*eval_cfg.vp_range)

    vp = vp_nominal * vp_scale
    K_phi = sim_cfg.K_phi * K_phi_scale
    A_GE = sim_cfg.A_GE * A_GE_scale
    Jx = sim_cfg.Jx * Jx_scale

    y0 = rng.normal(0, eval_cfg.y0_std)
    phi0 = rng.normal(0, eval_cfg.phi0_std)

    # Apply mismatch if specified
    sim_L = sim_cfg.L
    sim_lam = sim_cfg.lam
    sim_Rz = sim_cfg.R_z
    sim_decay = sim_cfg.decay_exp
    if mismatch is not None:
        K_phi *= mismatch.K_phi_scale
        A_GE *= mismatch.A_GE_scale
        sim_L *= mismatch.L_scale
        sim_Rz *= mismatch.R_z_scale
        sim_decay = mismatch.decay_exp
        sim_lam = mismatch.lam

    sim = Simulator(sim_cfg, rng=np.random.default_rng(rng.integers(0, 2**32)))

    # Determine controller
    use_integral = controller_type != "PD"
    use_dob = controller_type == "PID+DOB"
    nominal = NominalController(sim_cfg, ctrl_cfg, use_integral=use_integral, use_dob=use_dob)

    use_residual = controller_type in ("Res-NG", "Res-G")
    res_ctrl = None
    if use_residual and network is not None:
        use_gate = controller_type == "Res-G"
        res_ctrl = ResidualController(
            nominal, network, gate_cfg or GateConfig(), use_gate=use_gate,
        )

    ctrl_state = ControllerState()
    # Vehicle starts stationary in inertial frame → vy_rel = -vp
    state = np.array([sim_cfg.z0, 0.0, y0, -vp, phi0, 0.0])
    n_steps = int(sim_cfg.horizon / sim_cfg.dt)

    # Recording arrays
    phi_final_approach = []
    sigmas = []
    trajectory = np.zeros((n_steps, 8)) if store_trajectory else None
    touchdown_state = None  # State at first ground contact

    for step in range(n_steps):
        t = step * sim_cfg.dt
        measured = sim.add_sensor_noise(state)

        if res_ctrl is not None:
            u_z, u_phi, phi_des, sigma, _ = res_ctrl.compute(
                measured, t, ctrl_state, vp_for_ref=0.0,
            )
            sigmas.append(sigma)
        else:
            u_z, u_phi, phi_des = nominal.compute(
                measured, t, ctrl_state, vp_for_ref=0.0,
            )

        if store_trajectory:
            trajectory[step] = [t, state[0], state[1], state[2], state[3],
                                state[4], state[5], u_phi]

        # Final approach metrics (z < 1.0 m)
        if state[0] < eval_cfg.final_approach_z:
            phi_final_approach.append(abs(state[4]))

        prev_z = state[0]
        tau_noise = sim.rng.normal(0, sim_cfg.tau_noise_std)
        state = sim.step_rk4(
            state, u_z, u_phi, vp, K_phi, A_GE, Jx,
            tau_noise=tau_noise,
            L=sim_L, lam=sim_lam, R_z=sim_Rz, decay_exp=sim_decay,
        )

        # Detect touchdown: z crosses zero
        if touchdown_state is None and state[0] <= 0.0:
            if prev_z > 0 and state[0] <= 0:
                touchdown_state = state.copy()
                touchdown_state[0] = 0.0
            if store_trajectory:
                trajectory = trajectory[:step + 1]
            break

        state[0] = max(state[0], 0.0)

    # Use touchdown state for metrics; fallback to final state
    contact = touchdown_state if touchdown_state is not None else state

    # Compute metrics
    if phi_final_approach:
        rms_phi = float(np.sqrt(np.mean(np.array(phi_final_approach) ** 2)))
        peak_phi = float(np.max(phi_final_approach))
    else:
        rms_phi = float(abs(contact[4]))
        peak_phi = rms_phi

    # Terminal metrics at touchdown: state[3] is vy_rel = vy_inertial - vp
    delta_vy = float(abs(contact[3]))  # |vy_rel| = |vy_inertial - vp|
    abs_vz = float(abs(contact[1]))

    # Envelope success
    envelope_success = (
        peak_phi <= eval_cfg.phi_max
        and abs_vz <= eval_cfg.vz_max
        and delta_vy <= eval_cfg.dvy_max
    )
    roll_violation = peak_phi > eval_cfg.phi_max
    mean_sigma = float(np.mean(sigmas)) if sigmas else 1.0

    return TrialResult(
        rms_phi=rms_phi,
        peak_phi=peak_phi,
        delta_vy=delta_vy,
        abs_vz=abs_vz,
        envelope_success=envelope_success,
        roll_violation=roll_violation,
        mean_sigma=mean_sigma,
        trajectory=trajectory,
    )


def evaluate_condition(
    sim_cfg: SimConfig,
    ctrl_cfg: ControlConfig,
    eval_cfg: EvalConfig,
    vp: float,
    controller_type: str,
    network: ResidualMLP | None = None,
    gate_cfg: GateConfig | None = None,
    mismatch: MismatchConfig | None = None,
    store_trajectories: bool = False,
) -> ConditionResult:
    """Run Monte Carlo evaluation for one controller at one platform speed."""
    result = ConditionResult(
        controller_name=controller_type,
        vp=vp,
        n_trials=eval_cfg.n_trials,
    )

    for trial_idx in range(eval_cfg.n_trials):
        trial_seed = eval_cfg.seed + trial_idx
        store = store_trajectories and trial_idx == 0

        trial = run_single_trial(
            sim_cfg, ctrl_cfg, eval_cfg, vp, controller_type,
            network, gate_cfg, trial_seed, mismatch,
            store_trajectory=store,
        )
        result.trials.append(trial)

    return result


def run_full_evaluation(
    sim_cfg: SimConfig,
    ctrl_cfg: ControlConfig,
    eval_cfg: EvalConfig,
    gate_cfg: GateConfig,
    network: ResidualMLP | None = None,
    mismatch: MismatchConfig | None = None,
    output_dir: Path | None = None,
    controllers: list[str] | None = None,
) -> dict[tuple[float, str], ConditionResult]:
    """Run the full evaluation matrix (Table III).

    Returns dict mapping (vp, controller_name) → ConditionResult.
    """
    if controllers is None:
        controllers = ["PD", "PID", "PID+DOB", "Res-NG", "Res-G"]

    results: dict[tuple[float, str], ConditionResult] = {}
    total = len(eval_cfg.platform_speeds) * len(controllers)
    done = 0

    for vp in eval_cfg.platform_speeds:
        for ctrl_name in controllers:
            t0 = time.time()
            needs_net = ctrl_name in ("Res-NG", "Res-G")
            if needs_net and network is None:
                logger.warning("Skipping %s (no network loaded)", ctrl_name)
                done += 1
                continue

            result = evaluate_condition(
                sim_cfg, ctrl_cfg, eval_cfg, vp, ctrl_name,
                network=network if needs_net else None,
                gate_cfg=gate_cfg,
                mismatch=mismatch,
                store_trajectories=(vp == 3.0),
            )
            results[(vp, ctrl_name)] = result
            done += 1

            row = result.summary_row()
            logger.info(
                "[%2d/%2d] vp=%.1f %-8s | env=%.1f%% [%.1f,%.1f] | "
                "rms_phi=%.4f | peak_phi=%.4f | dvy=%.3f | vz=%.3f | "
                "sigma=%s (%.1fs)",
                done, total, vp, ctrl_name,
                row["envelope_pct"], row["envelope_ci_lo"], row["envelope_ci_hi"],
                row["rms_phi"], row["peak_phi"], row["delta_vy"], row["abs_vz"],
                f'{row["mean_sigma"]:.3f}' if row["mean_sigma"] is not None else "—",
                time.time() - t0,
            )

    if output_dir is not None:
        _save_results(results, output_dir)

    return results


def run_gate_ablation(
    sim_cfg: SimConfig,
    ctrl_cfg: ControlConfig,
    eval_cfg: EvalConfig,
    gate_cfg: GateConfig,
    network: ResidualMLP,
    vp: float = 6.0,
    n_trials: int = 300,
    output_dir: Path | None = None,
) -> list[dict]:
    """Gate ablation sweep (Table V)."""
    kappas = [0.4, 0.8, 1.2, 2.4]
    d0_scales = [0.6, 0.8, 1.0]

    eval_cfg_ablation = EvalConfig(
        n_trials=n_trials,
        platform_speeds=[vp],
        seed=eval_cfg.seed,
        phi_max=eval_cfg.phi_max,
        vz_max=eval_cfg.vz_max,
        dvy_max=eval_cfg.dvy_max,
        final_approach_z=eval_cfg.final_approach_z,
    )

    rows = []

    # Ungated baseline
    logger.info("Gate ablation: ungated (sigma=1)")
    result = evaluate_condition(
        sim_cfg, ctrl_cfg, eval_cfg_ablation, vp, "Res-NG",
        network=network, gate_cfg=gate_cfg,
    )
    rows.append({
        "kappa": None, "d0_scale": None,
        "mean_sigma": 1.0,
        "rms_phi": result.rms_phi_mean,
        "envelope_pct": result.envelope_success_rate * 100,
    })
    logger.info("  ungated | sigma=1.000 | rms_phi=%.4f | env=%.1f%%",
                result.rms_phi_mean, result.envelope_success_rate * 100)

    for kappa in kappas:
        for d0_scale in d0_scales:
            ablation_gate = GateConfig(
                d0_percentile=gate_cfg.d0_percentile,
                kappa=kappa,
                d0_scale=d0_scale,
            )
            result = evaluate_condition(
                sim_cfg, ctrl_cfg, eval_cfg_ablation, vp, "Res-G",
                network=network, gate_cfg=ablation_gate,
            )
            rows.append({
                "kappa": kappa, "d0_scale": d0_scale,
                "mean_sigma": result.mean_sigma,
                "rms_phi": result.rms_phi_mean,
                "envelope_pct": result.envelope_success_rate * 100,
            })
            logger.info(
                "  kappa=%.1f d0x%.1f | sigma=%.3f | rms_phi=%.4f | env=%.1f%%",
                kappa, d0_scale, result.mean_sigma,
                result.rms_phi_mean, result.envelope_success_rate * 100,
            )

    # PID baseline
    result = evaluate_condition(
        sim_cfg, ctrl_cfg, eval_cfg_ablation, vp, "PID",
    )
    rows.append({
        "kappa": "PID", "d0_scale": "PID",
        "mean_sigma": None,
        "rms_phi": result.rms_phi_mean,
        "envelope_pct": result.envelope_success_rate * 100,
    })

    if output_dir is not None:
        output_dir.mkdir(parents=True, exist_ok=True)
        import json
        (output_dir / "gate_ablation.json").write_text(
            json.dumps(rows, indent=2, default=str)
        )

    return rows


def _save_results(
    results: dict[tuple[float, str], ConditionResult],
    output_dir: Path,
) -> None:
    """Save evaluation results to CSV."""
    output_dir.mkdir(parents=True, exist_ok=True)

    rows = []
    for (vp, ctrl_name), result in sorted(results.items()):
        rows.append(result.summary_row())

    # Write CSV
    if rows:
        keys = rows[0].keys()
        lines = [",".join(str(k) for k in keys)]
        for row in rows:
            lines.append(",".join(
                f"{v:.6f}" if isinstance(v, float) else str(v) if v is not None else ""
                for v in row.values()
            ))
        (output_dir / "evaluation_results.csv").write_text("\n".join(lines))
        logger.info("Results saved to %s", output_dir / "evaluation_results.csv")
