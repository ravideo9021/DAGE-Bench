"""Training pipeline: data generation, network training, gate calibration (Section VI)."""

from __future__ import annotations

import logging
import time
from pathlib import Path

import numpy as np

from .config import SimConfig, ControlConfig, TrainConfig, NetworkConfig, GateConfig
from .dynamics import Simulator
from .controllers import NominalController, ControllerState
from .network import ResidualMLP, AdamOptimizer

logger = logging.getLogger(__name__)


def generate_trajectories(
    n_trajectories: int,
    sim_cfg: SimConfig,
    ctrl_cfg: ControlConfig,
    max_speed: float,
    seed: int,
) -> list[dict]:
    """Generate training trajectories under PID baseline (Section VI-A).

    Returns list of trajectory dicts with keys:
        states, measured, controls, targets, vp, params
    """
    rng = np.random.default_rng(seed)
    trajectories = []

    for traj_idx in range(n_trajectories):
        # Per-trial randomization (Section V-B)
        K_phi_scale = rng.uniform(0.80, 1.20)
        A_GE_scale = rng.uniform(0.85, 1.15)
        Jx_scale = rng.uniform(0.90, 1.10)
        vp_base = rng.uniform(0.0, max_speed)
        vp_scale = rng.uniform(0.90, 1.10)
        vp = vp_base * vp_scale

        y0 = rng.normal(0, 0.5)
        phi0 = rng.normal(0, 0.03)

        K_phi = sim_cfg.K_phi * K_phi_scale
        A_GE = sim_cfg.A_GE * A_GE_scale
        Jx = sim_cfg.Jx * Jx_scale

        sim = Simulator(sim_cfg, rng=np.random.default_rng(rng.integers(0, 2**32)))
        controller = NominalController(sim_cfg, ctrl_cfg, use_integral=True)
        ctrl_state = ControllerState()

        # Vehicle starts stationary in inertial frame → vy_rel = -vp
        state = np.array([sim_cfg.z0, 0.0, y0, -vp, phi0, 0.0])
        n_steps = int(sim_cfg.horizon / sim_cfg.dt)

        states = np.zeros((n_steps, 6))
        measured_arr = np.zeros((n_steps, 6))
        controls = np.zeros((n_steps, 2))
        targets = np.zeros((n_steps, 2))

        for step in range(n_steps):
            t = step * sim_cfg.dt
            measured = sim.add_sensor_noise(state)
            u_z, u_phi, _ = controller.compute(measured, t, ctrl_state)

            tau_dage = sim.get_dage_torque(state, vp, K_phi)
            a_ge = sim.get_ge_accel(state, A_GE)

            states[step] = state
            measured_arr[step] = measured
            controls[step] = [u_phi, u_z]
            targets[step] = [tau_dage, a_ge]

            tau_noise = sim.rng.normal(0, sim_cfg.tau_noise_std)
            state = sim.step_rk4(
                state, u_z, u_phi, vp, K_phi, A_GE, Jx,
                tau_noise=tau_noise,
            )
            state[0] = max(state[0], 0.0)  # Altitude floor

        trajectories.append({
            "states": states,
            "measured": measured_arr,
            "controls": controls,
            "targets": targets,
            "vp": vp,
            "K_phi": K_phi,
            "A_GE": A_GE,
            "Jx": Jx,
        })

        if (traj_idx + 1) % 50 == 0:
            logger.info("Generated %d/%d trajectories", traj_idx + 1, n_trajectories)

    return trajectories


def build_dataset(
    trajectories: list[dict],
    window: int = 4,
) -> tuple[np.ndarray, np.ndarray]:
    """Build windowed input/target arrays from trajectories (Section VI-A, Table II).

    Feature vector per timestep: [phi, p, z, vz, u_phi, u_z]
    Window of W=4 steps → 24-dimensional input.
    Targets: [tau_phi_DAGE, a_GE].
    """
    all_inputs = []
    all_targets = []

    for traj in trajectories:
        measured = traj["measured"]   # (n_steps, 6) = [z, vz, y, vy, phi, p]
        controls = traj["controls"]   # (n_steps, 2) = [u_phi, u_z]
        targets = traj["targets"]     # (n_steps, 2) = [tau_dage, a_ge]
        n_steps = measured.shape[0]

        # Build per-step features: [phi, p, z, vz, u_phi, u_z]
        features = np.column_stack([
            measured[:, 4],   # phi
            measured[:, 5],   # p
            measured[:, 0],   # z
            measured[:, 1],   # vz
            controls[:, 0],   # u_phi
            controls[:, 1],   # u_z
        ])

        for t in range(window - 1, n_steps):
            x = features[t - window + 1:t + 1].ravel()
            all_inputs.append(x)
            all_targets.append(targets[t])

    return np.array(all_inputs), np.array(all_targets)


