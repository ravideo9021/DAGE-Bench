"""Pure-NumPy residual MLP (Fig 2): 24 → 64 → 64 → 32 → 2.

7,906 parameters, 7,744 multiply–accumulate operations per forward pass.
No external deep-learning framework, matching the paper's implementation.
"""

from __future__ import annotations

import numpy as np
from dataclasses import dataclass
from pathlib import Path

from .config import NetworkConfig


def _init_weights(fan_in: int, fan_out: int, rng: np.random.Generator) -> np.ndarray:
    """Xavier/Glorot uniform initialization for tanh networks."""
    limit = np.sqrt(6.0 / (fan_in + fan_out))
    return rng.uniform(-limit, limit, (fan_in, fan_out))


@dataclass
class LayerParams:
    W: np.ndarray
    b: np.ndarray

    @property
    def n_params(self) -> int:
        return self.W.size + self.b.size


class ResidualMLP:
    """Three-hidden-layer MLP with tanh activations.

    Architecture: Input(24) → Dense(64, tanh) → Dense(64, tanh) → Dense(32, tanh) → Linear(2)
    """

    def __init__(self, cfg: NetworkConfig, seed: int = 1):
        self.cfg = cfg
        self.rng = np.random.default_rng(seed)
        self.layers: list[LayerParams] = []

        # Build layers
        sizes = [cfg.input_size] + cfg.hidden_sizes + [cfg.output_size]
        for i in range(len(sizes) - 1):
            W = _init_weights(sizes[i], sizes[i + 1], self.rng)
            b = np.zeros(sizes[i + 1])
            self.layers.append(LayerParams(W=W, b=b))

        # Standardization parameters (set during training)
        self.input_mean: np.ndarray | None = None
        self.input_std: np.ndarray | None = None
        self.target_mean: np.ndarray | None = None
        self.target_std: np.ndarray | None = None

        # Gate calibration
        self.gate_d0: float | None = None

        # Dropout masks (training only)
        self._training = False

    @property
    def n_params(self) -> int:
        return sum(l.n_params for l in self.layers)

    @property
    def n_macs(self) -> int:
        """Multiply-accumulate operations per forward pass."""
        sizes = [self.cfg.input_size] + self.cfg.hidden_sizes + [self.cfg.output_size]
        return sum(sizes[i] * sizes[i + 1] for i in range(len(sizes) - 1))

    def forward(self, x: np.ndarray, training: bool = False) -> np.ndarray:
        """Forward pass. x: (batch, input_size) or (input_size,)."""
        single = x.ndim == 1
        if single:
            x = x[np.newaxis, :]

        # Standardize input
        if self.input_mean is not None:
            std_safe = np.where(self.input_std > 1e-8, self.input_std, 1.0)
            x = (x - self.input_mean) / std_safe

        # Add input noise during training
        if training and self.cfg.input_noise_std > 0:
            x = x + self.rng.normal(0, self.cfg.input_noise_std, x.shape)

        # Hidden layers with tanh activation
        for i, layer in enumerate(self.layers[:-1]):
            x = x @ layer.W + layer.b
            x = np.tanh(x)

            # Dropout during training
            if training and self.cfg.dropout > 0:
                mask = self.rng.binomial(1, 1.0 - self.cfg.dropout, x.shape)
                x = x * mask / (1.0 - self.cfg.dropout)

        # Output layer (linear)
        x = x @ self.layers[-1].W + self.layers[-1].b

        if single:
            x = x[0]
        return x

    def predict(self, x: np.ndarray) -> np.ndarray:
        """Predict in original (unstandardized) target units."""
        y_std = self.forward(x, training=False)
        if self.target_mean is not None:
            return y_std * self.target_std + self.target_mean
        return y_std

    def backward(
        self, x: np.ndarray, targets: np.ndarray, training: bool = True,
    ) -> tuple[float, list[tuple[np.ndarray, np.ndarray]]]:
        """Forward + backward pass, returning loss and gradients.

        x: (batch, input_size), targets: (batch, output_size) in standardized units.
        """
        batch_size = x.shape[0]

        # Standardize input
        if self.input_mean is not None:
            std_safe = np.where(self.input_std > 1e-8, self.input_std, 1.0)
            x_std = (x - self.input_mean) / std_safe
        else:
            x_std = x.copy()

        if training and self.cfg.input_noise_std > 0:
            x_std = x_std + self.rng.normal(0, self.cfg.input_noise_std, x_std.shape)

        # Forward pass with caching
        activations = [x_std]
        pre_activations = []
        dropout_masks = []
        h = x_std

        for i, layer in enumerate(self.layers[:-1]):
            z = h @ layer.W + layer.b
            pre_activations.append(z)
            h = np.tanh(z)

            if training and self.cfg.dropout > 0:
                mask = self.rng.binomial(1, 1.0 - self.cfg.dropout, h.shape).astype(np.float64)
                h = h * mask / (1.0 - self.cfg.dropout)
                dropout_masks.append(mask)
            else:
                dropout_masks.append(None)

            activations.append(h)

        # Output layer
        output = h @ self.layers[-1].W + self.layers[-1].b
        activations.append(output)

        # MSE loss
        diff = output - targets
        loss = np.mean(diff ** 2)

        # Backward pass
        grads = []
        d_output = (2.0 / batch_size) * diff  # dL/d_output

        # Output layer gradients
        dW = activations[-2].T @ d_output
        db = np.sum(d_output, axis=0)
        grads.append((dW, db))

        d_h = d_output @ self.layers[-1].W.T

        # Hidden layers (reverse order)
        for i in range(len(self.layers) - 2, -1, -1):
            if dropout_masks[i] is not None:
                d_h = d_h * dropout_masks[i] / (1.0 - self.cfg.dropout)

            # tanh derivative: 1 - tanh^2(z)
            d_z = d_h * (1.0 - np.tanh(pre_activations[i]) ** 2)

            dW = activations[i].T @ d_z
            db = np.sum(d_z, axis=0)
            grads.append((dW, db))

            if i > 0:
                d_h = d_z @ self.layers[i].W.T

        grads.reverse()
        return loss, grads

    def get_flat_params(self) -> np.ndarray:
        """Flatten all parameters into a single vector."""
        parts = []
        for layer in self.layers:
            parts.extend([layer.W.ravel(), layer.b.ravel()])
        return np.concatenate(parts)

    def set_flat_params(self, params: np.ndarray) -> None:
        """Restore parameters from a flat vector."""
        offset = 0
        for layer in self.layers:
            w_size = layer.W.size
            b_size = layer.b.size
            layer.W = params[offset:offset + w_size].reshape(layer.W.shape)
            offset += w_size
            layer.b = params[offset:offset + b_size].reshape(layer.b.shape)
            offset += b_size

    def save(self, path: str | Path) -> None:
        """Save model to npz file."""
        data = {}
        for i, layer in enumerate(self.layers):
            data[f"W{i}"] = layer.W
            data[f"b{i}"] = layer.b
        if self.input_mean is not None:
            data["input_mean"] = self.input_mean
            data["input_std"] = self.input_std
        if self.target_mean is not None:
            data["target_mean"] = self.target_mean
            data["target_std"] = self.target_std
        if self.gate_d0 is not None:
            data["gate_d0"] = np.array([self.gate_d0])
        np.savez(str(path), **data)

    def load(self, path: str | Path) -> None:
        """Load model from npz file."""
        data = np.load(str(path))
        for i, layer in enumerate(self.layers):
            layer.W = data[f"W{i}"]
            layer.b = data[f"b{i}"]
        if "input_mean" in data:
            self.input_mean = data["input_mean"]
            self.input_std = data["input_std"]
        if "target_mean" in data:
            self.target_mean = data["target_mean"]
            self.target_std = data["target_std"]
        if "gate_d0" in data:
            self.gate_d0 = float(data["gate_d0"][0])


