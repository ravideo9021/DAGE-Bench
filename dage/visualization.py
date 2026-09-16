"""Publication-quality visualization (Figs 3–5, Tables III–V)."""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.ticker import MaxNLocator

from .evaluation import ConditionResult

logger = logging.getLogger(__name__)

# Publication style
STYLE = {
    "font.family": "serif",
    "font.size": 10,
    "axes.labelsize": 11,
    "axes.titlesize": 11,
    "legend.fontsize": 9,
    "xtick.labelsize": 9,
    "ytick.labelsize": 9,
    "figure.dpi": 150,
    "savefig.dpi": 300,
    "savefig.bbox": "tight",
    "axes.grid": True,
    "grid.alpha": 0.3,
    "lines.linewidth": 1.5,
}

COLORS = {
    "PD": "#999999",
    "PID": "#2196F3",
    "PID+DOB": "#FF9800",
    "Res-NG": "#4CAF50",
    "Res-G": "#E91E63",
}

LINESTYLES = {
    "PD": ":",
    "PID": "-",
    "PID+DOB": "-.",
    "Res-NG": "--",
    "Res-G": "-",
}


def apply_style() -> None:
    plt.rcParams.update(STYLE)


def plot_training_curves(curves_path: Path, output_dir: Path) -> Path:
    """Plot training and validation loss curves (Fig 3)."""
    apply_style()
    data = np.loadtxt(curves_path, delimiter=",", skiprows=1)
    epochs = data[:, 0].astype(int)
    train_loss = data[:, 1]
    val_loss = data[:, 2]

    fig, ax = plt.subplots(figsize=(5, 3.5))
    ax.plot(epochs, train_loss, "b-", label="train", linewidth=1.5)
    ax.plot(epochs, val_loss, "r--", label="validation (held-out trajectories)", linewidth=1.5)
    ax.set_xlabel("Epoch")
    ax.set_ylabel("MSE (standardised targets)")
    ax.legend(loc="upper right")
    ax.xaxis.set_major_locator(MaxNLocator(integer=True))
    ax.set_ylim(bottom=0)

    out_path = output_dir / "fig3_training_curves.png"
    fig.savefig(out_path)
    plt.close(fig)
    logger.info("Saved %s", out_path)
    return out_path


def plot_descent_profile(
    results: dict[tuple[float, str], ConditionResult],
    output_dir: Path,
    vp: float = 3.0,
) -> Path:
    """Plot representative descent trajectories (Fig 4)."""
    apply_style()
    fig, ax = plt.subplots(figsize=(5, 3.5))

    for ctrl_name in ["PD", "PID", "Res-G"]:
        key = (vp, ctrl_name)
        if key not in results:
            continue
        result = results[key]
        for trial in result.trials:
            if trial.trajectory is not None:
                traj = trial.trajectory
                t = traj[:, 0]
                z = traj[:, 1]
                ax.plot(t, z,
                        color=COLORS.get(ctrl_name, "k"),
                        linestyle=LINESTYLES.get(ctrl_name, "-"),
                        label=ctrl_name if ctrl_name != "PID" else "PID (baseline)"
                               if ctrl_name == "PID" else
                               "Res-G (proposed)" if ctrl_name == "Res-G" else ctrl_name,
                        linewidth=1.5)
                break

    ax.set_xlabel("Time (s)")
    ax.set_ylabel("Relative altitude (m)")
    ax.legend(loc="upper right")
    ax.set_ylim(bottom=-0.2)

    out_path = output_dir / "fig4_descent_profile.png"
    fig.savefig(out_path)
    plt.close(fig)
    logger.info("Saved %s", out_path)
    return out_path