def train_network(
    train_cfg: TrainConfig,
    net_cfg: NetworkConfig,
    sim_cfg: SimConfig,
    ctrl_cfg: ControlConfig,
    gate_cfg: GateConfig,
    output_dir: Path,
) -> ResidualMLP:
    """Full training pipeline (Section VI)."""
    output_dir.mkdir(parents=True, exist_ok=True)

    logger.info("=" * 60)
    logger.info("DAGE-Bench Training Pipeline")
    logger.info("=" * 60)

    # --- Step 1: Generate trajectories ---
    logger.info("Generating %d training trajectories (seed=%d)...",
                train_cfg.n_trajectories, train_cfg.seed_data)
    t0 = time.time()
    all_trajectories = generate_trajectories(
        train_cfg.n_trajectories + train_cfg.n_val_trajectories,
        sim_cfg, ctrl_cfg, train_cfg.max_train_speed, train_cfg.seed_data,
    )
    logger.info("Generated %d trajectories in %.1fs",
                len(all_trajectories), time.time() - t0)

    # Split by trajectory (Section VI-A)
    train_trajs = all_trajectories[:train_cfg.n_trajectories]
    val_trajs = all_trajectories[train_cfg.n_trajectories:]

    # --- Step 2: Build datasets ---
    logger.info("Building windowed datasets...")
    X_train_full, Y_train_full = build_dataset(train_trajs, net_cfg.window)
    X_val, Y_val = build_dataset(val_trajs, net_cfg.window)
    logger.info("Train samples: %d, Val samples: %d",
                X_train_full.shape[0], X_val.shape[0])

    # Subsample training data
    rng_data = np.random.default_rng(train_cfg.seed_data)
    n_sub = min(train_cfg.n_train_samples, X_train_full.shape[0])
    idx = rng_data.choice(X_train_full.shape[0], n_sub, replace=False)
    X_train = X_train_full[idx]
    Y_train = Y_train_full[idx]
    logger.info("Subsampled to %d training points", n_sub)

    # --- Step 3: Compute standardization ---
    input_mean = X_train.mean(axis=0)
    input_std = X_train.std(axis=0)
    target_mean = Y_train.mean(axis=0)
    target_std = Y_train.std(axis=0)
    target_std = np.where(target_std > 1e-8, target_std, 1.0)

    # Standardize targets for training
    Y_train_std = (Y_train - target_mean) / target_std
    Y_val_std = (Y_val - target_mean) / target_std

    # --- Step 4: Initialize network ---
    network = ResidualMLP(net_cfg, seed=train_cfg.seed_net)
    network.input_mean = input_mean
    network.input_std = input_std
    network.target_mean = target_mean
    network.target_std = target_std

    logger.info("Network: %d parameters, %d MACs/forward",
                network.n_params, network.n_macs)

    # --- Step 5: Train ---
    optimizer = AdamOptimizer(
        network,
        lr=train_cfg.lr,
        weight_decay=train_cfg.weight_decay,
        grad_clip=train_cfg.grad_clip,
    )

    best_val_loss = np.inf
    best_params = network.get_flat_params().copy()
    best_epoch = 0
    patience_counter = 0
    train_losses = []
    val_losses = []

    logger.info("Training (max %d epochs, patience %d)...",
                train_cfg.max_epochs, train_cfg.patience)

    for epoch in range(1, train_cfg.max_epochs + 1):
        t_epoch = time.time()

        # Learning rate schedule: decay per epoch
        lr = train_cfg.lr * (train_cfg.lr_decay ** (epoch - 1))
        optimizer.set_lr(lr)

        # Shuffle training data
        perm = rng_data.permutation(n_sub)
        X_shuffled = X_train[perm]
        Y_shuffled = Y_train_std[perm]

        # Mini-batch training
        epoch_loss = 0.0
        n_batches = 0
        for start in range(0, n_sub, train_cfg.batch_size):
            end = min(start + train_cfg.batch_size, n_sub)
            X_batch = X_shuffled[start:end]
            Y_batch = Y_shuffled[start:end]

            loss, grads = network.backward(X_batch, Y_batch, training=True)
            optimizer.step(grads)
            epoch_loss += loss * (end - start)
            n_batches += 1

        train_loss = epoch_loss / n_sub

        # Validation loss (no dropout, no input noise)
        val_pred = network.forward(X_val, training=False)
        val_loss = float(np.mean((val_pred - Y_val_std) ** 2))

        train_losses.append(train_loss)
        val_losses.append(val_loss)

        # Early stopping
        if val_loss < best_val_loss:
            best_val_loss = val_loss
            best_params = network.get_flat_params().copy()
            best_epoch = epoch
            patience_counter = 0
        else:
            patience_counter += 1

        if epoch % 5 == 0 or patience_counter == 0:
            logger.info(
                "Epoch %3d | train %.5f | val %.5f | lr %.6f | best_ep %d (%.1fs)",
                epoch, train_loss, val_loss, lr, best_epoch, time.time() - t_epoch,
            )

        if patience_counter >= train_cfg.patience:
            logger.info("Early stopping at epoch %d (patience=%d)",
                        epoch, train_cfg.patience)
            break

    # Restore best checkpoint
    network.set_flat_params(best_params)
    logger.info("Restored best checkpoint: epoch %d, val MSE %.5f",
                best_epoch, best_val_loss)

    # --- Step 6: Calibrate distance gate ---
    logger.info("Calibrating distance gate (d0 at %.0f%% percentile)...",
                gate_cfg.d0_percentile * 100)

    # Compute distances on validation set
    std_safe = np.where(input_std > 1e-8, input_std, 1.0)
    distances = np.max(np.abs(X_val - input_mean) / std_safe, axis=1)
    d0 = float(np.percentile(distances, gate_cfg.d0_percentile * 100))
    network.gate_d0 = d0
    logger.info("Gate threshold d0 = %.3f (99th percentile)", d0)

    # --- Step 7: Save ---
    model_path = output_dir / "residual_model.npz"
    network.save(model_path)
    logger.info("Model saved to %s", model_path)

    # Save training curves
    curves = np.column_stack([
        np.arange(1, len(train_losses) + 1),
        train_losses,
        val_losses,
    ])
    np.savetxt(output_dir / "training_curves.csv", curves,
               header="epoch,train_loss,val_loss", delimiter=",", comments="")

    logger.info("Training complete.")
    return network
