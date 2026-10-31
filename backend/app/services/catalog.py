"""Built-in data catalog service.

Provides 6 catalog items, 2 named reference compositions, and import templates.
"""
from __future__ import annotations

import csv
import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

RESOURCES_DIR = Path(__file__).parent.parent / "resources"
REFERENCES_DIR = RESOURCES_DIR / "references"


@dataclass
class CatalogItem:
    data_id: str
    display_name: str
    source_sheet: str
    physical_rows: int
    role: str
    default_visible: bool
    notes: str = ""


@dataclass
class ReferenceComposition:
    ref_id: str
    version: str
    citation: str
    doi: str
    elements: dict[str, float]
    units: dict[str, str]
    sha256: str
    source_file: str


@dataclass
class Catalog:
    items: list[CatalogItem] = field(default_factory=list)
    references: dict[str, ReferenceComposition] = field(default_factory=dict)
    attached: dict[str, bool] = field(default_factory=dict)

    def get_item(self, data_id: str) -> Optional[CatalogItem]:
        for item in self.items:
            if item.data_id == data_id:
                return item
        return None

    def get_reference(self, ref_id: str) -> Optional[ReferenceComposition]:
        return self.references.get(ref_id)


def _load_reference_csv(path: Path) -> dict[str, Any]:
    elements = {}
    units = {}
    citation = ""
    doi = ""
    ref_id = ""
    with open(path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            elem = row["element"].strip()
            elements[elem] = float(row["value"])
            units[elem] = row["unit"].strip()
            if not ref_id:
                ref_id = row["reference_id"].strip()
            if not doi:
                doi = row.get("doi", "").strip()
    sha256 = hashlib.sha256(path.read_bytes()).hexdigest()
    return {
        "ref_id": ref_id,
        "elements": elements,
        "units": units,
        "doi": doi,
        "sha256": sha256,
        "source_file": path.name,
    }


def build_catalog() -> Catalog:
    """Build the built-in catalog with 6 data items and 2 reference compositions."""
    catalog = Catalog()

    catalog.items = [
        CatalogItem(
            data_id="lunar_apollo_0910",
            display_name="Apollo文献数据",
            source_sheet="Apollo数据",
            physical_rows=35802,
            role="literature",
            default_visible=False,
        ),
        CatalogItem(
            data_id="lunar_ce_0910",
            display_name="嫦娥文献数据",
            source_sheet="嫦娥搜集数据",
            physical_rows=8348,
            role="literature",
            default_visible=False,
            notes="CE5=6436, CE6=1907; 5条任务说明行不当样品",
        ),
        CatalogItem(
            data_id="own_summary_0910",
            display_name="我的实验数据·汇总",
            source_sheet="实验数据汇总",
            physical_rows=259,
            role="own",
            default_visible=True,
        ),
        CatalogItem(
            data_id="own_raw_0910",
            display_name="我的实验数据·原始",
            source_sheet="原始实验数据_合并",
            physical_rows=374,
            role="own",
            default_visible=False,
            notes="第75行重复表头跳过",
        ),
        CatalogItem(
            data_id="ce_trace_view_0910",
            display_name="嫦娥微量元素视图",
            source_sheet="CE with trace ele",
            physical_rows=535,
            role="derived_view",
            default_visible=False,
            notes="派生视图，关联主表；不能作为535条新分析与主表叠加",
        ),
        CatalogItem(
            data_id="workbook_custom_ree_v1",
            display_name="工作簿自定义REE标准",
            source_sheet="Normalization value",
            physical_rows=14,
            role="reference",
            default_visible=True,
            notes="来源保留自定义，单位单独确认",
        ),
    ]

    chondrite_path = REFERENCES_DIR / "Chondrite_MS95_v1.csv"
    if chondrite_path.exists():
        data = _load_reference_csv(chondrite_path)
        catalog.references["Chondrite_MS95"] = ReferenceComposition(
            ref_id="Chondrite_MS95",
            version="1",
            citation="McDonough & Sun (1995), The composition of the Earth",
            doi=data["doi"],
            elements=data["elements"],
            units=data["units"],
            sha256=data["sha256"],
            source_file=data["source_file"],
        )

    pm_path = REFERENCES_DIR / "PM_SM89_v1.csv"
    if pm_path.exists():
        data = _load_reference_csv(pm_path)
        catalog.references["PM_SM89"] = ReferenceComposition(
            ref_id="PM_SM89",
            version="1",
            citation="Sun & McDonough (1989)",
            doi=data["doi"],
            elements=data["elements"],
            units=data["units"],
            sha256=data["sha256"],
            source_file=data["source_file"],
        )

    return catalog


def attach_catalog_item(catalog: Catalog, data_id: str, project_id: str) -> bool:
    """Attach a built-in catalog item to a project. Idempotent."""
    item = catalog.get_item(data_id)
    if item is None:
        return False
    key = f"{project_id}:{data_id}"
    if key in catalog.attached:
        return True
    catalog.attached[key] = True
    return True


def get_builtin_response(catalog: Catalog) -> dict[str, Any]:
    """Build the GET /catalog/builtin response."""
    return {
        "catalog_items": [
            {
                "data_id": item.data_id,
                "display_name": item.display_name,
                "source_sheet": item.source_sheet,
                "physical_rows": item.physical_rows,
                "role": item.role,
                "default_visible": item.default_visible,
                "notes": item.notes,
            }
            for item in catalog.items
        ],
        "references": [
            {
                "ref_id": ref.ref_id,
                "version": ref.version,
                "citation": ref.citation,
                "doi": ref.doi,
                "element_count": len(ref.elements),
                "sha256": ref.sha256,
                "source_file": ref.source_file,
            }
            for ref in catalog.references.values()
        ],
        "registered_versions": [],
        "pending_confirmations": [],
    }