def plot_roll_error(
    results: dict[tuple[float, str], ConditionResult],
    output_dir: Path,
    vp: float = 3.0,
) -> Path:
    """Plot roll error on final approach (Fig 5)."""
    apply_style()
    fig, ax = plt.subplots(figsize=(5, 3.5))

    for ctrl_name in ["PD", "PID", "Res-G"]:
        key = (vp, ctrl_name)
        if key not in results:
            continue
        result = results[key]
        for trial in result.trials:
            if trial.trajectory is not None:
                traj = trial.trajectory
                t = traj[:, 0]
                phi = np.abs(traj[:, 5])
                # Show final approach region (z < 1.0 m → roughly t > 6s)
                mask = t > 5.0
                label = ctrl_name
                if ctrl_name == "PID":
                    label = "PID (baseline)"
                elif ctrl_name == "Res-G":
                    label = "Res-G (proposed)"
                ax.plot(t[mask], phi[mask],
                        color=COLORS.get(ctrl_name, "k"),
                        linestyle=LINESTYLES.get(ctrl_name, "-"),
                        label=label, linewidth=1.5)
                break

    ax.set_xlabel("Time (s)")
    ax.set_ylabel(r"$|\phi|$ (rad)")
    ax.legend(loc="upper right")
    ax.set_ylim(bottom=0)

    out_path = output_dir / "fig5_roll_error.png"
    fig.savefig(out_path)
    plt.close(fig)
    logger.info("Saved %s", out_path)
    return out_path


def plot_envelope_comparison(
    results: dict[tuple[float, str], ConditionResult],
    output_dir: Path,
) -> Path:
    """Bar chart of envelope success rates across platform speeds."""
    apply_style()
    speeds = sorted(set(vp for vp, _ in results.keys()))
    controllers = ["PD", "PID", "PID+DOB", "Res-NG", "Res-G"]

    fig, ax = plt.subplots(figsize=(10, 5))
    n_ctrl = len(controllers)
    bar_width = 0.15
    x = np.arange(len(speeds))

    for i, ctrl in enumerate(controllers):
        rates = []
        ci_lo = []
        ci_hi = []
        for vp in speeds:
            key = (vp, ctrl)
            if key in results:
                r = results[key]
                rate = r.envelope_success_rate * 100
                lo, hi = r.envelope_ci()
                rates.append(rate)
                ci_lo.append(max(0, rate - lo * 100))
                ci_hi.append(max(0, hi * 100 - rate))
            else:
                rates.append(0)
                ci_lo.append(0)
                ci_hi.append(0)

        offset = (i - n_ctrl / 2 + 0.5) * bar_width
        ax.bar(x + offset, rates, bar_width, label=ctrl,
               color=COLORS.get(ctrl, "gray"), alpha=0.85,
               yerr=[ci_lo, ci_hi], capsize=2)

    ax.set_xlabel("Platform speed (m/s)")
    ax.set_ylabel("Envelope success (%)")
    ax.set_xticks(x)
    ax.set_xticklabels([f"{v:.1f}" for v in speeds])
    ax.legend(loc="upper right", ncol=2)
    ax.set_ylim(0, 110)
    ax.axhline(y=100, color="k", linestyle=":", alpha=0.3)

    # Mark OOD speeds on x-axis labels
    labels = []
    for vp in speeds:
        lbl = f"{vp:.1f}"
        if vp > 4.0:
            lbl += "\n(OOD)"
        labels.append(lbl)
    ax.set_xticklabels(labels)

    out_path = output_dir / "envelope_comparison.png"
    fig.savefig(out_path)
    plt.close(fig)
    logger.info("Saved %s", out_path)
    return out_path


