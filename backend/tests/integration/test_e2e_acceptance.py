"""端到端验收测试（真实工作簿数据全链路）。

覆盖 HANDOFF P0/P1 与 18 任务书 R20 的自动化固化：
真实 Excel 导入 → 查询/选择集 → REE 标准化计算（参考值 oracle）→
scatter 计算 → 图件保存 → PNG/PDF/SVG + 复现包导出落盘 →
重启恢复（重开数据库连接）→ 按冻结修订重导（快照保护放行）。

数据：仓库根 月球样品数据汇总_all-0910.xlsx 的 'CE with trace ele' 表
（真实 CE5/CE6 数据，主量氧化物 + 14 REE），只导入该表以控制时长。
"""
from __future__ import annotations

import json
import shutil
import tempfile
from pathlib import Path

import pytest

from app.importers.excel_import import import_excel_data
from app.services.catalog import build_catalog
from app.storage.database import Database

REPO_ROOT = Path(__file__).resolve().parents[3]
WORKBOOK = REPO_ROOT / "月球样品数据汇总_all-0910.xlsx"
TRACE_SHEET = "CE with trace ele"
REE14 = ["La", "Ce", "Pr", "Nd", "Sm", "Eu", "Gd", "Tb",
         "Dy", "Ho", "Er", "Tm", "Yb", "Lu"]


def _init_modules(db: Database):
    """把各路由模块绑定到指定数据库（等价于服务启动时的 init_* 调用）。"""
    import app.main as main_mod
    from app.api import (routes_catalog, routes_data, routes_datasets,
                         routes_exports, routes_figures, routes_imports,
                         routes_jobs, routes_plots, routes_projects)
    routes_data.init_routes(db)
    routes_plots.init_plot_routes(db)
    routes_projects.init_project_routes(db)
    routes_catalog.init_catalog_routes()
    routes_imports.init_import_routes(db)
    routes_figures.init_figure_routes(db)
    routes_datasets.init_dataset_routes(db)
    routes_jobs.init_job_routes(db)
    routes_exports.init_export_routes(db)
    main_mod._db = db


def _populate_references(db: Database) -> dict:
    """与 startup_event 相同语义：从内置目录灌入参考值，返回 {ref_id: {analyte: value}}。"""
    catalog = build_catalog()
    refs: dict = {}
    for ref_id, ref in catalog.references.items():
        refs[ref_id] = dict(ref.elements)
        for analyte, value in ref.elements.items():
            db.insert_reference_value(ref_id, ref.version, analyte, value,
                                      ref.units.get(analyte, "ppm"))
    return refs


@pytest.fixture(scope="module")
def e2e():
    if not WORKBOOK.exists():
        pytest.skip(f"真实工作簿不存在: {WORKBOOK}")
    tmpdir = Path(tempfile.mkdtemp(prefix="e2e_accept_"))
    db = Database(tmpdir / "e2e.db")
    imported = import_excel_data(db, WORKBOOK, "1.0", {},
                                 {TRACE_SHEET: {"header_row": 1, "start_row": 2}})
    refs = _populate_references(db)
    _init_modules(db)

    from fastapi.testclient import TestClient
    from app.main import app
    client = TestClient(app)

    export_root = tmpdir / "exports"
    export_root.mkdir()
    ctx = {
        "tmpdir": tmpdir, "db": db, "client": client,
        "imported": imported, "refs": refs, "export_root": export_root,
    }
    yield ctx
    shutil.rmtree(tmpdir, ignore_errors=True)


