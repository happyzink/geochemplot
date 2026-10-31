"""Unit conversion and scientific calculation kernel.

All calculations use double precision. Tolerances: rtol=1e-10, atol=1e-12.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional

ATOMIC_WEIGHTS = {
    "Li": 6.941, "Na": 22.990, "Mg": 24.305, "Al": 26.982, "Si": 28.086,
    "K": 39.098, "Ca": 40.078, "Ti": 47.867, "Mn": 54.938, "Fe": 55.845,
    "La": 138.905, "Ce": 140.116, "Pr": 140.908, "Nd": 144.242, "Sm": 150.36,
    "Eu": 151.964, "Gd": 157.25, "Tb": 158.925, "Dy": 162.500, "Ho": 164.930,
    "Er": 167.259, "Tm": 168.934, "Yb": 173.045, "Lu": 174.967,
    "Rb": 85.468, "Sr": 87.62, "Ba": 137.327, "Zr": 91.224, "Hf": 178.49,
    "Nb": 92.906, "Ta": 180.948, "Th": 232.038, "U": 238.029, "Pb": 207.2,
    "Cs": 132.905, "Y": 88.906, "Ti": 47.867,
}

OXIDE_MOLAR_MASS = {
    "SiO2": 60.084, "TiO2": 79.866, "Al2O3": 101.961, "FeO": 71.844,
    "Fe2O3": 159.687, "FeOT": 71.844, "MnO": 70.937, "MgO": 40.304,
    "CaO": 56.077, "Na2O": 61.979, "K2O": 94.196, "P2O5": 141.944,
    "Cr2O3": 151.990, "NiO": 74.692, "H2O": 18.015, "CO2": 44.009,
}


@dataclass(frozen=True)
class CalcResult:
    value: Optional[float]
    unit: str
    reasons: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return self.value is not None and len(self.reasons) == 0


def convert_concentration(value: float, from_unit: str, to_unit: str) -> CalcResult:
    """Convert between ppm, ppb, wt% for the same chemical quantity."""
    if from_unit == to_unit:
        return CalcResult(value, to_unit)

    conversions = {
        ("ppm", "ppb"): 1000.0,
        ("ppb", "ppm"): 0.001,
        ("ppm", "wt%"): 0.0001,
        ("wt%", "ppm"): 10000.0,
        ("ppb", "wt%"): 1e-7,
        ("wt%", "ppb"): 1e7,
    }
    key = (from_unit, to_unit)
    if key in conversions:
        return CalcResult(value * conversions[key], to_unit)
    return CalcResult(None, to_unit, [f"UNSUPPORTED_CONVERSION:{from_unit}->{to_unit}"])


def element_to_oxide(element_ppm: float, element: str, oxide: str) -> CalcResult:
    """Convert element ppm to oxide wt% using stoichiometry.

    oxide_wt_pct = element_ppm / 10000 * M(oxide) / (n * M(element))
    """
    if element not in ATOMIC_WEIGHTS:
        return CalcResult(None, "wt%", [f"UNKNOWN_ELEMENT:{element}"])
    if oxide not in OXIDE_MOLAR_MASS:
        return CalcResult(None, "wt%", [f"UNKNOWN_OXIDE:{oxide}"])

    n_atoms = _oxide_element_count(oxide, element)
    if n_atoms == 0:
        return CalcResult(None, "wt%", [f"ELEMENT_NOT_IN_OXIDE:{element} in {oxide}"])

    mw_oxide = OXIDE_MOLAR_MASS[oxide]
    mw_element = ATOMIC_WEIGHTS[element]
    result = element_ppm / 10000.0 * mw_oxide / (n_atoms * mw_element)
    return CalcResult(result, "wt%")


def _oxide_element_count(oxide: str, element: str) -> int:
    """Get the number of atoms of element in oxide formula."""
    mapping = {
        ("SiO2", "Si"): 1, ("TiO2", "Ti"): 1, ("Al2O3", "Al"): 2,
        ("FeO", "Fe"): 1, ("Fe2O3", "Fe"): 2, ("FeOT", "Fe"): 1,
        ("MnO", "Mn"): 1, ("MgO", "Mg"): 1, ("CaO", "Ca"): 1,
        ("Na2O", "Na"): 2, ("K2O", "K"): 2, ("P2O5", "P"): 2,
    }
    return mapping.get((oxide, element), 0)


def normalize(value: Optional[float], value_unit: str,
              reference: Optional[float], reference_unit: str) -> CalcResult:
    """Normalize a concentration: E_N = C_E / R_E.

    Both must be converted to the same unit first.
    """
    if value is None:
        return CalcResult(None, "dimensionless", ["MISSING_VALUE"])
    if reference is None:
        return CalcResult(None, "dimensionless", ["MISSING_REFERENCE"])
    if reference <= 0:
        return CalcResult(None, "dimensionless", ["REFERENCE_INVALID"])
    if not math.isfinite(value) or not math.isfinite(reference):
        return CalcResult(None, "dimensionless", ["NON_FINITE_VALUE"])

    conv = convert_concentration(reference, reference_unit, value_unit)
    if not conv.ok:
        return CalcResult(None, "dimensionless", conv.reasons)
    ref_converted = conv.value

    result = value / ref_converted
    return CalcResult(result, "dimensionless")


def ratio(a: Optional[float], a_unit: str,
          b: Optional[float], b_unit: str) -> CalcResult:
    """Compute element ratio A/B. Both must be in the same unit."""
    if a is None:
        return CalcResult(None, "dimensionless", ["MISSING_NUMERATOR"])
    if b is None:
        return CalcResult(None, "dimensionless", ["MISSING_DENOMINATOR"])
    if b == 0:
        return CalcResult(None, "dimensionless", ["ZERO_DENOMINATOR"])
    if not math.isfinite(a) or not math.isfinite(b):
        return CalcResult(None, "dimensionless", ["NON_FINITE_VALUE"])
    if a_unit != b_unit:
        conv = convert_concentration(b, b_unit, a_unit)
        if not conv.ok:
            return CalcResult(None, "dimensionless", conv.reasons + ["UNIT_MISMATCH"])
        b = conv.value

    return CalcResult(a / b, "dimensionless")


def normalized_ratio(a: Optional[float], a_unit: str,
                     b: Optional[float], b_unit: str,
                     ref_a: Optional[float], ref_a_unit: str,
                     ref_b: Optional[float], ref_b_unit: str) -> CalcResult:
    """Compute (A/B)_N = (C_A/R_A) / (C_B/R_B)."""
    norm_a = normalize(a, a_unit, ref_a, ref_a_unit)
    if not norm_a.ok:
        return CalcResult(None, "dimensionless", norm_a.reasons + ["NUMERATOR_NORMALIZE_FAILED"])
    norm_b = normalize(b, b_unit, ref_b, ref_b_unit)
    if not norm_b.ok:
        return CalcResult(None, "dimensionless", norm_b.reasons + ["DENOMINATOR_NORMALIZE_FAILED"])
    if norm_b.value == 0:
        return CalcResult(None, "dimensionless", ["ZERO_DENOMINATOR"])
    return CalcResult(norm_a.value / norm_b.value, "dimensionless")


def eu_anomaly_geometric(sm_n: float, gd_n: float, eu_n: float) -> CalcResult:
    """Eu/Eu* = Eu_N / sqrt(Sm_N * Gd_N)."""
    if sm_n <= 0 or gd_n <= 0:
        return CalcResult(None, "dimensionless", ["NON_POSITIVE_REFERENCE"])
    if eu_n is None:
        return CalcResult(None, "dimensionless", ["MISSING_EU"])
    denom = math.sqrt(sm_n * gd_n)
    if denom == 0:
        return CalcResult(None, "dimensionless", ["ZERO_DENOMINATOR"])
    return CalcResult(eu_n / denom, "dimensionless")


def ratio_uncertainty_independent(a: float, b: float,
                                  ua: float, ub: float) -> CalcResult:
    """u(A/B) = |A/B| * sqrt((uA/A)^2 + (uB/B)^2).

    Requires A, B non-zero and independent errors of same kind.
    """
    if a == 0 or b == 0:
        return CalcResult(None, "dimensionless", ["ZERO_VALUE_IN_RATIO"])
    ratio_val = a / b
    rel_var = (ua / a) ** 2 + (ub / b) ** 2
    return CalcResult(abs(ratio_val) * math.sqrt(rel_var), "dimensionless")


def normalized_absolute_uncertainty(uncertainty: float, reference: float) -> CalcResult:
    """u(C/R) = u(C) / R, assuming R is exact constant."""
    if reference <= 0:
        return CalcResult(None, "dimensionless", ["REFERENCE_INVALID"])
    return CalcResult(uncertainty / reference, "dimensionless")
