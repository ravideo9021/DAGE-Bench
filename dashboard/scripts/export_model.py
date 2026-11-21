"""Export the trained residual MLP + reference vectors for the browser console.

Run from the repository root:  python dashboard/scripts/export_model.py
Writes dashboard/src/sim/model.json. The reference vectors let the web app
verify, at boot, that its TypeScript port reproduces the NumPy forward pass
and RK4 integrator bit-for-bit (to float64 round-off).
"""
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from dage.config import ProjectConfig  # noqa: E402
from dage.dynamics import Simulator  # noqa: E402
from dage.network import ResidualMLP  # noqa: E402

cfg = ProjectConfig()
net = ResidualMLP(cfg.network)
net.load(ROOT / "results" / "residual_model.npz")

rng = np.random.default_rng(7)
probe_inputs = [net.input_mean + net.input_std * rng.normal(0, 1, 24) for _ in range(4)]
probe_outputs = [net.predict(x).tolist() for x in probe_inputs]

sim = Simulator(cfg.sim)
state = np.array([2.5, -0.4, 0.3, -1.2, 0.02, -0.1])
rk4_out = sim.step_rk4(state, u_z=0.3, u_phi=-0.01, vp=3.0, K_phi=0.12, A_GE=1.8, Jx=0.02).tolist()

out = {
    "layers": [
        {"W": l.W.flatten().tolist(), "b": l.b.tolist(), "in": l.W.shape[0], "out": l.W.shape[1]}
        for l in net.layers
    ],
    "input_mean": net.input_mean.tolist(),
    "input_std": net.input_std.tolist(),
    "target_mean": net.target_mean.tolist(),
    "target_std": net.target_std.tolist(),
    "gate_d0": net.gate_d0,
    "selftest": {
        "net_inputs": [x.tolist() for x in probe_inputs],
        "net_outputs": probe_outputs,
        "rk4": {"state": state.tolist(), "u_z": 0.3, "u_phi": -0.01, "vp": 3.0,
                 "K_phi": 0.12, "A_GE": 1.8, "Jx": 0.02, "out": rk4_out},
    },
}
dst = ROOT / "dashboard" / "src" / "sim" / "model.json"
dst.write_text(json.dumps(out, separators=(",", ":")))
print(f"wrote {dst} ({dst.stat().st_size/1024:.1f} KB), params={net.n_params}, d0={net.gate_d0:.4f}")