class TestRealDataImport:
    def test_import_analyses_and_measurements(self, e2e):
        assert e2e["imported"] >= 100, f"真实导入 analysis 数异常: {e2e['imported']}"
        rows = e2e["db"].query_analyses(["1.0"], {}, offset=0, limit=5)
        assert rows, "查询不到真实分析"
        # 真实 CE5/CE6 样品编号形态（如 036-004-py-2）
        assert any("-" in (r.get("sample_id") or "") for r in rows)
        meas = e2e["db"].get_measurements(rows[0]["analysis_id"])
        assert len(meas) >= 5, "真实测量值过少"

    def test_real_ree_analyses_present(self, e2e):
        """至少找到一条含 ≥12 个 REE 的真实分析供后续验收使用。"""
        rows = e2e["db"].query_analyses(["1.0"], {}, offset=0, limit=2000)
        picked = []
        for r in rows:
            meas = e2e["db"].get_measurements(r["analysis_id"])
            elements = {m["analyte"] for m in meas if m.get("value") is not None}
            if len(elements & set(REE14)) >= 12:
                picked.append((r["analysis_id"], meas))
                if len(picked) >= 2:
                    break
        assert len(picked) >= 2, "找不到两条含完整 REE 的真实分析"
        e2e["ree_analyses"] = [p[0] for p in picked]
        e2e["ree_meas"] = picked[0][1]

    def test_duplicate_header_columns_get_distinct_channels(self, e2e):
        """工作簿自带两组同名 REE 列（第二组为预标准化值）→ 通道隔离，不产生同通道假冲突。"""
        meas = e2e["ree_meas"]
        la_records = [m for m in meas if m["analyte"] == "La" and m.get("value") is not None]
        assert len(la_records) >= 2, "真实工作簿应含两组 La 列"
        channels = {m["channel"] for m in la_records}
        assert len(channels) == len(la_records), f"同名列必须通道隔离: {channels}"
        assert "" in channels, "首组必须为主通道"

    def test_classification_facets_and_filter(self, e2e):
        """分类链路：facets 含样品标号组，sample_group/mission 过滤生效。"""
        client = e2e["client"]
        facets = client.post("/api/v1/datasets/facets",
                             json={"dataset_versions": ["1.0"], "filter": {}}).json()
        groups = facets["sample_groups"]
        assert groups, "facets 应含样品标号组"
        assert facets["total_count"] == e2e["imported"]
        # 任务分面按有效分类计数（含样品名兜底），真实 CE 数据应出现 CE5/CE6
        missions = {b["value"] for b in facets["missions"]}
        assert "CE5" in missions or "CE6" in missions

        pick = groups[0]["value"]
        resp = client.post("/api/v1/datasets/query", json={
            "dataset_versions": ["1.0"],
            "filter": {"sample_group": [pick]},
            "limit": 5,
        }).json()
        assert resp["total"] >= 1
        for row in resp["analyses"]:
            assert row["sample_group"] == pick

        # 分析详情带分类证据
        detail = client.get(f"/api/v1/analyses/{resp['analyses'][0]['analysis_id']}").json()
        assert detail["sample_group"] == pick
        fields = {e["field"] for e in detail["classification_evidence"]}
        assert {"sample_group", "mission_class"} <= fields


class TestSelectionAndCompute:
    def test_selection_snapshot(self, e2e):
        ids = e2e["ree_analyses"]
        resp = e2e["client"].post("/api/v1/selections", json={
            "name": "E2E 真实 CE REE",
            "mode": "snapshot",
            "dataset_versions": ["1.0"],
            "analysis_ids": ids,
        })
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["resolved_ids"] == ids
        assert body["total_count"] == len(ids)
        e2e["selection_id"] = body["selection_id"]

    def _ree_spec(self, e2e, request_id):
        return {
            "request_id": request_id,
            "spec": {
                "schema_version": "1.1",
                "plot_id": "e2e_reE",
                "chart_type": "ree",
                "layers": [{"layer_id": "L1", "label": "真实 CE REE",
                            "selection_id": e2e["selection_id"]}],
                "variables": {
                    "elements": REE14,
                    "value_mode": "normalized",
                    "reference_id": "Chondrite_MS95",
                    "reference_version": "1",
                },
            },
        }

    def test_compute_ree_normalized_contract(self, e2e):
        resp = e2e["client"].post("/api/v1/plots/compute",
                                  json=self._ree_spec(e2e, "req_e2e_ree"))
        assert resp.status_code == 200, resp.text
        scene = resp.json()
        # 1.2 合同：直返 Scene（无包装）、request_id 回显
        assert scene["schema_version"] == "1.2"
        assert scene["request_id"] == "req_e2e_ree"
        assert "scene" not in scene or not isinstance(scene.get("scene"), dict)
        # 一 analysis 一曲线
        assert len(scene["series"]) == len(e2e["ree_analyses"])
        e2e["ree_scene"] = scene

    def test_compute_ree_values_match_reference_oracle(self, e2e):
        scene = e2e["ree_scene"]
        ref = e2e["refs"]["Chondrite_MS95"]
        # 按 analysis_id 对齐（series 顺序与选取顺序无关；缺值缺口是正确行为）
        meas_by_analysis = {}
        for aid in e2e["ree_analyses"]:
            for m in e2e["db"].get_measurements(aid):
                if m.get("value") is not None:
                    meas_by_analysis.setdefault(aid, {}).setdefault(m["analyte"], m)
        checked = 0
        for series in scene["series"]:
            assert len(series["points"]) == 14, "每条曲线必须含 14 个元素点"
            for p in series["points"]:
                aid = p.get("analysis_id")
                element = (p.get("provenance") or {}).get("element")
                m = meas_by_analysis.get(aid, {}).get(element)
                if m is None:
                    assert p["y"] is None, f"缺测量值必须留缺口: {aid}/{element}"
                    continue
                expected = m["value"] / ref[element]
                assert p["y"] == pytest.approx(expected, rel=1e-10), \
                    f"{element}: {p['y']} != {expected}"
                checked += 1
        assert checked >= 15, f"oracle 校验点过少: {checked}"

    def test_compute_scatter(self, e2e):
        resp = e2e["client"].post("/api/v1/plots/compute", json={
            "request_id": "req_e2e_scatter",
            "spec": {
                "schema_version": "1.1",
                "plot_id": "e2e_scatter",
                "chart_type": "scatter",
                "layers": [{"layer_id": "L1", "label": "TAS 原料",
                            "selection_id": e2e["selection_id"]}],
                "variables": {
                    "x": {"kind": "measurement", "analyte": "SiO2",
                          "chemical_form": "oxide", "unit": "wt%"},
                    "y": {"kind": "measurement", "analyte": "MgO",
                          "chemical_form": "oxide", "unit": "wt%"},
                },
            },
        })
        assert resp.status_code == 200, resp.text
        scene = resp.json()
        assert scene["request_id"] == "req_e2e_scatter"
        # scatter 每层一条 series（多 analysis 同层聚合），逐点带 analysis_id
        assert len(scene["series"]) == 1
        total_pts = sum(len(s["points"]) for s in scene["series"])
        assert total_pts > 0, "scatter 无任何点"
        covered = {p.get("analysis_id") for s in scene["series"] for p in s["points"]}
        assert covered <= set(e2e["ree_analyses"])


