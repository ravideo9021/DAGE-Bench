"""Tests for statistical utilities."""

import numpy as np
import pytest

from dage.statistics import wilson_score_interval, mean_ci, paired_bootstrap_ci


class TestWilsonScore:
    def test_all_success(self):
        lo, hi = wilson_score_interval(100, 100)
        assert lo > 0.95
        assert hi > 0.99

    def test_all_failure(self):
        lo, hi = wilson_score_interval(0, 100)
        assert lo == 0.0
        assert hi < 0.05

    def test_half_and_half(self):
        lo, hi = wilson_score_interval(50, 100)
        assert 0.35 < lo < 0.50
        assert 0.50 < hi < 0.65

    def test_ordering(self):
        lo, hi = wilson_score_interval(75, 100)
        assert lo < 0.75 < hi

    def test_single_trial(self):
        lo, hi = wilson_score_interval(1, 1)
        assert lo > 0
        assert hi == 1.0


class TestMeanCI:
    def test_known_distribution(self):
        rng = np.random.default_rng(42)
        data = rng.normal(5.0, 1.0, 1000)
        mean, lo, hi = mean_ci(data)
        assert 4.8 < mean < 5.2
        assert lo < mean < hi

    def test_narrow_ci_with_many_samples(self):
        data = np.ones(10000) * 3.0 + np.random.default_rng(0).normal(0, 0.01, 10000)
        _, lo, hi = mean_ci(data)
        assert hi - lo < 0.01


class TestPairedBootstrap:
    def test_significant_difference(self):
        rng = np.random.default_rng(42)
        a = rng.normal(10.0, 1.0, 200)
        b = rng.normal(12.0, 1.0, 200)
        diff, lo, hi, p = paired_bootstrap_ci(a, b, rng=np.random.default_rng(42))
        assert lo < 0

    def test_no_difference(self):
        rng = np.random.default_rng(42)
        a = rng.normal(10.0, 1.0, 200)
        b = rng.normal(10.0, 1.0, 200)
        diff, lo, hi, p = paired_bootstrap_ci(a, b, rng=np.random.default_rng(42))
        assert lo < 0 < hi
