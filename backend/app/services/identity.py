"""Sample identity resolution for Apollo and CE samples."""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional


@dataclass
class SampleIdentity:
    parent_sample: Optional[str]
    subsample: Optional[str]
    confidence: str  # high, medium, low, unknown
    raw_name: str
    rules_applied: list[str]


def identify_apollo_sample(name: str) -> SampleIdentity:
    """Parse Apollo sample name into parent/subsample.

    Rules:
    - "74235,62" or "74235, 41" → parent=74235, subsample=62/41
    - "742350" does NOT belong to 74235
    - "15426/27" → parent=None (ambiguous split not applied)
    """
    name = name.strip()
    rules = []

    comma_match = re.match(r"^(\d{4,5})\s*,\s*(\w+)$", name)
    if comma_match:
        parent = comma_match.group(1)
        sub = comma_match.group(2)
        rules.append("comma_separated_subsample")
        return SampleIdentity(parent, sub, "high", name, rules)

    slash_match = re.match(r"^(\d+)/(\d+)$", name)
    if slash_match:
        rules.append("slash_range_not_split")
        return SampleIdentity(None, None, "low", name, rules)

    if re.match(r"^\d{4,5}$", name):
        rules.append("bare_number")
        return SampleIdentity(name, None, "medium", name, rules)

    rules.append("unrecognized_format")
    return SampleIdentity(None, None, "unknown", name, rules)


def identify_ce_sample(name: str) -> SampleIdentity:
    """Parse CE sample name.

    Rules:
    - "CE6-129-PX - 1" → mission=CE6, parent=CE6-129, phase=PX, spot=1
    - All original name preserved
    """
    name = name.strip()
    rules = []

    ce_match = re.match(r"^(CE[56])-(\d+)(?:-(\w+))?\s*(?:-\s*(\d+))?$", name, re.IGNORECASE)
    if ce_match:
        mission = ce_match.group(1).upper()
        num = ce_match.group(2)
        phase = ce_match.group(3) or ""
        spot = ce_match.group(4) or ""
        parent = f"{mission}-{num}"
        rules.append("ce_pattern")
        return SampleIdentity(parent, spot or None, "medium", name, rules)

    rules.append("unrecognized_ce_format")
    return SampleIdentity(None, None, "unknown", name, rules)


def classify_material(raw_value: str, rock_type: str = "",
                      phase: str = "") -> tuple[str, str, list[str]]:
    """Classify analyzed material type.

    Returns (material_type, mineral_group, rules_applied).
    """
    raw_upper = raw_value.upper().strip()
    rules = []

    material_map = {
        "WHOLE ROCK": "whole_rock",
        "WR": "whole_rock",
        "BULK ROCK": "whole_rock",
        "MINERAL": "mineral",
        "MIN": "mineral",
        "GLASS": "glass",
        "GL": "glass",
        "K-GLASS": "glass",
        "SOIL": "soil",
        "CLAST": "clast",
        "BRECCIA": "clast",
    }

    mineral_map = {
        "PYROXENE": "pyroxene",
        "PX": "pyroxene",
        "PY": "pyroxene",
        "AUGITE": "pyroxene",
        "AUG": "pyroxene",
        "ORTHOPIROXENE": "pyroxene",
        "OPX": "pyroxene",
        "CLINOPYROXENE": "pyroxene",
        "CPX": "pyroxene",
        "PLAGIOCLASE": "plagioclase",
        "PL": "plagioclase",
        "PLG": "plagioclase",
        "ANORTHITE": "plagioclase",
        "OLIVINE": "olivine",
        "OL": "olivine",
        "OLV": "olivine",
        "OXIDE": "oxide",
        "ILMENITE": "oxide",
        "SPINEL": "oxide",
        "ULVOSP": "oxide",
        "PHOSPHATE": "phosphate",
        "APATITE": "phosphate",
        "MERILLITE": "phosphate",
    }

    for key, mat in material_map.items():
        if raw_upper == key or raw_upper.startswith(key):
            rules.append(f"material_match:{key}")
            mineral_group = "unknown"
            if phase:
                for pk, mg in mineral_map.items():
                    if phase.upper() == pk or phase.upper().startswith(pk):
                        mineral_group = mg
                        rules.append(f"mineral_from_phase:{pk}")
                        break
            return mat, mineral_group, rules

    for key, mg in mineral_map.items():
        if raw_upper == key or raw_upper.startswith(key):
            rules.append(f"mineral_match:{key}")
            return "mineral", mg, rules

    rules.append("unknown_material")
    return "unknown", "unknown", rules
