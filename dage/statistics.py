"""Statistical utilities: Wilson score intervals, paired bootstrap (Section V-D)."""

from __future__ import annotations

import numpy as np


def wilson_score_interval(
    successes: int, trials: int, z: float = 1.96,
) -> tuple[float, float]:
    """Wilson score confidence interval for a binomial proportion [19].

    Better behaved than the normal approximation near 0 and 1.
    """
    if trials == 0:
        return (0.0, 0.0)
    p_hat = successes / trials
    denom = 1 + z ** 2 / trials
    centre = (p_hat + z ** 2 / (2 * trials)) / denom
    spread = z * np.sqrt(p_hat * (1 - p_hat) / trials + z ** 2 / (4 * trials ** 2)) / denom
    lo = max(0.0, centre - spread)
    hi = min(1.0, centre + spread)
    return (lo, hi)


def paired_bootstrap_ci(
    a: np.ndarray,
    b: np.ndarray,
    n_bootstrap: int = 20_000,
    alpha: float = 0.05,
    rng: np.random.Generator | None = None,
) -> tuple[float, float, float, float]:
    """Paired bootstrap confidence interval for mean(a) - mean(b) [20].

    Returns:
        (mean_diff, ci_lo, ci_hi, p_value)
    """
    rng = rng or np.random.default_rng(42)
    n = len(a)
    assert len(b) == n
    diff = a - b
    observed_mean = np.mean(diff)

    boot_means = np.empty(n_bootstrap)
    for i in range(n_bootstrap):
        idx = rng.integers(0, n, n)
        boot_means[i] = np.mean(diff[idx])

    ci_lo = np.percentile(boot_means, 100 * alpha / 2)
    ci_hi = np.percentile(boot_means, 100 * (1 - alpha / 2))

    # Two-sided p-value (fraction of bootstrap samples crossing zero)
    if observed_mean >= 0:
        p_value = 2.0 * np.mean(boot_means <= 0)
    else:
        p_value = 2.0 * np.mean(boot_means >= 0)
    p_value = min(p_value, 1.0)

    return float(observed_mean), float(ci_lo), float(ci_hi), float(p_value)


def mean_ci(values: np.ndarray, alpha: float = 0.05) -> tuple[float, float, float]:
    """Mean with 95% confidence interval (normal approximation)."""
    n = len(values)
    mu = np.mean(values)
    se = np.std(values, ddof=1) / np.sqrt(n)
    z = 1.96
    return float(mu), float(mu - z * se), float(mu + z * se)
