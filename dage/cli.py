"""Command-line interface for DAGE-Bench."""

from __future__ import annotations

import argparse
import logging
import sys
import time
from pathlib import Path

from .config import ProjectConfig


def setup_logging(output_dir: Path, verbose: bool = False) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    level = logging.DEBUG if verbose else logging.INFO
    fmt = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
    logging.basicConfig(
        level=level,
        format=fmt,
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler(output_dir / "dage.log"),
        ],
    )


def cmd_train(args: argparse.Namespace) -> None:
    from .training import train_network

    cfg = ProjectConfig()
    output_dir = Path(cfg.output_dir)
    setup_logging(output_dir, args.verbose)

    train_network(
        cfg.train, cfg.network, cfg.sim, cfg.control, cfg.gate,
        output_dir=output_dir,
    )


def cmd_evaluate(args: argparse.Namespace) -> None:
    from .evaluation import run_full_evaluation
    from .network import ResidualMLP
    from .visualization import format_results_table

    cfg = ProjectConfig()
    output_dir = Path(cfg.output_dir)
    setup_logging(output_dir, args.verbose)
    logger = logging.getLogger(__name__)

    model_path = output_dir / "residual_model.npz"
    network = None
    if model_path.exists():
        network = ResidualMLP(cfg.network)
        network.load(model_path)
        logger.info("Loaded model from %s (%d params)", model_path, network.n_params)
    else:
        logger.warning("No model found at %s — evaluating classical controllers only", model_path)

    results = run_full_evaluation(
        cfg.sim, cfg.control, cfg.eval, cfg.gate,
        network=network,
        output_dir=output_dir,
    )

    table = format_results_table(results)
    print(table)
    (output_dir / "table_iii.txt").write_text(table)


def cmd_mismatch(args: argparse.Namespace) -> None:
    from .evaluation import run_full_evaluation
    from .network import ResidualMLP
    from .visualization import format_results_table

    cfg = ProjectConfig()
    output_dir = Path(cfg.output_dir) / "mismatch"
    setup_logging(output_dir, args.verbose)
    logger = logging.getLogger(__name__)

    model_path = Path(cfg.output_dir) / "residual_model.npz"
    network = None
    if model_path.exists():
        network = ResidualMLP(cfg.network)
        network.load(model_path)

    eval_cfg = cfg.eval
    eval_cfg.platform_speeds = [1.5, 3.0, 5.0]

    controllers = ["PD", "PID", "Res-NG", "Res-G"]
    results = run_full_evaluation(
        cfg.sim, cfg.control, eval_cfg, cfg.gate,
        network=network,
        mismatch=cfg.mismatch,
        output_dir=output_dir,
        controllers=controllers,
    )

    table = format_results_table(results, title="TABLE IV — DISTURBANCE-MODEL MISMATCH")
    print(table)
    (output_dir / "table_iv.txt").write_text(table)


def cmd_gate_ablation(args: argparse.Namespace) -> None:
    from .evaluation import run_gate_ablation
    from .network import ResidualMLP

    cfg = ProjectConfig()
    output_dir = Path(cfg.output_dir) / "gate_ablation"
    setup_logging(output_dir, args.verbose)

    model_path = Path(cfg.output_dir) / "residual_model.npz"
    network = ResidualMLP(cfg.network)
    network.load(model_path)

    rows = run_gate_ablation(
        cfg.sim, cfg.control, cfg.eval, cfg.gate, network,
        vp=6.0, n_trials=300, output_dir=output_dir,
    )

    print(f"\n{'=' * 70}")
    print("TABLE V: GATE ABLATION AT vp = 6.0 m/s (OOD), 300 TRIALS PER CELL")
    print(f"{'=' * 70}")
    print(f"{'kappa':>8} {'d0 scale':>10} {'sigma':>8} {'RMS phi':>12} {'Envelope (%)':>14}")
    print(f"{'-' * 70}")
    for row in rows:
        k = row["kappa"]
        d = row["d0_scale"]
        print(
            f"{str(k):>8} {str(d):>10} "
            f"{row['mean_sigma']:8.3f} {row['rms_phi']:12.4f} {row['envelope_pct']:14.1f}"
            if row["mean_sigma"] is not None else
            f"{str(k):>8} {str(d):>10} {'—':>8} {row['rms_phi']:12.4f} {row['envelope_pct']:14.1f}"
        )


def cmd_visualize(args: argparse.Namespace) -> None:
    from .evaluation import run_full_evaluation
    from .network import ResidualMLP
    from .visualization import generate_all_figures

    cfg = ProjectConfig()
    output_dir = Path(cfg.output_dir)
    fig_dir = output_dir / "figures"
    setup_logging(output_dir, args.verbose)

    model_path = output_dir / "residual_model.npz"
    network = None
    if model_path.exists():
        network = ResidualMLP(cfg.network)
        network.load(model_path)

    # Quick evaluation for visualization (fewer trials)
    vis_eval = cfg.eval
    vis_eval.n_trials = 100
    results = run_full_evaluation(
        cfg.sim, cfg.control, vis_eval, cfg.gate,
        network=network,
        output_dir=None,
    )

    curves_path = output_dir / "training_curves.csv"
    figures = generate_all_figures(results, curves_path, fig_dir)
    print(f"\nGenerated {len(figures)} figures in {fig_dir}")


