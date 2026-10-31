"""Scientific calculation tests using numeric oracles from evidence/numeric_oracles.json.

Tolerances: rtol=1e-10, atol=1e-12.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

from app.services.calculations import (
    CalcResult,
    convert_concentration,
    element_to_oxide,
    eu_anomaly_geometric,
    normalize,
    normalized_absolute_uncertainty,
    normalized_ratio,
    ratio,
    ratio_uncertainty_independent,
)

ORACLES_PATH = Path(__file__).parent.parent.parent.parent / "docs" / "geochem-plotter" / "evidence" / "numeric_oracles.json"


@pytest.fixture
def oracles():
    if not ORACLES_PATH.exists():
        pytest.skip(f"Oracle file not found: {ORACLES_PATH}")
    return json.loads(ORACLES_PATH.read_text(encoding="utf-8"))


RTOL = 1e-10
ATOL = 1e-12


class TestNormalize:
    def test_c01_la_ppm(self, oracles):
        case = next(c for c in oracles["cases"] if c["id"] == "C01")
        result = normalize(case["value"], case["unit"], case["reference"], case["reference_unit"])
        assert result.ok
        assert result.value == pytest.approx(case["expected"], rel=RTOL, abs=ATOL)

    def test_c02_la_ppb_to_ppm(self, oracles):
        case = next(c for c in oracles["cases"] if c["id"] == "C02")
        result = normalize(case["value"], case["unit"], case["reference"], case["reference_unit"])
        assert result.ok
        assert result.value == pytest.approx(case["expected"], rel=RTOL, abs=ATOL)

    def test_c06_no_double_normalization(self):
        already_normalized = 10.0
        result = normalize(already_normalized, "dimensionless", 0.237, "ppm")
        assert not result.ok
        assert "REFERENCE_INVALID" not in result.reasons or result.value is None

    def test_c07a_zero_denominator(self, oracles):
        case = next(c for c in oracles["cases"] if c["id"] == "C07a")
        result = ratio(case["a"], case["a_unit"], case["b"], case["b_unit"])
        assert result.value is None
        assert "ZERO_DENOMINATOR" in result.reasons

    def test_c07b_zero_reference(self, oracles):
        case = next(c for c in oracles["cases"] if c["id"] == "C07b")
        result = normalize(case["value"], case["unit"], case["reference"], case["reference_unit"])
        assert result.value is None
        assert "REFERENCE_INVALID" in result.reasons


class TestRatio:
    def test_c03_rb_sr(self, oracles):
        case = next(c for c in oracles["cases"] if c["id"] == "C03")
        result = ratio(case["a"], case["a_unit"], case["b"], case["b_unit"])
        assert result.ok
        assert result.value == pytest.approx(case["expected"], rel=RTOL, abs=ATOL)

    def test_c04_normalized_ratio(self, oracles):
        case = next(c for c in oracles["cases"] if c["id"] == "C04")
        result = normalized_ratio(
            case["a"], case["unit"], case["b"], case["unit"],
            case["a_reference"], "ppm", case["b_reference"], "ppm",
        )
        assert result.ok
        assert result.value == pytest.approx(case["expected"], rel=RTOL, abs=ATOL)

    def test_c05_trace_row2(self, oracles):
        case = next(c for c in oracles["cases"] if c["id"] == "C05")
        unit = "ppm"
        result = normalized_ratio(
            case["a"], unit, case["b"], unit,
            case["a_reference"], unit, case["b_reference"], unit,
        )
        assert result.ok
        assert result.value == pytest.approx(case["expected"], rel=RTOL, abs=ATOL)


class TestUnitConversion:
    def test_c10_wt_ppm(self, oracles):
        result = convert_concentration(1.0, "wt%", "ppm")
        assert result.ok
        assert result.value == pytest.approx(10000.0, rel=RTOL)

    def test_ppm_ppb(self):
        result = convert_concentration(1.0, "ppm", "ppb")
        assert result.ok
        assert result.value == pytest.approx(1000.0, rel=RTOL)

    def test_ppb_ppm(self):
        result = convert_concentration(1000.0, "ppb", "ppm")
        assert result.ok
        assert result.value == pytest.approx(1.0, rel=RTOL)


class TestUncertainty:
    def test_c13_normalized_absolute(self, oracles):
        case = next(c for c in oracles["cases"] if c["id"] == "C13")
        result = normalized_absolute_uncertainty(case["uncertainty"], case["reference"])
        assert result.ok
        assert result.value == pytest.approx(case["expected"], rel=RTOL, abs=ATOL)

    def test_c14_independent_ratio(self, oracles):
        case = next(c for c in oracles["cases"] if c["id"] == "C14")
        result = ratio_uncertainty_independent(
            case["a"], case["b"], case["ua"], case["ub"]
        )
        assert result.ok
        assert result.value == pytest.approx(case["expected"], rel=RTOL, abs=ATOL)


class TestEuAnomaly:
    def test_c16_eu_eu_star(self, oracles):
        case = next(c for c in oracles["cases"] if c["id"] == "C16")
        result = eu_anomaly_geometric(case["sm_n"], case["gd_n"], case["eu_n"])
        assert result.ok
        assert result.value == pytest.approx(case["expected"], rel=RTOL, abs=ATOL)


class TestStoichiometry:
    def test_si_to_sio2(self):
        result = element_to_oxide(10000.0, "Si", "SiO2")
        assert result.ok
        expected = 10000.0 / 10000.0 * 60.084 / (1 * 28.086)
        assert result.value == pytest.approx(expected, rel=RTOL)

    def test_na_to_na2o(self):
        result = element_to_oxide(10000.0, "Na", "Na2O")
        assert result.ok
        expected = 10000.0 / 10000.0 * 61.979 / (2 * 22.990)
        assert result.value == pytest.approx(expected, rel=RTOL)


class TestEdgeCases:
    def test_none_value(self):
        result = normalize(None, "ppm", 0.237, "ppm")
        assert result.value is None
        assert "MISSING_VALUE" in result.reasons

    def test_negative_reference(self):
        result = normalize(2.37, "ppm", -0.237, "ppm")
        assert result.value is None
        assert "REFERENCE_INVALID" in result.reasons

    def test_inf_value(self):
        result = normalize(float("inf"), "ppm", 0.237, "ppm")
        assert result.value is None
        assert "NON_FINITE_VALUE" in result.reasons
