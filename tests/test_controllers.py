"""Tests for the controller implementations."""

import numpy as np
import pytest

from dage.config import SimConfig, ControlConfig, GateConfig, NetworkConfig
from dage.controllers import NominalController, ResidualController, ControllerState
from dage.network import ResidualMLP


@pytest.fixture
def sim_cfg():
    return SimConfig()

@pytest.fixture
def ctrl_cfg():
    return ControlConfig()


class TestNominalController:
    def test_pd_no_integral(self, sim_cfg, ctrl_cfg):
        ctrl = NominalController(sim_cfg, ctrl_cfg, use_integral=False)
        cs = ControllerState()
        measured = np.array([4.0, 0.0, 0.0, 0.0, 0.0, 0.0])
        u_z, u_phi, phi_des = ctrl.compute(measured, 0.0, cs)
        assert cs.z_integral == 0.0
        assert cs.phi_integral == 0.0

    def test_pid_accumulates_integral(self, sim_cfg, ctrl_cfg):
        ctrl = NominalController(sim_cfg, ctrl_cfg, use_integral=True)
        cs = ControllerState()
        measured = np.array([4.0, 0.0, 0.0, 0.0, 0.0, 0.0])
        ctrl.compute(measured, 0.0, cs)
        ctrl.compute(measured, 0.01, cs)
        ctrl.compute(measured, 0.02, cs)
        assert cs.z_integral != 0.0

    def test_lateral_couples_to_roll(self, sim_cfg, ctrl_cfg):
        ctrl = NominalController(sim_cfg, ctrl_cfg, use_integral=True)
        cs = ControllerState()
        measured = np.array([2.0, -0.42, 1.0, 0.5, 0.0, 0.0])
        _, _, phi_des = ctrl.compute(measured, 5.0, cs)
        assert phi_des != 0.0

    def test_descent_reference_unclamped(self, sim_cfg, ctrl_cfg):
        ctrl = NominalController(sim_cfg, ctrl_cfg, use_integral=False)
        cs = ControllerState()
        measured = np.array([0.0, -0.4, 0.0, 0.0, 0.0, 0.0])
        u_z, _, _ = ctrl.compute(measured, 12.0, cs)
        assert u_z < -1.0

    def test_dob_reduces_roll_disturbance(self, sim_cfg, ctrl_cfg):
        ctrl_pid = NominalController(sim_cfg, ctrl_cfg, use_integral=True, use_dob=False)
        ctrl_dob = NominalController(sim_cfg, ctrl_cfg, use_integral=True, use_dob=True)

        cs_pid = ControllerState()
        cs_dob = ControllerState()
        measured = np.array([1.0, -0.42, 0.0, 0.0, 0.05, 0.3])

        for t_step in range(200):
            t = t_step * 0.01
            ctrl_pid.compute(measured, t, cs_pid)
            ctrl_dob.compute(measured, t, cs_dob)

        assert cs_dob.dob_estimate != 0.0


class TestResidualController:
    def test_residual_output_shape(self, sim_cfg, ctrl_cfg):
        net = ResidualMLP(NetworkConfig(), seed=0)
        net.input_mean = np.zeros(24)
        net.input_std = np.ones(24)
        net.target_mean = np.zeros(2)
        net.target_std = np.ones(2)
        net.gate_d0 = 5.0

        nominal = NominalController(sim_cfg, ctrl_cfg, use_integral=True)
        res_ctrl = ResidualController(nominal, net, GateConfig(), use_gate=True)
        cs = ControllerState()

        measured = np.array([2.0, -0.42, 0.0, 0.0, 0.0, 0.0])
        for i in range(5):
            result = res_ctrl.compute(measured, i * 0.01, cs)
            assert len(result) == 5

    def test_gate_suppresses_ood(self, sim_cfg, ctrl_cfg):
        net = ResidualMLP(NetworkConfig(), seed=0)
        net.input_mean = np.zeros(24)
        net.input_std = np.ones(24)
        net.target_mean = np.zeros(2)
        net.target_std = np.ones(2)
        net.gate_d0 = 0.1

        nominal = NominalController(sim_cfg, ctrl_cfg, use_integral=True)
        res_ctrl = ResidualController(nominal, net, GateConfig(kappa=0.5), use_gate=True)
        cs = ControllerState()

        ood_measured = np.array([2.0, -0.42, 0.0, 0.0, 0.0, 0.0]) + 100.0
        for i in range(5):
            _, _, _, sigma, _ = res_ctrl.compute(ood_measured, i * 0.01, cs)

        assert sigma < 0.01

    def test_ungated_always_sigma_one(self, sim_cfg, ctrl_cfg):
        net = ResidualMLP(NetworkConfig(), seed=0)
        net.input_mean = np.zeros(24)
        net.input_std = np.ones(24)
        net.target_mean = np.zeros(2)
        net.target_std = np.ones(2)
        net.gate_d0 = 0.1

        nominal = NominalController(sim_cfg, ctrl_cfg, use_integral=True)
        res_ctrl = ResidualController(nominal, net, GateConfig(), use_gate=False)
        cs = ControllerState()

        measured = np.array([2.0, -0.42, 0.0, 0.0, 0.0, 0.0]) + 100.0
        for i in range(5):
            _, _, _, sigma, _ = res_ctrl.compute(measured, i * 0.01, cs)

        assert sigma == 1.0