def plot_metrics_heatmap(
    results: dict[tuple[float, str], ConditionResult],
    output_dir: Path,
) -> Path:
    """Heatmap of RMS roll across conditions."""
    apply_style()
    speeds = sorted(set(vp for vp, _ in results.keys()))
    controllers = ["PD", "PID", "PID+DOB", "Res-NG", "Res-G"]

    data = np.full((len(controllers), len(speeds)), np.nan)
    for i, ctrl in enumerate(controllers):
        for j, vp in enumerate(speeds):
            key = (vp, ctrl)
            if key in results:
                data[i, j] = results[key].rms_phi_mean

    fig, ax = plt.subplots(figsize=(8, 4))
    im = ax.imshow(data, cmap="YlOrRd", aspect="auto")
    ax.set_xticks(range(len(speeds)))
    ax.set_xticklabels([f"{v:.1f}" for v in speeds])
    ax.set_yticks(range(len(controllers)))
    ax.set_yticklabels(controllers)
    ax.set_xlabel("Platform speed (m/s)")

    for i in range(len(controllers)):
        for j in range(len(speeds)):
            if not np.isnan(data[i, j]):
                ax.text(j, i, f"{data[i, j]:.4f}", ha="center", va="center",
                        fontsize=8, color="white" if data[i, j] > 0.05 else "black")

    fig.colorbar(im, ax=ax, label="RMS roll (rad)")
    ax.set_title("RMS Roll Error Across Conditions")

    out_path = output_dir / "rms_phi_heatmap.png"
    fig.savefig(out_path)
    plt.close(fig)
    logger.info("Saved %s", out_path)
    return out_path


def format_results_table(
    results: dict[tuple[float, str], ConditionResult],
    title: str = "TABLE III",
) -> str:
    """Format results as a text table matching the paper's Table III."""
    speeds = sorted(set(vp for vp, _ in results.keys()))
    controllers = ["PD", "PID", "PID+DOB", "Res-NG", "Res-G"]

    header = (
        f"\n{'=' * 110}\n"
        f"{title}: AGGREGATE EVALUATION, {next(iter(results.values())).n_trials} "
        f"RANDOMISED MONTE CARLO TRIALS PER CONDITION\n"
        f"{'=' * 110}\n"
        f"{'vp':>5} {'Controller':>10} {'RMS phi':>10} {'Peak phi':>10} "
        f"{'|dvy|':>10} {'|vz|':>10} {'Envelope':>12} {'Roll viol':>10} {'sigma':>8}\n"
        f"{'(m/s)':>5} {'':>10} {'(rad)':>10} {'(rad)':>10} "
        f"{'(m/s)':>10} {'(m/s)':>10} {'(%)':>12} {'(%)':>10} {'':>8}\n"
        f"{'-' * 110}\n"
    )
    lines = [header]

    for vp in speeds:
        ood = " *" if vp > 4.0 else ""
        for ctrl in controllers:
            key = (vp, ctrl)
            if key not in results:
                continue
            r = results[key].summary_row()
            sigma_str = f'{r["mean_sigma"]:.3f}' if r["mean_sigma"] is not None else "—"
            lines.append(
                f"{vp:5.1f}{ood} {ctrl:>10} {r['rms_phi']:10.4f} {r['peak_phi']:10.4f} "
                f"{r['delta_vy']:10.3f} {r['abs_vz']:10.3f} "
                f"{r['envelope_pct']:6.1f} [{r['envelope_ci_lo']:4.1f},{r['envelope_ci_hi']:5.1f}] "
                f"{r['roll_viol_pct']:10.1f} {sigma_str:>8}"
            )
        lines.append(f"{'-' * 110}")

    lines.append("* Out-of-distribution: platform speed exceeds training range [0, 4.0] m/s\n")
    return "\n".join(lines)


def generate_all_figures(
    results: dict[tuple[float, str], ConditionResult],
    training_curves_path: Path | None,
    output_dir: Path,
) -> list[Path]:
    """Generate all publication figures."""
    output_dir.mkdir(parents=True, exist_ok=True)
    figures = []

    if training_curves_path is not None and training_curves_path.exists():
        figures.append(plot_training_curves(training_curves_path, output_dir))

    figures.append(plot_descent_profile(results, output_dir))
    figures.append(plot_roll_error(results, output_dir))
    figures.append(plot_envelope_comparison(results, output_dir))
    figures.append(plot_metrics_heatmap(results, output_dir))

    return figures
