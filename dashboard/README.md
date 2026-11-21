# DAGE-Bench Lab

An interactive web console for DAGE-Bench. It runs the actual research system in the browser: a TypeScript port of the reduced-order DAGE plant, the PD / PID / PID+DOB / residual controllers, and the trained 7,906-parameter residual MLP (weights exported from `results/residual_model.npz`). Nothing in the simulation is mocked. Every trajectory, inference, gate decision and Monte Carlo statistic is computed live.

```bash
cd dashboard
npm install
npm run dev          # http://localhost:5173
```

## Views

| View | What it does |
|---|---|
| **Flight** | Real-time 3D landing on a moving USV deck. Pick a controller, platform speed (including out-of-distribution > 4 m/s), seed, model mismatch and gate parameters. Live instruments (attitude, altitude tape, gate σ and d(x), touchdown envelope), strip charts of roll, true vs. predicted DAGE torque and gate weight, and a mission event log derived from the simulation state. *Compare* mode flies all five controllers on the same seed side by side. |
| **Monte Carlo** | Runs the paper's evaluation protocol (seeds 100…, per-trial plant randomisation) across a pool of Web Workers. Shows Wilson 95% CIs per cell, checks each cell against the published Table III/IV, a touchdown-state scatter against the safety envelope, and success-vs-speed curves. |
| **Model** | Live activations of the network inside a closed-loop flight, the standardised 24-dimensional input window, outputs vs. ground truth, an on-device latency benchmark, open- and closed-loop parity (R²), training curves, the model card and heatmaps of the trained weights. |
| **Gate** | The safety gate (Eq. 12–13) plotted over distance distributions recorded from in-distribution and OOD flights. Tune κ and d₀, see attenuation rates, reproduce Table V cells live, and see which input features push the state out of distribution. |
| **Physics** | Interactive DAGE torque field τ(z, v_p) and ground-effect profiles, with nominal and mismatch presets and a training-envelope overlay. |
| **Results** | Published Tables III and IV as metric-switchable heatmaps, the full Table III listing, key findings and the publication figures. |

Keyboard (Flight): `Space` play/pause · `R` restart · `N` next seed · `1–5` controller · `C` compare · `M` mismatch · `V` camera · `?` shortcuts.

## Design

A macOS-style window: a source-list sidebar, large-title pages, elevated cards, and a grouped inspector beside the 3D viewport. The type is San Francisco on Apple devices and Inter elsewhere. Overlays on the viewport use frosted glass. The 3D scene is lit with a studio environment map, so the hull and the quadrotor carry real reflections. Light and dark appearances follow the system setting, and the switch at the bottom of the sidebar overrides it. Every colour, including the canvas charts and the WebGL scene, comes from the CSS tokens in `src/styles.css`, read through `src/ui/theme.ts`.

## Fidelity

Every time it loads, the app checks itself against NumPy reference vectors embedded in `src/sim/model.json` (`src/sim/checks.ts`). The results appear behind the **Verified** badge in the sidebar:

- MLP forward pass: max |Δ| ≈ 4e-16 (float64 round-off)
- RK4 integration step: exact

The TypeScript PRNG differs from NumPy's, so individual trials differ, but the statistics reproduce the paper within its confidence intervals. Example (`npm run validate`, 200 trials per cell):

| Condition | Paper | Browser port |
|---|---|---|
| PD @ 6 m/s | 9.8% | 10.0% |
| PID @ 6 m/s | 89.8% | 90.5% |
| PD @ 5 m/s | 41.0% | 40.0% |
| PID @ 5 m/s, mismatch | 33.8% | 35.0% |
| Res-G @ 5 m/s, mismatch | 99.8% | 99.5% |
| Impact speed PD / PID | 0.246 / 0.335 | 0.246 / 0.336 |

## Layout

```
src/
  sim/            # physics.ts, network.ts, trial.ts, rng.ts, selftest.ts, checks.ts, model.json
  engine/         # flight.ts (live engine + event log), scene.ts (three.js), montecarlo.ts + mc.worker.ts
  views/          # one file per view, plus flight/Instruments.tsx and Verify.tsx
  ui/             # kit.tsx (cards, controls), hooks.ts, theme.ts, StripChart.tsx
scripts/
  export_model.py # re-export weights + reference vectors after retraining
  validate.ts     # TS-vs-Python parity and Monte Carlo reproduction check
```

After retraining (`dage train`), refresh the weights with `npm run export-model`. This needs NumPy and is run from `dashboard/`.
