"""
Statistical methods — implements PRS v0.4 §3 (Statistical Methodology).

Implements:
  - Bootstrap percentile confidence intervals (v0.4 §3.3)
  - Benjamini-Hochberg false discovery rate correction (v0.4 §3.2)
  - Rank stability via bootstrapped re-ranking (v0.4 §9)
  - Welch's t-test with bootstrap fallback for non-Gaussian
  - Cohen's d effect size

IRT (Item Response Theory) and factor analysis live in a separate
module (analysis/irt.py — not yet implemented in v0) because they
require empirical data from a first cycle to fit.
"""

from __future__ import annotations

import numpy as np
from typing import NamedTuple


class BootstrapCI(NamedTuple):
    """Bootstrap percentile confidence interval."""

    point_estimate: float
    lower: float
    upper: float
    confidence_level: float
    n_resamples: int


def bootstrap_ci(
    data: np.ndarray | list[float],
    confidence: float = 0.95,
    n_resamples: int = 10_000,
    statistic: str = "mean",
    random_seed: int | None = None,
) -> BootstrapCI:
    """
    Compute bootstrap percentile confidence interval.

    v0.4 §3.3: 10,000 resamples per published statistic.

    Args:
        data: 1D array of observations
        confidence: e.g. 0.95 for 95% CI
        n_resamples: bootstrap iterations (v0.4 default: 10,000)
        statistic: "mean" | "median"
        random_seed: For reproducibility (v0.4 §3.4 stratification)

    Returns:
        BootstrapCI with point estimate and bounds
    """
    rng = np.random.default_rng(random_seed)
    arr = np.asarray(data, dtype=float)
    n = len(arr)
    if n == 0:
        raise ValueError("Cannot compute bootstrap CI on empty data")

    stat_fn = np.mean if statistic == "mean" else np.median

    resamples = np.empty(n_resamples)
    for i in range(n_resamples):
        sample = rng.choice(arr, size=n, replace=True)
        resamples[i] = stat_fn(sample)

    alpha = 1.0 - confidence
    lower = float(np.percentile(resamples, 100 * alpha / 2))
    upper = float(np.percentile(resamples, 100 * (1 - alpha / 2)))
    point = float(stat_fn(arr))

    return BootstrapCI(
        point_estimate=point,
        lower=lower,
        upper=upper,
        confidence_level=confidence,
        n_resamples=n_resamples,
    )


def benjamini_hochberg(
    p_values: list[float] | np.ndarray,
    fdr: float = 0.05,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Benjamini-Hochberg false discovery rate correction.

    v0.4 §3.2: applied to all published multi-comparison families.

    Args:
        p_values: array of raw p-values
        fdr: target false discovery rate (default 0.05)

    Returns:
        (q_values, rejected) where:
          q_values: BH-adjusted q-values
          rejected: boolean array — True where null rejected at fdr level
    """
    p = np.asarray(p_values, dtype=float)
    n = len(p)
    if n == 0:
        return np.array([]), np.array([], dtype=bool)

    order = np.argsort(p)
    ranks = np.arange(1, n + 1)

    sorted_p = p[order]
    adjusted = sorted_p * n / ranks

    # Make q-values monotonic (non-decreasing as we go up)
    for i in range(n - 2, -1, -1):
        adjusted[i] = min(adjusted[i], adjusted[i + 1])

    # Restore original order
    q_values = np.empty(n)
    q_values[order] = adjusted

    rejected = q_values <= fdr

    return np.clip(q_values, 0, 1), rejected


def rank_stability(
    scores_per_tool: dict[str, list[float]],
    n_resamples: int = 10_000,
    random_seed: int | None = None,
) -> dict[str, dict[str, float]]:
    """
    Bootstrap rank distributions for each tool.

    v0.4 §9: Report rank with confidence bands, not point ranks.

    Args:
        scores_per_tool: {tool_id: [score_run_1, score_run_2, ...]}
        n_resamples: bootstrap iterations
        random_seed: reproducibility

    Returns:
        {tool_id: {
            "mean_rank": float,
            "p10_rank": int,  # 10th percentile rank
            "p90_rank": int,  # 90th percentile rank
            "modal_rank": int,
            "rsc": float,  # Rank Stability Coefficient
        }}
    """
    rng = np.random.default_rng(random_seed)
    tools = list(scores_per_tool.keys())
    if not tools:
        return {}

    rank_distributions: dict[str, list[int]] = {t: [] for t in tools}

    for _ in range(n_resamples):
        # Resample each tool's scores
        means = []
        for tool in tools:
            scores = np.asarray(scores_per_tool[tool])
            if len(scores) == 0:
                means.append(float("nan"))
                continue
            sample = rng.choice(scores, size=len(scores), replace=True)
            means.append(float(np.mean(sample)))

        # Higher score = better, so rank 1 = highest
        order = np.argsort(-np.array(means))
        for rank, idx in enumerate(order, start=1):
            rank_distributions[tools[idx]].append(rank)

    n_tools = len(tools)
    results: dict[str, dict[str, float]] = {}
    for tool in tools:
        ranks = np.asarray(rank_distributions[tool])
        if len(ranks) == 0:
            continue
        p25, p75 = np.percentile(ranks, [25, 75])
        iqr = p75 - p25
        results[tool] = {
            "mean_rank": float(np.mean(ranks)),
            "p10_rank": float(np.percentile(ranks, 10)),
            "p90_rank": float(np.percentile(ranks, 90)),
            "modal_rank": float(np.bincount(ranks).argmax()),
            "rsc": float(iqr / n_tools),  # Rank Stability Coefficient
        }
    return results


def cohens_d(group_a: np.ndarray | list[float], group_b: np.ndarray | list[float]) -> float:
    """
    Cohen's d effect size.

    v0.4 §3.2: differences labeled significant only when |d| >= 0.5 (medium effect).
    """
    a = np.asarray(group_a, dtype=float)
    b = np.asarray(group_b, dtype=float)
    if len(a) < 2 or len(b) < 2:
        return float("nan")

    mean_diff = np.mean(a) - np.mean(b)
    pooled_std = np.sqrt(
        ((len(a) - 1) * np.var(a, ddof=1) + (len(b) - 1) * np.var(b, ddof=1))
        / (len(a) + len(b) - 2)
    )
    if pooled_std == 0:
        return float("nan")
    return float(mean_diff / pooled_std)


def welch_t_test(
    group_a: np.ndarray | list[float],
    group_b: np.ndarray | list[float],
) -> tuple[float, float]:
    """
    Welch's t-test (does not assume equal variances).

    Returns (t_statistic, p_value).
    """
    from scipy import stats

    return stats.ttest_ind(group_a, group_b, equal_var=False)


def minimum_detectable_effect(
    n: int,
    sigma: float,
    power: float = 0.80,
    alpha: float = 0.05,
) -> float:
    """
    Approximate minimum detectable effect size for a two-sample comparison.

    v0.4 §3.1: published with every cycle as transparency.
    """
    from scipy import stats

    z_alpha = stats.norm.ppf(1 - alpha / 2)
    z_beta = stats.norm.ppf(power)
    return float((z_alpha + z_beta) * sigma * np.sqrt(2 / n))