class TestFigureExportAndRecovery:
    def test_create_figure(self, e2e):
        resp = e2e["client"].post("/api/v1/projects/", json={"name": "E2E 验收项目"})
        assert resp.status_code == 200, resp.text
        e2e["project_id"] = resp.json()["project_id"]

        payload = {
            "project_id": e2e["project_id"],
            "label": "E2E 真实 REE 图",
            "plot_spec": {
                "schema_version": "1.1",
                "plot_id": "e2e_fig",
                "chart_type": "ree",
                "layers": [{"layer_id": "L1", "label": "真实 CE REE",
                            "selection_id": e2e["selection_id"]}],
                "variables": {
                    "elements": REE14,
                    "value_mode": "normalized",
                    "reference_id": "Chondrite_MS95",
                    "reference_version": "1",
                },
            },
        }
        resp = e2e["client"].post("/api/v1/figures", json=payload)
        assert resp.status_code in (200, 201), resp.text
        e2e["figure_id"] = resp.json()["figure_id"]
        e2e["figure_scene_hash"] = resp.json()["scene_hash"]

    def test_export_all_formats_with_bundle(self, e2e):
        root_resp = e2e["client"].post("/api/v1/export-roots", json={
            "project_id": e2e["project_id"],
            "absolute_path": str(e2e["export_root"]),
            "display_name": "E2E 导出根",
        })
        assert root_resp.status_code == 200, root_resp.text
        root_id = root_resp.json()["export_root_id"]

        resp = e2e["client"].post("/api/v1/exports", json={
            "figure_id": e2e["figure_id"],
            "formats": ["png", "pdf", "svg"],
            "dpi": 100,
            "include_bundle": True,
            "export_root_id": root_id,
        })
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["state"] == "succeeded"
        e2e["export_id"] = body["export_id"]

        # 10 文件：3 渲染 + 5 复现包 + plot_data.csv + README.md
        files = {f["filename"]: f for f in body["files"]}
        assert {"figure.png", "figure.pdf", "figure.svg",
                "plot_spec.json", "scene.json", "reference_snapshot.json",
                "provenance.json", "font_manifest.json",
                "plot_data.csv", "README.md"} <= set(files)
        for f in body["files"]:
            p = Path(f["absolute_path"])
            assert p.exists() and p.stat().st_size > 0, f"文件缺失/空: {f['filename']}"

        # scene.json 的 scene_hash 与图件冻结哈希一致
        scene_json = json.loads(
            Path(files["scene.json"]["absolute_path"]).read_text(encoding="utf-8"))
        assert scene_json["scene_hash"] == e2e["figure_scene_hash"]
        # CSV 含真实数据行
        csv_text = Path(files["plot_data.csv"]["absolute_path"]).read_text(encoding="utf-8-sig")
        assert len(csv_text.splitlines()) > 1

    def test_restart_recovery_and_reexport(self, e2e):
        """重启恢复：重开数据库连接后选择集/图件/导出记录仍在，重导成功。"""
        db_path = e2e["tmpdir"] / "e2e.db"
        fresh = Database(db_path)
        _init_modules(fresh)
        client = e2e["client"]

        sel = client.get(f"/api/v1/selections/{e2e['selection_id']}")
        assert sel.status_code == 200 and sel.json()["resolved_ids"] == e2e["ree_analyses"]

        fig = client.get(f"/api/v1/figures/{e2e['figure_id']}")
        assert fig.status_code == 200
        assert fig.json()["scene_hash"] == e2e["figure_scene_hash"]

        exp = client.get(f"/api/v1/exports/{e2e['export_id']}")
        assert exp.status_code == 200 and exp.json()["state"] == "succeeded"

        # 按冻结修订重导：快照保护放行（scene_hash 未漂移），产生新 export 记录
        reexp = client.post(f"/api/v1/exports/{e2e['export_id']}/reexport", json={})
        assert reexp.status_code == 200, reexp.text
        new_export_id = reexp.json()["export_id"]
        assert new_export_id
        new_exp = client.get(f"/api/v1/exports/{new_export_id}")
        assert new_exp.status_code == 200
        assert new_exp.json()["state"] == "succeeded"
