"""Configuration dataclasses — every constant from Table I and Sections V–VI."""

from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict
from pathlib import Path


@dataclass
class SimConfig:
    """Simulator parameters (Table I)."""
    dt: float = 0.01            # Integration step (100 Hz)
    horizon: float = 12.0       # Trajectory horizon (s)
    z0: float = 4.0             # Initial relative altitude (m)
    v_des: float = 0.42         # Commanded descent rate (m/s, positive downward)

    mass: float = 1.5           # Vehicle mass (kg)
    Jx: float = 0.020           # Roll inertia (kg m^2)
    g: float = 9.81             # Gravitational acceleration (m/s^2)

    # Vertical ground-effect (Eq 7)
    A_GE: float = 1.8           # Vertical GE gain (m/s^2)
    R_z: float = 0.55           # Vertical GE length scale (m)

    # DAGE torque (Eq 6)
    K_phi: float = 0.12         # DAGE disturbance gain
    L: float = 0.35             # DAGE altitude length scale (m)
    lam: float = 0.60           # Slip-weight parameter (lambda)
    decay_exp: float = 2.0      # Altitude decay exponent

    # Sensor noise standard deviations
    sigma_z: float = 0.010      # Altitude noise (m)
    sigma_vz: float = 0.030     # Altitude rate noise (m/s)
    sigma_phi: float = 0.004    # Roll angle noise (rad)
    sigma_p: float = 0.020      # Roll rate noise (rad/s)
    sigma_y: float = 0.010      # Lateral position noise (m)
    sigma_vy: float = 0.030     # Lateral velocity noise (m/s)

    # Process noise (torque noise std dev)
    tau_noise_std: float = 0.005


@dataclass
class PIDGains:
    """PID gains for a single channel."""
    Kp: float = 0.0
    Kd: float = 0.0
    Ki: float = 0.0


@dataclass
class ControlConfig:
    """Controller parameters (Table I)."""
    # Vertical PID
    z_gains: PIDGains = field(default_factory=lambda: PIDGains(Kp=2.2, Kd=2.6, Ki=1.6))
    # Roll PID
    phi_gains: PIDGains = field(default_factory=lambda: PIDGains(Kp=60.0, Kd=11.0, Ki=30.0))
    # Lateral outer-loop gains (position → roll setpoint cascade)
    lat_Kp: float = 0.40        # Lateral position gain
    lat_Kd: float = 0.30        # Lateral velocity gain
    # DOB time constant (Section V-C)
    dob_tau: float = 1.0


@dataclass
class NetworkConfig:
    """Residual MLP configuration (Fig 2, Section VI)."""
    window: int = 4                         # History window W (timesteps)
    features_per_step: int = 6              # phi, p, z, vz, u_phi, u_z
    hidden_sizes: list[int] = field(default_factory=lambda: [64, 64, 32])
    activation: str = "tanh"
    output_size: int = 2                    # tau_phi_hat, a_z_hat
    dropout: float = 0.05
    input_noise_std: float = 0.02           # On standardized inputs

    @property
    def input_size(self) -> int:
        return self.window * self.features_per_step  # 24


@dataclass
class TrainConfig:
    """Training hyperparameters (Section VI-C)."""
    n_trajectories: int = 400
    n_val_trajectories: int = 60
    n_train_samples: int = 200_000
    lr: float = 8e-4
    lr_decay: float = 0.94      # Per-epoch multiplicative decay
    weight_decay: float = 1e-5  # L2 regularization
    batch_size: int = 256
    max_epochs: int = 200
    patience: int = 6           # Early stopping patience
    grad_clip: float = 5.0      # Global gradient-norm clipping
    seed_data: int = 42
    seed_net: int = 1
    max_train_speed: float = 4.0  # U(0, max_train_speed) m/s


@dataclass
class GateConfig:
    """Distance-gate parameters (Eq 12–13, Section IV-D)."""
    d0_percentile: float = 0.99   # Calibration percentile
    kappa: float = 1.0            # Decay rate
    d0_scale: float = 1.0         # Multiplicative scale on calibrated d0


@dataclass
class EvalConfig:
    """Evaluation settings (Section V-D)."""
    n_trials: int = 500
    platform_speeds: list[float] = field(
        default_factory=lambda: [0.0, 1.5, 3.0, 5.0, 6.0]
    )
    # Landing envelope thresholds
    phi_max: float = 0.10          # rad
    vz_max: float = 0.75           # m/s
    dvy_max: float = 0.75          # m/s
    final_approach_z: float = 1.0  # m (z < this for final-approach metrics)
    # Per-trial randomization ranges
    K_phi_range: tuple[float, float] = (0.80, 1.20)
    A_GE_range: tuple[float, float] = (0.85, 1.15)
    Jx_range: tuple[float, float] = (0.90, 1.10)
    vp_range: tuple[float, float] = (0.90, 1.10)
    y0_std: float = 0.5           # m
    phi0_std: float = 0.03        # rad
    # Bootstrap
    n_bootstrap: int = 20_000
    seed: int = 100


@dataclass
class MismatchConfig:
    """Disturbance-model mismatch parameters (Section VII-D)."""
    K_phi_scale: float = 1.40
    A_GE_scale: float = 1.35
    L_scale: float = 1.30
    R_z_scale: float = 1.40
    decay_exp: float = 1.6       # Changed from 2.0
    lam: float = 1.00            # Changed from 0.60


@dataclass
class ProjectConfig:
    """Top-level configuration aggregating all sub-configs."""
    sim: SimConfig = field(default_factory=SimConfig)
    control: ControlConfig = field(default_factory=ControlConfig)
    network: NetworkConfig = field(default_factory=NetworkConfig)
    train: TrainConfig = field(default_factory=TrainConfig)
    gate: GateConfig = field(default_factory=GateConfig)
    eval: EvalConfig = field(default_factory=EvalConfig)
    mismatch: MismatchConfig = field(default_factory=MismatchConfig)
    output_dir: str = "results"

    def save(self, path: str | Path) -> None:
        Path(path).write_text(json.dumps(asdict(self), indent=2))

    @classmethod
    def load(cls, path: str | Path) -> ProjectConfig:
        data = json.loads(Path(path).read_text())
        return cls(
            sim=SimConfig(**data.get("sim", {})),
            control=ControlConfig(
                z_gains=PIDGains(**data["control"]["z_gains"]),
                phi_gains=PIDGains(**data["control"]["phi_gains"]),
                lat_Kp=data["control"]["lat_Kp"],
                lat_Kd=data["control"]["lat_Kd"],
                dob_tau=data["control"]["dob_tau"],
            ) if "control" in data else ControlConfig(),
            network=NetworkConfig(**{
                k: v for k, v in data.get("network", {}).items()
                if k != "input_size"
            }),
            train=TrainConfig(**data.get("train", {})),
            gate=GateConfig(**data.get("gate", {})),
            eval=EvalConfig(**data.get("eval", {})),
            mismatch=MismatchConfig(**data.get("mismatch", {})),
            output_dir=data.get("output_dir", "results"),
        )
