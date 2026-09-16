"""Gymnasium environment for the DAGE landing task."""

from __future__ import annotations

import numpy as np

try:
    import gymnasium as gym
    from gymnasium import spaces
except ImportError:
    raise ImportError(
        "gymnasium is required for the RL environment. "
        "Install with: pip install gymnasium"
    )

from .config import SimConfig, ControlConfig
from .dynamics import Simulator


class DAGELandingEnv(gym.Env):
    """UAV landing on a moving platform under DAGE disturbance.

    The agent controls vertical acceleration (u_z) and roll torque (u_phi)
    to land a multirotor on a laterally moving platform while subject to
    dynamic asymmetric ground-effect disturbance.

    Observation (8-dim):
        [z, vz, y_rel, vy_rel, phi, p, t_norm, vp_norm]

    Action (2-dim, continuous):
        [u_z, u_phi] — vertical acceleration command, roll torque command

    Reward shaping:
        - Per-step penalty for roll error, lateral offset, and altitude tracking error
        - Large bonus for successful envelope landing
        - Large penalty for crash (excessive roll/speed at touchdown)
        - Small descent incentive to prevent hovering

    Episode termination:
        - Touchdown (z <= 0)
        - Timeout (t >= horizon)
    """

    metadata = {"render_modes": ["human"], "render_fps": 30}

    def __init__(
        self,
        sim_cfg: SimConfig | None = None,
        platform_speed: float = 3.0,
        randomize_params: bool = True,
        randomize_speed: bool = False,
        speed_range: tuple[float, float] = (0.0, 6.0),
        phi_max: float = 0.10,
        vz_max: float = 0.75,
        dvy_max: float = 0.75,
        render_mode: str | None = None,
        seed: int | None = None,
    ):
        super().__init__()
        self.sim_cfg = sim_cfg or SimConfig()
        self.platform_speed = platform_speed
        self.randomize_params = randomize_params
        self.randomize_speed = randomize_speed
        self.speed_range = speed_range
        self.phi_max = phi_max
        self.vz_max = vz_max
        self.dvy_max = dvy_max
        self.render_mode = render_mode

        self.observation_space = spaces.Box(
            low=np.array([-1.0, -5.0, -5.0, -10.0, -1.0, -10.0, 0.0, 0.0],
                         dtype=np.float32),
            high=np.array([10.0, 5.0, 5.0, 10.0, 1.0, 10.0, 1.0, 1.0],
                          dtype=np.float32),
        )

        self.action_space = spaces.Box(
            low=np.array([-15.0, -2.0], dtype=np.float32),
            high=np.array([5.0, 2.0], dtype=np.float32),
        )

        self._state = None
        self._vp = platform_speed
        self._K_phi = self.sim_cfg.K_phi
        self._A_GE = self.sim_cfg.A_GE
        self._Jx = self.sim_cfg.Jx
        self._step_count = 0
        self._sim = None
        self._trajectory = []

    def reset(self, *, seed=None, options=None):
        super().reset(seed=seed)

        rng = self.np_random

        if self.randomize_speed:
            self._vp = rng.uniform(*self.speed_range)
        else:
            self._vp = self.platform_speed

        if self.randomize_params:
            self._K_phi = self.sim_cfg.K_phi * rng.uniform(0.80, 1.20)
            self._A_GE = self.sim_cfg.A_GE * rng.uniform(0.85, 1.15)
            self._Jx = self.sim_cfg.Jx * rng.uniform(0.90, 1.10)
            y0 = rng.normal(0, 0.5)
            phi0 = rng.normal(0, 0.03)
        else:
            self._K_phi = self.sim_cfg.K_phi
            self._A_GE = self.sim_cfg.A_GE
            self._Jx = self.sim_cfg.Jx
            y0 = 0.0
            phi0 = 0.0

        self._state = np.array([
            self.sim_cfg.z0, 0.0, y0, -self._vp, phi0, 0.0
        ])
        self._step_count = 0
        self._sim = Simulator(
            self.sim_cfg, rng=np.random.default_rng(rng.integers(0, 2**32))
        )
        self._trajectory = [self._state.copy()]

        return self._get_obs(), self._get_info()

    def step(self, action):
        u_z = float(np.clip(action[0], -15.0, 5.0))
        u_phi = float(np.clip(action[1], -2.0, 2.0))

        tau_noise = self._sim.rng.normal(0, self.sim_cfg.tau_noise_std)
        prev_z = self._state[0]

        self._state = self._sim.step_rk4(
            self._state, u_z, u_phi, self._vp,
            self._K_phi, self._A_GE, self._Jx,
            tau_noise=tau_noise,
        )
        self._step_count += 1
        self._trajectory.append(self._state.copy())

        touchdown = self._state[0] <= 0.0 and prev_z > 0.0
        timeout = self._step_count >= self._sim.n_steps

        reward = self._compute_reward(u_z, u_phi, touchdown, timeout)

        terminated = touchdown
        truncated = timeout and not touchdown

        if not touchdown:
            self._state[0] = max(self._state[0], 0.0)

        return self._get_obs(), reward, terminated, truncated, self._get_info()

    def _get_obs(self):
        t_norm = self._step_count * self.sim_cfg.dt / self.sim_cfg.horizon
        vp_norm = self._vp / 6.0
        obs = np.concatenate([
            self._state,
            [t_norm, vp_norm],
        ]).astype(np.float32)
        return np.clip(obs, self.observation_space.low, self.observation_space.high)

    def _get_info(self):
        info = {
            "z": float(self._state[0]),
            "vz": float(self._state[1]),
            "y_rel": float(self._state[2]),
            "vy_rel": float(self._state[3]),
            "phi": float(self._state[4]),
            "p": float(self._state[5]),
            "vp": self._vp,
            "step": self._step_count,
            "t": self._step_count * self.sim_cfg.dt,
        }
        if self._state[0] <= 0.0:
            info["touchdown"] = True
            info["envelope_success"] = (
                abs(self._state[4]) <= self.phi_max
                and abs(self._state[1]) <= self.vz_max
                and abs(self._state[3]) <= self.dvy_max
            )
        return info

    def _compute_reward(self, u_z, u_phi, touchdown, timeout):
        z, vz, y_rel, vy_rel, phi, p = self._state

        r_track = -0.1 * (phi ** 2 + 0.5 * y_rel ** 2)
        r_descent = 0.01 if vz < -0.1 else 0.0
        r_action = -0.001 * (u_z ** 2 + u_phi ** 2)

        reward = r_track + r_descent + r_action

        if touchdown:
            in_envelope = (
                abs(phi) <= self.phi_max
                and abs(vz) <= self.vz_max
                and abs(vy_rel) <= self.dvy_max
            )
            if in_envelope:
                reward += 100.0
                softness = max(0.0, 1.0 - abs(vz) / self.vz_max)
                reward += 20.0 * softness
            else:
                reward -= 50.0
                if abs(phi) > self.phi_max:
                    reward -= 20.0 * (abs(phi) - self.phi_max) / self.phi_max
                if abs(vz) > self.vz_max:
                    reward -= 20.0 * (abs(vz) - self.vz_max) / self.vz_max
        elif timeout:
            reward -= 30.0

        return reward

    @property
    def trajectory(self):
        return np.array(self._trajectory)


def register_envs():
    """Register DAGE environments with Gymnasium."""
    gym.register(
        id="DAGELanding-v0",
        entry_point="dage.envs:DAGELandingEnv",
        max_episode_steps=1200,
        kwargs={"platform_speed": 3.0, "randomize_speed": False},
    )
    gym.register(
        id="DAGELanding-Random-v0",
        entry_point="dage.envs:DAGELandingEnv",
        max_episode_steps=1200,
        kwargs={"platform_speed": 3.0, "randomize_speed": True},
    )
    gym.register(
        id="DAGELanding-OOD-v0",
        entry_point="dage.envs:DAGELandingEnv",
        max_episode_steps=1200,
        kwargs={"platform_speed": 6.0, "randomize_speed": False},
    )
