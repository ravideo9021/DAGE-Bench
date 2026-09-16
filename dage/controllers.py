"""Controllers: PD, PID, PID+DOB, and residual variants (Section IV, V-C)."""

from __future__ import annotations

import numpy as np
from dataclasses import dataclass, field

from .config import SimConfig, ControlConfig, GateConfig


@dataclass
class ControllerState:
    """Mutable integrator and observer state."""
    z_integral: float = 0.0
    phi_integral: float = 0.0
    dob_state: float = 0.0   # DOB internal state
    dob_estimate: float = 0.0


class NominalController:
    """Cascaded PID controller (Section IV-A, Eq 8).

    Structure:
    - Vertical PID: altitude + descent-rate tracking → u_z (acceleration cmd)
    - Lateral outer loop: position/velocity → desired roll angle
    - Roll PID: roll angle tracking → u_phi (torque cmd)
    """

    def __init__(
        self,
        sim_cfg: SimConfig,
        ctrl_cfg: ControlConfig,
        use_integral: bool = True,
        use_dob: bool = False,
    ):
        self.sim = sim_cfg
        self.ctrl = ctrl_cfg
        self.use_integral = use_integral
        self.use_dob = use_dob

    def compute(
        self,
        measured: np.ndarray,
        t: float,
        ctrl_state: ControllerState,
        vp_for_ref: float = 0.0,
    ) -> tuple[float, float, float]:
        """Compute control commands.

        Args:
            measured: Noisy state [z, vz, y, vy, phi, p]
            t: Current simulation time
            ctrl_state: Mutable integrator/DOB state
            vp_for_ref: Platform velocity for reference generation.
                The nominal controller tracks a descent profile centered on
                the platform. It observes relative y, vy but not vp directly.

        Returns:
            (u_z, u_phi, phi_des) — vertical accel cmd, roll torque cmd,
            and the desired roll angle (for logging).
        """
        z_m, vz_m, y_m, vy_m, phi_m, p_m = measured
        dt = self.sim.dt
        g = self.ctrl.z_gains
        gp = self.ctrl.phi_gains

        # --- Vertical channel ---
        # Reference descends linearly; may go negative to push through GE
        z_ref = self.sim.z0 - self.sim.v_des * t
        vz_ref = -self.sim.v_des

        ez = z_ref - z_m
        evz = vz_ref - vz_m

        if self.use_integral:
            ctrl_state.z_integral += ez * dt
            ctrl_state.z_integral = np.clip(ctrl_state.z_integral, -2.0, 2.0)

        u_z = g.Kp * ez + g.Kd * evz
        if self.use_integral:
            u_z += g.Ki * ctrl_state.z_integral

        # --- Lateral outer loop → roll setpoint ---
        # y_m and vy_m are measured relative to platform
        # Goal: drive y_rel → 0 and vy_rel → 0
        phi_des = -(self.ctrl.lat_Kp * y_m + self.ctrl.lat_Kd * vy_m)
        phi_des = np.clip(phi_des, -0.5, 0.5)  # Saturate for safety

        # --- Roll PID (Eq 8) ---
        e_phi = phi_des - phi_m
        e_p = -p_m  # Desired rate is 0 for setpoint tracking

        if self.use_integral:
            ctrl_state.phi_integral += e_phi * dt
            ctrl_state.phi_integral = np.clip(ctrl_state.phi_integral, -0.5, 0.5)

        u_phi = self.sim.Jx * (gp.Kp * e_phi + gp.Kd * e_p)
        if self.use_integral:
            u_phi += self.sim.Jx * gp.Ki * ctrl_state.phi_integral

        # DOB on roll channel (Section V-C): Luenberger observer
        # estimates DAGE torque disturbance without differentiating p
        if self.use_dob:
            l = 1.0 / self.ctrl.dob_tau
            Jx = self.sim.Jx
            z = ctrl_state.dob_state
            z += dt * (-l * z - l * l * Jx * p_m - l * u_phi)
            ctrl_state.dob_state = z
            ctrl_state.dob_estimate = z + l * Jx * p_m
            u_phi -= ctrl_state.dob_estimate

        return u_z, u_phi, phi_des


class ResidualController:
    """Gated residual correction (Eq 9–10, 12–13).

    Wraps a nominal controller and adds a learned residual prediction
    scaled by a state-distance gate.
    """

    def __init__(
        self,
        nominal: NominalController,
        network,  # dage.network.ResidualMLP
        gate_cfg: GateConfig,
        use_gate: bool = True,
    ):
        self.nominal = nominal
        self.network = network
        self.gate_cfg = gate_cfg
        self.use_gate = use_gate
        self.history: list[np.ndarray] = []

    def reset(self) -> None:
        self.history.clear()

    def compute(
        self,
        measured: np.ndarray,
        t: float,
        ctrl_state: ControllerState,
        vp_for_ref: float = 0.0,
    ) -> tuple[float, float, float, float, np.ndarray]:
        """Compute control with residual correction.

        Returns:
            (u_z_total, u_phi_total, phi_des, sigma, residual_pred)
        """
        u_z_nom, u_phi_nom, phi_des = self.nominal.compute(
            measured, t, ctrl_state, vp_for_ref
        )

        # Build feature vector: [phi, p, z, vz, u_phi, u_z]
        phi_m, p_m = measured[4], measured[5]
        z_m, vz_m = measured[0], measured[1]
        feature = np.array([phi_m, p_m, z_m, vz_m, u_phi_nom, u_z_nom])
        self.history.append(feature)

        W = self.network.cfg.window
        if len(self.history) < W:
            return u_z_nom, u_phi_nom, phi_des, 1.0, np.zeros(2)

        # Flatten window into input vector
        window = np.concatenate(self.history[-W:])
        assert window.shape[0] == self.network.cfg.input_size

        # Predict residual
        residual = self.network.predict(window)  # [tau_phi_hat, a_z_hat]

        # Compute gate
        sigma = 1.0
        if self.use_gate and self.network.gate_d0 is not None:
            sigma = self._compute_gate(window)

        # Apply correction (Eq 9–10)
        u_phi_total = u_phi_nom - sigma * residual[0]
        u_z_total = u_z_nom - sigma * residual[1]

        return u_z_total, u_phi_total, phi_des, sigma, residual

    def _compute_gate(self, window: np.ndarray) -> float:
        """State-distance gate (Eq 12–13)."""
        net = self.network
        if net.input_mean is None or net.input_std is None or net.gate_d0 is None:
            return 1.0

        d0 = net.gate_d0 * self.gate_cfg.d0_scale
        kappa = self.gate_cfg.kappa

        # Per-feature standardized distance (Eq 12)
        std_safe = np.where(net.input_std > 1e-8, net.input_std, 1.0)
        d = np.max(np.abs(window - net.input_mean) / std_safe)

        # Smooth gate (Eq 13)
        exponent = -max(0.0, d - d0) / kappa
        sigma = np.clip(np.exp(exponent), 0.0, 1.0)
        return float(sigma)
