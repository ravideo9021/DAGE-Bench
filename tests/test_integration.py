"""Integration tests: end-to-end pipeline verification."""

import numpy as np
import pytest
from pathlib import Path

from dage.config import SimConfig, ControlConfig, EvalConfig, GateConfig, TrainConfig, NetworkConfig
from dage.dynamics import Simulator
from dage.controllers import NominalController, ControllerState
from dage.evaluation import run_single_trial, evaluate_condition
from dage.training import generate_trajectories, build_dataset, train_network
from dage.network import ResidualMLP


class TestImpactSpeeds:
    """Verify impact speeds match the paper's Table III."""

    def _run_deterministic(self, use_integral: bool, vp: float = 0.0):
        sim_cfg = SimConfig()
        ctrl_cfg = ControlConfig()
        sim = Simulator(sim_cfg, rng=np.random.default_rng(42))
        ctrl = NominalController(sim_cfg, ctrl_cfg, use_integral=use_integral)
        cs = ControllerState()
        state = np.array([sim_cfg.z0, 0.0, 0.0, -vp, 0.0, 0.0])
        for step in range(int(12 / 0.01)):
            t = step * 0.01
            u_z, u_phi, _ = ctrl.compute(state, t, cs)
            state = sim.step_rk4(state, u_z, u_phi, vp,
                                 sim_cfg.K_phi, sim_cfg.A_GE, sim_cfg.Jx)
            if state[0] <= 0:
                return abs(state[1])
        return None

    def test_pd_impact_speed(self):
        vz = self._run_deterministic(use_integral=False)
        assert vz is not None
        assert abs(vz - 0.246) < 0.01

    def test_pid_impact_speed(self):
        vz = self._run_deterministic(use_integral=True)
        assert vz is not None
        assert abs(vz - 0.335) < 0.01


class TestControllerHierarchy:
    """PD < PID < PID+DOB at high platform speed."""

    def test_hierarchy_at_vp6(self):
        sim_cfg = SimConfig()
        ctrl_cfg = ControlConfig()
        eval_cfg = EvalConfig(n_trials=50, platform_speeds=[6.0])

        results = {}
        for name in ["PD", "PID", "PID+DOB"]:
            r = evaluate_condition(sim_cfg, ctrl_cfg, eval_cfg, 6.0, name)
            results[name] = r.envelope_success_rate

        assert results["PD"] < results["PID"]
        assert results["PID"] <= results["PID+DOB"]


class TestTrainingPipeline:
    def test_trajectory_generation(self):
        trajs = generate_trajectories(5, SimConfig(), ControlConfig(), 4.0, seed=42)
        assert len(trajs) == 5
        assert trajs[0]["states"].shape == (1200, 6)
        assert trajs[0]["targets"].shape == (1200, 2)

    def test_dataset_building(self):
        trajs = generate_trajectories(3, SimConfig(), ControlConfig(), 4.0, seed=42)
        X, Y = build_dataset(trajs, window=4)
        assert X.shape[1] == 24
        assert Y.shape[1] == 2
        assert X.shape[0] == Y.shape[0]
        expected_per_traj = 1200 - 3
        assert X.shape[0] == 3 * expected_per_traj

    def test_mini_training(self, tmp_path):
        train_cfg = TrainConfig(
            n_trajectories=5, n_val_trajectories=2,
            n_train_samples=500, max_epochs=3, patience=2,
        )
        net = train_network(
            train_cfg, NetworkConfig(), SimConfig(), ControlConfig(),
            GateConfig(), tmp_path,
        )
        assert net.n_params == 7906
        assert net.gate_d0 is not None
        assert (tmp_path / "residual_model.npz").exists()
        assert (tmp_path / "training_curves.csv").exists()


class TestTouchdownDetection:
    def test_trial_detects_touchdown(self):
        sim_cfg = SimConfig()
        result = run_single_trial(
            sim_cfg, ControlConfig(), EvalConfig(n_trials=1),
            vp_nominal=0.0, controller_type="PID",
            network=None, gate_cfg=None, trial_seed=42,
        )
        assert result.abs_vz > 0.1
        assert result.abs_vz < 1.0
