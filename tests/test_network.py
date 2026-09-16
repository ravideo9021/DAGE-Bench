"""Tests for the residual MLP network."""

import numpy as np
import pytest
from pathlib import Path

from dage.config import NetworkConfig
from dage.network import ResidualMLP


@pytest.fixture
def net():
    return ResidualMLP(NetworkConfig(), seed=42)


class TestResidualMLP:
    def test_param_count(self, net):
        assert net.n_params == 7906

    def test_mac_count(self, net):
        assert net.n_macs == 7744

    def test_forward_shape(self, net):
        x = np.random.randn(10, 24)
        out = net.forward(x, training=False)
        assert out.shape == (10, 2)

    def test_forward_deterministic(self, net):
        x = np.random.randn(5, 24)
        out1 = net.forward(x, training=False)
        out2 = net.forward(x, training=False)
        np.testing.assert_array_equal(out1, out2)

    def test_predict_single(self, net):
        net.input_mean = np.zeros(24)
        net.input_std = np.ones(24)
        net.target_mean = np.zeros(2)
        net.target_std = np.ones(2)
        x = np.random.randn(24)
        out = net.predict(x)
        assert out.shape == (2,)

    def test_backward_produces_gradients(self, net):
        x = np.random.randn(8, 24)
        y = np.random.randn(8, 2)
        loss, grads = net.backward(x, y, training=True)
        assert loss > 0
        assert len(grads) == len(net.layers)
        for (dW, db), layer in zip(grads, net.layers):
            assert dW.shape == layer.W.shape
            assert db.shape == layer.b.shape

    def test_save_load_roundtrip(self, net, tmp_path):
        net.input_mean = np.random.randn(24)
        net.input_std = np.abs(np.random.randn(24)) + 0.1
        net.target_mean = np.random.randn(2)
        net.target_std = np.array([0.5, 1.5])
        net.gate_d0 = 4.5

        path = tmp_path / "model.npz"
        net.save(path)

        net2 = ResidualMLP(NetworkConfig(), seed=0)
        net2.load(path)

        x = np.random.randn(3, 24)
        np.testing.assert_allclose(
            net.forward(x, training=False),
            net2.forward(x, training=False),
            atol=1e-12,
        )
        assert abs(net2.gate_d0 - 4.5) < 1e-10

    def test_flat_params_roundtrip(self, net):
        p0 = net.get_flat_params()
        x = np.random.randn(3, 24)
        out0 = net.forward(x, training=False)

        net.set_flat_params(p0 * 0.5)
        out_changed = net.forward(x, training=False)
        assert not np.allclose(out0, out_changed)

        net.set_flat_params(p0)
        out_restored = net.forward(x, training=False)
        np.testing.assert_allclose(out0, out_restored, atol=1e-12)

    def test_input_size_matches_config(self, net):
        cfg = NetworkConfig()
        assert cfg.input_size == cfg.window * cfg.features_per_step
        assert cfg.input_size == 24
