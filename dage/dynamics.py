"""Reduced-order simulator implementing the DAGE disturbance model (Eq 5–7).

Three-channel model: vertical (z, vz), lateral (y_rel, vy_rel), roll (phi, p).
Integrated at 100 Hz via RK4 with sensor and process noise injection.

State convention: [z, vz, y_rel, vy_rel, phi, p]
  z      — relative altitude above platform (m), positive up
  vz     — vertical velocity (m/s), negative = descending
  y_rel  — lateral offset from platform centre (m)
  vy_rel — lateral velocity relative to platform (m/s)
  phi    — roll angle (rad)
  p      — roll rate (rad/s)

The DAGE torque (Eq 6) requires inertial velocity: vy = vy_rel + vp.
"""

from __future__ import annotations

import numpy as np

from .config import SimConfig


def dage_torque(
    z: float, vy_inertial: float, vp: float, phi: float,
    K_phi: float, L: float, lam: float, decay_exp: float = 2.0,
) -> float:
    """DAGE roll torque (Eq 6).

    tau_phi_DAGE = K_phi * [vy + lam*(vy - vp)] * cos(phi) / (1 + (z/L)^decay_exp)

    vy is the vehicle's INERTIAL lateral velocity.
    """
    numerator = (vy_inertial + lam * (vy_inertial - vp)) * np.cos(phi)
    denominator = 1.0 + (z / L) ** decay_exp
    return K_phi * numerator / denominator


def ground_effect_accel(z: float, A_GE: float, R_z: float, decay_exp: float = 2.0) -> float:
    """Symmetric vertical ground-effect acceleration (Eq 7).

    a_GE(z) = A_GE / (1 + (z/R_z)^decay_exp)
    """
    return A_GE / (1.0 + (z / R_z) ** decay_exp)


class Simulator:
    """Reduced-order DAGE simulator (Section V).

    State: [z, vz, y_rel, vy_rel, phi, p]
    """

    def __init__(self, cfg: SimConfig, rng: np.random.Generator | None = None):
        self.cfg = cfg
        self.rng = rng or np.random.default_rng()
        self.n_steps = int(cfg.horizon / cfg.dt)

    def derivatives(
        self,
        state: np.ndarray,
        u_z: float,
        u_phi: float,
        vp: float,
        K_phi: float,
        A_GE: float,
        Jx: float,
        L: float | None = None,
        lam: float | None = None,
        R_z: float | None = None,
        decay_exp: float | None = None,
        tau_noise: float = 0.0,
    ) -> np.ndarray:
        """Compute state derivatives for the reduced-order model."""
        cfg = self.cfg
        z, vz, y_rel, vy_rel, phi, p = state

        _L = L if L is not None else cfg.L
        _lam = lam if lam is not None else cfg.lam
        _R_z = R_z if R_z is not None else cfg.R_z
        _decay_exp = decay_exp if decay_exp is not None else cfg.decay_exp

        z_safe = max(z, 0.01)

        # Inertial lateral velocity for DAGE
        vy_inertial = vy_rel + vp

        # Vertical channel
        a_ge = ground_effect_accel(z_safe, A_GE, _R_z, _decay_exp)
        dz = vz
        dvz = u_z + a_ge

        # Roll channel (Eq 5–6)
        tau_dage = dage_torque(z_safe, vy_inertial, vp, phi, K_phi, _L, _lam, _decay_exp)
        dphi = p
        dp = (u_phi + tau_dage + tau_noise) / Jx

        # Lateral channel — thrust-vectoring coupling
        # In inertial frame: v̇y = (u_z + g) * tan(phi)
        # Since vp = const, v̇y_rel = v̇y_inertial = (u_z + g) * tan(phi)
        total_vert_accel = u_z + cfg.g
        dvy_rel = total_vert_accel * np.tan(phi)
        dy_rel = vy_rel

        return np.array([dz, dvz, dy_rel, dvy_rel, dphi, dp])

    def step_rk4(
        self,
        state: np.ndarray,
        u_z: float,
        u_phi: float,
        vp: float,
        K_phi: float,
        A_GE: float,
        Jx: float,
        tau_noise: float = 0.0,
        L: float | None = None,
        lam: float | None = None,
        R_z: float | None = None,
        decay_exp: float | None = None,
    ) -> np.ndarray:
        """Fourth-order Runge–Kutta integration step."""
        dt = self.cfg.dt
        args = dict(
            u_z=u_z, u_phi=u_phi, vp=vp,
            K_phi=K_phi, A_GE=A_GE, Jx=Jx, tau_noise=tau_noise,
            L=L, lam=lam, R_z=R_z, decay_exp=decay_exp,
        )
        k1 = self.derivatives(state, **args)
        k2 = self.derivatives(state + 0.5 * dt * k1, **args)
        k3 = self.derivatives(state + 0.5 * dt * k2, **args)
        k4 = self.derivatives(state + dt * k3, **args)
        return state + (dt / 6.0) * (k1 + 2 * k2 + 2 * k3 + k4)

    def add_sensor_noise(self, state: np.ndarray) -> np.ndarray:
        """Add Gaussian sensor noise to state measurements."""
        cfg = self.cfg
        noise = np.array([
            self.rng.normal(0, cfg.sigma_z),
            self.rng.normal(0, cfg.sigma_vz),
            self.rng.normal(0, cfg.sigma_y),
            self.rng.normal(0, cfg.sigma_vy),
            self.rng.normal(0, cfg.sigma_phi),
            self.rng.normal(0, cfg.sigma_p),
        ])
        return state + noise

    def get_dage_torque(
        self,
        state: np.ndarray,
        vp: float,
        K_phi: float,
        L: float | None = None,
        lam: float | None = None,
        decay_exp: float | None = None,
    ) -> float:
        """Compute the DAGE torque for the current state (for training targets)."""
        z, _, _, vy_rel, phi, _ = state
        _L = L if L is not None else self.cfg.L
        _lam = lam if lam is not None else self.cfg.lam
        _decay_exp = decay_exp if decay_exp is not None else self.cfg.decay_exp
        vy_inertial = vy_rel + vp
        return dage_torque(max(z, 0.01), vy_inertial, vp, phi, K_phi, _L, _lam, _decay_exp)

    def get_ge_accel(
        self,
        state: np.ndarray,
        A_GE: float,
        R_z: float | None = None,
        decay_exp: float | None = None,
    ) -> float:
        """Compute the vertical ground-effect acceleration."""
        z = state[0]
        _R_z = R_z if R_z is not None else self.cfg.R_z
        _decay_exp = decay_exp if decay_exp is not None else self.cfg.decay_exp
        return ground_effect_accel(max(z, 0.01), A_GE, _R_z, _decay_exp)
