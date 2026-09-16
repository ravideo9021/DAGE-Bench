"""Tests for the DAGE dynamics model."""

import numpy as np
import pytest

from dage.config import SimConfig
from dage.dynamics import Simulator, dage_torque, ground_effect_accel


class TestGroundEffect:
    def test_ge_at_ground(self):
        a = ground_effect_accel(0.01, A_GE=1.8, R_z=0.55)
        assert a > 1.5

    def test_ge_decays_with_altitude(self):
        a_low = ground_effect_accel(0.5, A_GE=1.8, R_z=0.55)
        a_high = ground_effect_accel(2.0, A_GE=1.8, R_z=0.55)
        assert a_low > a_high

    def test_ge_vanishes_at_high_altitude(self):
        a = ground_effect_accel(10.0, A_GE=1.8, R_z=0.55)
        assert a < 0.01

    def test_ge_scales_with_amplitude(self):
        a1 = ground_effect_accel(1.0, A_GE=1.0, R_z=0.55)
        a2 = ground_effect_accel(1.0, A_GE=2.0, R_z=0.55)
        assert abs(a2 - 2 * a1) < 1e-10


class TestDAGETorque:
    def test_zero_when_no_lateral_motion(self):
        tau = dage_torque(z=1.0, vy_inertial=0.0, vp=0.0, phi=0.0,
                          K_phi=0.12, L=0.35, lam=0.60)
        assert abs(tau) < 1e-10

    def test_nonzero_with_lateral_motion(self):
        tau = dage_torque(z=0.5, vy_inertial=3.0, vp=3.0, phi=0.0,
                          K_phi=0.12, L=0.35, lam=0.60)
        assert abs(tau) > 0.01

    def test_scales_with_K_phi(self):
        tau1 = dage_torque(z=0.5, vy_inertial=2.0, vp=1.0, phi=0.0,
                           K_phi=0.12, L=0.35, lam=0.60)
        tau2 = dage_torque(z=0.5, vy_inertial=2.0, vp=1.0, phi=0.0,
                           K_phi=0.24, L=0.35, lam=0.60)
        assert abs(tau2 - 2 * tau1) < 1e-10

    def test_decays_with_altitude(self):
        tau_low = abs(dage_torque(z=0.3, vy_inertial=3.0, vp=3.0, phi=0.0,
                                  K_phi=0.12, L=0.35, lam=0.60))
        tau_high = abs(dage_torque(z=3.0, vy_inertial=3.0, vp=3.0, phi=0.0,
                                   K_phi=0.12, L=0.35, lam=0.60))
        assert tau_low > tau_high

    def test_airspeed_and_platform_slip_terms(self):
        tau_stationary = dage_torque(z=0.5, vy_inertial=3.0, vp=0.0, phi=0.0,
                                     K_phi=0.12, L=0.35, lam=0.60)
        tau_moving = dage_torque(z=0.5, vy_inertial=3.0, vp=3.0, phi=0.0,
                                 K_phi=0.12, L=0.35, lam=0.60)
        assert abs(tau_stationary) != abs(tau_moving)


class TestSimulator:
    def test_state_shape(self):
        sim = Simulator(SimConfig(), rng=np.random.default_rng(0))
        state = np.array([4.0, 0.0, 0.0, 0.0, 0.0, 0.0])
        new_state = sim.step_rk4(state, 0.0, 0.0, 0.0,
                                 0.12, 1.8, 0.020)
        assert new_state.shape == (6,)

    def test_free_fall_descends(self):
        sim = Simulator(SimConfig(), rng=np.random.default_rng(0))
        state = np.array([4.0, 0.0, 0.0, 0.0, 0.0, 0.0])
        for _ in range(100):
            state = sim.step_rk4(state, -9.81, 0.0, 0.0,
                                 0.0, 0.0, 0.020)
        assert state[1] < -0.5

    def test_ge_slows_descent(self):
        cfg = SimConfig()
        sim = Simulator(cfg, rng=np.random.default_rng(0))
        state_ge = np.array([0.5, -0.5, 0.0, 0.0, 0.0, 0.0])
        state_no_ge = state_ge.copy()
        for _ in range(50):
            state_ge = sim.step_rk4(state_ge, -9.81, 0.0, 0.0,
                                    0.0, 1.8, 0.020)
            state_no_ge = sim.step_rk4(state_no_ge, -9.81, 0.0, 0.0,
                                       0.0, 0.0, 0.020)
        assert state_ge[1] > state_no_ge[1]

    def test_sensor_noise_changes_state(self):
        sim = Simulator(SimConfig(), rng=np.random.default_rng(42))
        state = np.array([2.0, -0.5, 0.1, 0.5, 0.01, 0.0])
        noisy = sim.add_sensor_noise(state)
        assert not np.allclose(state, noisy)

    def test_constant_velocity_with_zero_accel(self):
        """With u_z=0 and no GE, vertical velocity stays constant (dvz = u_z + a_ge)."""
        cfg = SimConfig()
        sim = Simulator(cfg, rng=np.random.default_rng(0))
        state = np.array([4.0, -0.42, 0.0, 0.0, 0.0, 0.0])
        for _ in range(100):
            state = sim.step_rk4(state, 0.0, 0.0, 0.0,
                                 0.0, 0.0, cfg.Jx)
        assert abs(state[1] - (-0.42)) < 0.01