def cmd_run_all(args: argparse.Namespace) -> None:
    """Run the complete pipeline: train → evaluate → mismatch → gate ablation → visualize."""
    from .training import train_network
    from .evaluation import run_full_evaluation, run_gate_ablation
    from .network import ResidualMLP
    from .visualization import (
        format_results_table, generate_all_figures,
    )

    cfg = ProjectConfig()
    output_dir = Path(cfg.output_dir)
    setup_logging(output_dir, args.verbose)
    logger = logging.getLogger(__name__)

    t_total = time.time()

    # === PHASE 1: TRAINING ===
    logger.info("=" * 60)
    logger.info("PHASE 1: TRAINING")
    logger.info("=" * 60)
    network = train_network(
        cfg.train, cfg.network, cfg.sim, cfg.control, cfg.gate,
        output_dir=output_dir,
    )

    # === PHASE 2: MAIN EVALUATION (Table III) ===
    logger.info("=" * 60)
    logger.info("PHASE 2: MAIN EVALUATION (Table III)")
    logger.info("=" * 60)
    results = run_full_evaluation(
        cfg.sim, cfg.control, cfg.eval, cfg.gate,
        network=network,
        output_dir=output_dir,
    )
    table = format_results_table(results)
    print(table)
    (output_dir / "table_iii.txt").write_text(table)

    # === PHASE 3: MISMATCH EVALUATION (Table IV) ===
    logger.info("=" * 60)
    logger.info("PHASE 3: MISMATCH EVALUATION (Table IV)")
    logger.info("=" * 60)
    from copy import deepcopy
    mm_eval = deepcopy(cfg.eval)
    mm_eval.platform_speeds = [1.5, 3.0, 5.0]
    mm_dir = output_dir / "mismatch"
    mm_results = run_full_evaluation(
        cfg.sim, cfg.control, mm_eval, cfg.gate,
        network=network,
        mismatch=cfg.mismatch,
        output_dir=mm_dir,
        controllers=["PD", "PID", "Res-NG", "Res-G"],
    )
    table_iv = format_results_table(mm_results, "TABLE IV — DISTURBANCE-MODEL MISMATCH")
    print(table_iv)
    (mm_dir / "table_iv.txt").write_text(table_iv)

    # === PHASE 4: GATE ABLATION (Table V) ===
    logger.info("=" * 60)
    logger.info("PHASE 4: GATE ABLATION (Table V)")
    logger.info("=" * 60)
    ablation_dir = output_dir / "gate_ablation"
    run_gate_ablation(
        cfg.sim, cfg.control, cfg.eval, cfg.gate, network,
        vp=6.0, n_trials=300, output_dir=ablation_dir,
    )

    # === PHASE 5: FIGURES ===
    logger.info("=" * 60)
    logger.info("PHASE 5: GENERATING FIGURES")
    logger.info("=" * 60)
    fig_dir = output_dir / "figures"
    curves_path = output_dir / "training_curves.csv"
    figures = generate_all_figures(results, curves_path, fig_dir)

    # === DONE ===
    elapsed = time.time() - t_total
    logger.info("=" * 60)
    logger.info("ALL PHASES COMPLETE (%.1f minutes total)", elapsed / 60)
    logger.info("Results directory: %s", output_dir)
    logger.info("=" * 60)

    # Save config for reproducibility
    cfg.save(output_dir / "config.json")


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="dage",
        description="DAGE-Bench: UAV Landing Residual Compensation Simulation",
    )
    parser.add_argument("-v", "--verbose", action="store_true")
    sub = parser.add_subparsers(dest="command")

    for name, hlp in [
        ("train", "Train the residual network"),
        ("evaluate", "Run Monte Carlo evaluation (Table III)"),
        ("mismatch", "Run mismatch evaluation (Table IV)"),
        ("gate-ablation", "Run gate ablation (Table V)"),
        ("visualize", "Generate publication figures"),
        ("run-all", "Run complete pipeline (train → evaluate → figures)"),
    ]:
        p = sub.add_parser(name, help=hlp)
        p.add_argument("-v", "--verbose", action="store_true")

    args = parser.parse_args()

    commands = {
        "train": cmd_train,
        "evaluate": cmd_evaluate,
        "mismatch": cmd_mismatch,
        "gate-ablation": cmd_gate_ablation,
        "visualize": cmd_visualize,
        "run-all": cmd_run_all,
    }

    if args.command is None:
        parser.print_help()
        sys.exit(1)

    commands[args.command](args)


if __name__ == "__main__":
    main()