class AdamOptimizer:
    """Adam optimizer with per-epoch learning-rate decay and gradient clipping."""

    def __init__(
        self,
        network: ResidualMLP,
        lr: float = 8e-4,
        beta1: float = 0.9,
        beta2: float = 0.999,
        eps: float = 1e-8,
        weight_decay: float = 1e-5,
        grad_clip: float = 5.0,
    ):
        self.network = network
        self.lr = lr
        self.lr0 = lr
        self.beta1 = beta1
        self.beta2 = beta2
        self.eps = eps
        self.weight_decay = weight_decay
        self.grad_clip = grad_clip
        self.t = 0

        self.m: list[tuple[np.ndarray, np.ndarray]] = []
        self.v: list[tuple[np.ndarray, np.ndarray]] = []
        for layer in network.layers:
            self.m.append((np.zeros_like(layer.W), np.zeros_like(layer.b)))
            self.v.append((np.zeros_like(layer.W), np.zeros_like(layer.b)))

    def step(self, grads: list[tuple[np.ndarray, np.ndarray]]) -> None:
        """One optimization step with gradient clipping and weight decay."""
        self.t += 1

        # Global gradient-norm clipping
        grad_norm = 0.0
        for dW, db in grads:
            grad_norm += np.sum(dW ** 2) + np.sum(db ** 2)
        grad_norm = np.sqrt(grad_norm)

        clip_coeff = 1.0
        if grad_norm > self.grad_clip:
            clip_coeff = self.grad_clip / grad_norm

        for i, (layer, (dW, db)) in enumerate(zip(self.network.layers, grads)):
            # Apply clipping
            dW = dW * clip_coeff
            db = db * clip_coeff

            # Add L2 regularization gradient
            dW = dW + self.weight_decay * layer.W

            # Update moments
            mW, mb = self.m[i]
            vW, vb = self.v[i]

            mW = self.beta1 * mW + (1 - self.beta1) * dW
            mb = self.beta1 * mb + (1 - self.beta1) * db
            vW = self.beta2 * vW + (1 - self.beta2) * dW ** 2
            vb = self.beta2 * vb + (1 - self.beta2) * db ** 2

            self.m[i] = (mW, mb)
            self.v[i] = (vW, vb)

            # Bias correction
            bc1 = 1 - self.beta1 ** self.t
            bc2 = 1 - self.beta2 ** self.t

            mW_hat = mW / bc1
            mb_hat = mb / bc1
            vW_hat = vW / bc2
            vb_hat = vb / bc2

            # Update parameters
            layer.W -= self.lr * mW_hat / (np.sqrt(vW_hat) + self.eps)
            layer.b -= self.lr * mb_hat / (np.sqrt(vb_hat) + self.eps)

    def set_lr(self, lr: float) -> None:
        self.lr = lr
