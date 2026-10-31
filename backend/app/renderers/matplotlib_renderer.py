"""Matplotlib renderer for publication-quality figures.

Consumes frozen PlotScene; does not query database or compute ratios.
"""
from __future__ import annotations

import hashlib
import json
import textwrap
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.figure import Figure as MplFigure
from matplotlib.backends.backend_pdf import FigureCanvasPdf
from matplotlib.backends.backend_svg import FigureCanvasSVG
from matplotlib.backends.backend_agg import FigureCanvasAgg


@dataclass
class ExportResult:
    path: Path
    format: str
    width_mm: float
    height_mm: float
    dpi: int
    byte_size: int
    sha256: str
    font_manifest: dict[str, Any] = field(default_factory=dict)


MARKER_MAP = {
    "circle": "o",
    "square": "s",
    "triangle_up": "^",
    "triangle_down": "v",
    "diamond": "D",
    "plus": "+",
    "cross": "x",
    "star": "*",
    "hexagon": "h",
}

DASH_MAP = {
    "solid": "-",
    "dash": "--",
    "dot": ":",
    "dashdot": "-.",
}


def _pt_to_in(pt: float) -> float:
    return pt / 72.0


# 用户可写中文（轴标题/注释/图层名），DejaVu 无 CJK 字形会导出成方框。
# matplotlib ≥3.6 支持按字符回退：把已安装的 CJK 字体排在主字体之后即可。
CJK_FONT_CANDIDATES = (
    "Microsoft YaHei",
    "SimHei",
    "SimSun",
    "Noto Sans CJK SC",
    "Source Han Sans SC",
    "PingFang SC",
    "Heiti SC",
    "WenQuanYi Zen Hei",
    "Arial Unicode MS",
)


def _resolve_font_families(primary: Optional[str]) -> list[str]:
    """主字体 + 系统中文字体 + 随包字体 + DejaVu 兜底，供 rcParams["font.family"] 使用。"""
    from matplotlib import font_manager

    installed = {f.name for f in font_manager.fontManager.ttflist}
    families: list[str] = []
    if primary:
        families.append(primary)
    cjk = next((name for name in CJK_FONT_CANDIDATES if name in installed), None)
    if cjk and cjk not in families:
        families.append(cjk)
    bundled = _bundled_cjk_family()
    if bundled and bundled not in families:
        families.append(bundled)
    if "DejaVu Sans" not in families:
        families.append("DejaVu Sans")
    return families


_BUNDLED_FONT_DIR = Path(__file__).resolve().parent / "fonts"
_bundled_family: Optional[str] = None
_bundled_scanned = False


def _bundled_cjk_family() -> Optional[str]:
    """随包字体：扫描 renderers/fonts/ 下的 ttf/otf/ttc 并注册给 matplotlib。

    用于没有系统中文字体的部署环境（极简 Linux 容器）。字体文件需自行放入，
    可运行 scripts/fetch_cjk_font.py 获取 OFL 许可的 Noto Sans CJK SC。
    """
    global _bundled_family, _bundled_scanned
    if _bundled_scanned:
        return _bundled_family
    _bundled_scanned = True
    if not _BUNDLED_FONT_DIR.is_dir():
        return None
    from matplotlib import font_manager

    for path in sorted(_BUNDLED_FONT_DIR.iterdir()):
        if path.suffix.lower() not in (".ttf", ".otf", ".ttc"):
            continue
        try:
            font_manager.fontManager.addfont(str(path))
            _bundled_family = font_manager.FontProperties(fname=str(path)).get_name()
        except Exception:
            continue
        if _bundled_family:
            break
    return _bundled_family


def _mm_to_in(mm: float) -> float:
    return mm / 25.4


def _hex_to_rgba(hex_color: str, alpha: float = 1.0) -> tuple:
    hex_color = hex_color.lstrip("#")
    r = int(hex_color[0:2], 16) / 255.0
    g = int(hex_color[2:4], 16) / 255.0
    b = int(hex_color[4:6], 16) / 255.0
    return (r, g, b, alpha)


def _apply_axis_settings(ax, cfg: dict, axis_name: str, is_curve: bool):
    """应用 Scene 轴设置：比例/范围/反转/刻度（图表默认之后应用，R10/R16）。

    手动范围与反转优先；log 轴范围来自 Scene 正数边界（合同层已校验）。
    """
    scale = cfg.get("scale", "linear")
    setter = ax.set_xscale if axis_name == "x" else ax.set_yscale
    if scale == "log10":
        setter("log")
    elif scale == "linear":
        setter("linear")  # 显式覆盖图表默认（如 REE/spider 默认 log）

    # 刻度先设：log 轴由 matplotlib 生成；曲线 x 轴为元素位置由图表渲染器设置
    ticks = [t for t in (cfg.get("ticks") or []) if isinstance(t, (int, float))]
    if ticks and scale != "log10" and not (is_curve and axis_name == "x"):
        (ax.set_xticks if axis_name == "x" else ax.set_yticks)(ticks)

    # 范围后设（显式范围优先；set_xticks 会把界外刻度扩进范围，故顺序不可反）
    rng = cfg.get("range")
    if isinstance(rng, (list, tuple)) and len(rng) == 2 and rng[0] is not None and rng[1] is not None:
        lo, hi = float(rng[0]), float(rng[1])
        if cfg.get("reversed"):
            lo, hi = hi, lo
        (ax.set_xlim if axis_name == "x" else ax.set_ylim)(lo, hi)


def _scatter_group(ax, xs, ys, style: dict, zorder: int = 3):
    """按样式画一组散点（R15：面积=pt²；点/线 alpha 独立且各只应用一次；空心中心透明）。"""
    marker = MARKER_MAP.get(style.get("marker_shape", "circle"), "o")
    size_pt_sq = float(style.get("marker_size_pt", 3.5)) ** 2
    marker_alpha = style.get("marker_alpha", 1.0)
    edge_width = style.get("marker_edge_width_pt", 0.35)
    fill = style.get("marker_fill", "solid")
    fill_color = style.get("marker_fill_color", "#D55E00")
    edge_color = style.get("marker_edge_color", fill_color)
    # alpha 并入 rgba（只应用一次）；填充与边框独立着色
    mec = _hex_to_rgba(edge_color, marker_alpha)
    if fill == "open":
        ax.scatter(xs, ys, marker=marker, s=size_pt_sq,
                  facecolors="none", edgecolors=[mec],
                  linewidths=edge_width, zorder=zorder)
    else:
        ax.scatter(xs, ys, marker=marker, s=size_pt_sq,
                  c=[_hex_to_rgba(fill_color, marker_alpha)],
                  edgecolors=[mec], linewidths=edge_width, zorder=zorder)


def _group_points_by_resolved_style(points, base_style: dict):
    """点级 resolved_style（analysis 覆盖）分组；无覆盖的点用 series 基线样式。"""
    groups: dict[str, dict] = {}
    for p in points:
        rs = p.get("resolved_style")
        key = json.dumps(rs, sort_keys=True, default=str) if rs else ""
        groups.setdefault(key, {"style": rs if rs else base_style, "pts": []})["pts"].append(p)
    return groups.values()


def _styled_legend_handle(style: dict, show_line: bool, label: str):
    """图例句柄与实际点/线样式一致（R16）。"""
    from matplotlib.lines import Line2D
    marker = MARKER_MAP.get(style.get("marker_shape", "circle"), "o")
    fill = style.get("marker_fill", "solid")
    marker_alpha = style.get("marker_alpha", 1.0)
    line_alpha = style.get("line_alpha", 1.0)
    hollow = fill == "open" and style.get("marker_shape") not in ("plus", "cross")
    fill_color = style.get("marker_fill_color", "#D55E00")
    edge_color = style.get("marker_edge_color", fill_color)
    handle = Line2D(
        [0], [0], marker=marker,
        markerfacecolor="none" if hollow else _hex_to_rgba(fill_color, marker_alpha),
        markeredgecolor=_hex_to_rgba(edge_color, marker_alpha),
        markeredgewidth=style.get("marker_edge_width_pt", 0.35),
        markersize=style.get("marker_size_pt", 3.5),
        color=_hex_to_rgba(style.get("line_color", fill_color), line_alpha) if show_line else "none",
        linestyle=DASH_MAP.get(style.get("line_dash", "solid"), "-"),
        linewidth=style.get("line_width_pt", 0.8),
    )
    handle.set_label(label)
    return handle


def _build_figure(scene_dict: dict, dpi: int = 600, background: str = "white"):
    """构建 Figure+Axes（render_scene 与一致性测试共用）。返回 (fig, ax)。"""
    # 主字体缺失的字形（中文标题/注释/图层名）按字符回退到 CJK 字体
    plt.rcParams["font.family"] = _resolve_font_families(
        (scene_dict.get("layout", {}) or {}).get("font_family")
    )
    width_in = _mm_to_in(scene_dict.get("layout", {}).get("width_mm", 183))
    height_in = _mm_to_in(scene_dict.get("layout", {}).get("height_mm", 110))

    fig = plt.figure(figsize=(width_in, height_in), dpi=dpi)
    ax = fig.add_subplot(111)

    if background == "transparent":
        fig.patch.set_alpha(0.0)
        ax.patch.set_alpha(0.0)
    else:
        fig.patch.set_facecolor("white")
        ax.set_facecolor("white")

    chart_type = scene_dict.get("chart_type", "scatter")
    series_list = scene_dict.get("series", [])
    axes_cfg = scene_dict.get("axes", {})

    # Set axis labels before chart type renderers (renderers can override)
    x_cfg = axes_cfg.get("x", {}) or {}
    y_cfg = axes_cfg.get("y", {}) or {}
    font_size = scene_dict.get("layout", {}).get("font_size_pt", 7)
    ax.set_xlabel(x_cfg.get("label") or "X", fontsize=font_size)
    ax.set_ylabel(y_cfg.get("label") or "Y", fontsize=font_size)

    is_curve = chart_type in ("ree", "spider")
    if chart_type == "scatter":
        _render_scatter(ax, series_list, axes_cfg)
    elif chart_type == "ree":
        _render_ree(ax, series_list, axes_cfg, scene_dict)
    elif chart_type == "spider":
        _render_spider(ax, series_list, axes_cfg, scene_dict)
    elif chart_type == "tas":
        _render_tas(ax, series_list, axes_cfg, scene_dict)

    tick_size = scene_dict.get("layout", {}).get("tick_font_size_pt", 6)
    ax.tick_params(labelsize=tick_size)

    # R10/R16：Scene 轴设置在图表默认之后应用（手动范围/反转/刻度不被默认覆盖）
    _apply_axis_settings(ax, x_cfg, "x", is_curve)
    _apply_axis_settings(ax, y_cfg, "y", is_curve)

    # 图注/注释来自 Scene layout.annotations（含 TAS 模型来源图注）。
    # 锚点=文本左上角（与前端 buildPlotly 的 xanchor=left/yanchor=top 一致，两端同图同位）。
    annotations = scene_dict.get("layout", {}).get("annotations", []) or []
    for ann in annotations:
        text = ann.get("text", "")
        if not text:
            continue
        font_pt = ann.get("font_size_pt", 4.5)
        color = ann.get("color", "#666666")
        fig.text(
            max(0.0, min(1.0, ann.get("anchor_x", 0.0))),
            max(0.0, min(1.0, ann.get("anchor_y", 0.0))),
            text, fontsize=font_pt, color=color,
            ha="left", va="top", wrap=True,
        )

    # 图例：句柄与实际样式一致；位置/计数来自 Scene（顶层 legend 优先，layout.legend 兜底）
    legend_cfg = scene_dict.get("legend") or {}
    layout_cfg = scene_dict.get("layout", {}) or {}
    merged_legend = dict(layout_cfg.get("legend") or {})
    merged_legend.update({k: v for k, v in legend_cfg.items() if v is not None})
    position = merged_legend.get("position") or "right"
    show_counts = legend_cfg.get("show_counts")
    if show_counts is None:
        show_counts = layout_cfg.get("legend_show_counts", False)

    if series_list:
        # REE/蜘蛛图为每个分析生成一条曲线；若逐条列图例会溢出画布，
        # 因此同一 layer 的多条曲线合并为一条图例（标签取图层名，计数取分析数）。
        groups: list[dict[str, Any]] = []
        group_index: dict[str, int] = {}
        for s in series_list:
            lid = s.get("layer_id") or s.get("series_id")
            if lid in group_index:
                groups[group_index[lid]]["analysis_ids"].update(s.get("analysis_ids") or [])
                groups[group_index[lid]]["points"] += len(s.get("points", []))
                continue
            group_index[lid] = len(groups)
            groups.append({
                "series": s,
                "analysis_ids": set(s.get("analysis_ids") or []),
                "points": len(s.get("points", [])),
            })
        merged_groups = len(groups) < len(series_list)

        handles = []
        for g in groups:
            s = g["series"]
            style = s.get("style", {})
            show_line = is_curve or bool(style.get("connect"))
            label = s.get("label", "")
            if merged_groups:
                label = label.split(" (", 1)[0]
            if show_counts:
                n = len(g["analysis_ids"]) if merged_groups else g["points"]
                label = f"{label} (n={n})"
            if position == "right":
                # 右侧图例可用宽度约为画布 22%，超长标签需折行，否则被右边缘裁切
                label = textwrap.fill(label, width=24)
            handles.append(_styled_legend_handle(style, show_line, label))
        if position == "inside":
            ax.legend(handles=handles, fontsize=tick_size, loc="upper right")
        elif position == "custom":
            ax.legend(handles=handles, fontsize=tick_size, loc="upper left",
                      bbox_to_anchor=(merged_legend.get("anchor_x") or 0.72,
                                      merged_legend.get("anchor_y") or 0.18),
                      bbox_transform=fig.transFigure)
        else:  # right
            ax.legend(handles=handles, fontsize=tick_size,
                      loc="center left", bbox_to_anchor=(1.02, 0.5))

    # 版面：固定画布内解决留白（不改变最终尺寸）
    legend_outside = bool(series_list) and position == "right"
    if annotations or legend_outside:
        fig.subplots_adjust(
            left=0.10,
            right=0.78 if legend_outside else 0.97,
            top=0.95,
            bottom=0.17 if annotations else 0.12,
        )
    else:
        fig.tight_layout(pad=0.5)

    return fig, ax


def render_scene(scene_dict: dict, output_path: Path, fmt: str = "png",
                 dpi: int = 600, background: str = "white") -> ExportResult:
    """Render a PlotScene to a file using Matplotlib.

    scene_dict is the PlotScene.model_dump() output.
    """
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    rc: dict[str, Any] = {
        "font.family": _resolve_font_families((scene_dict.get("layout", {}) or {}).get("font_family")),
    }
    # PDF 用 TrueType（非 Type3），SVG 保留可编辑文本
    if fmt == "pdf":
        rc["pdf.fonttype"] = 42
        rc["ps.fonttype"] = 42
    if fmt == "svg":
        rc["svg.fonttype"] = "none"

    with plt.rc_context(rc):
        fig, _ax = _build_figure(scene_dict, dpi=dpi, background=background)

        if fmt == "png":
            fig.savefig(str(output_path), dpi=dpi, facecolor=fig.get_facecolor(),
                       edgecolor="none")  # No bbox_inches="tight" - fixed canvas
        elif fmt == "pdf":
            canvas = FigureCanvasPdf(fig)
            canvas.print_pdf(str(output_path))
        elif fmt == "svg":
            canvas = FigureCanvasSVG(fig)
            canvas.print_svg(str(output_path))

        plt.close(fig)

    byte_size = output_path.stat().st_size
    sha256 = hashlib.sha256(output_path.read_bytes()).hexdigest()

    return ExportResult(
        path=output_path,
        format=fmt,
        width_mm=scene_dict.get("layout", {}).get("width_mm", 183),
        height_mm=scene_dict.get("layout", {}).get("height_mm", 110),
        dpi=dpi,
        byte_size=byte_size,
        sha256=sha256,
    )


def _apply_grid(ax, axes_cfg: dict, both: bool = False) -> None:
    """按 axes.major_grid 契约绘制网格（默认 False 表示不画网格）。"""
    x_cfg = (axes_cfg or {}).get("x") or {}
    y_cfg = (axes_cfg or {}).get("y") or {}
    style = {"alpha": 0.3, "linestyle": "-", "linewidth": 0.5}
    if both:
        xg = bool(x_cfg.get("major_grid", False))
        # 注意：grid(False, **样式) 会被 matplotlib 视为「提供样式即启用」，必须分开调用
        ax.grid(True, axis="x", **style) if xg else ax.grid(False, axis="x")
    ax.grid(True, axis="y", **style) if bool(y_cfg.get("major_grid", False)) else ax.grid(False, axis="y")


def _render_scatter(ax, series_list, axes_cfg):
    _apply_grid(ax, axes_cfg, both=True)
    for s in series_list:
        style = s.get("style", {})
        points = [p for p in s.get("points", [])
                  if p.get("x") is not None and p.get("y") is not None]
        if not points:
            continue
        # 点级 resolved_style（analysis 覆盖）分组；每组独立样式（R14/R15）
        for g in _group_points_by_resolved_style(points, style):
            _scatter_group(ax, [p["x"] for p in g["pts"]], [p["y"] for p in g["pts"]],
                          g["style"], zorder=3)


def _render_ree(ax, series_list, axes_cfg, scene_dict):
    elements = scene_dict.get("variables", {}).get("elements", [])
    if not elements:
        elements = ["La","Ce","Pr","Nd","Sm","Eu","Gd","Tb","Dy","Ho","Er","Tm","Yb","Lu"]
    x_positions = list(range(len(elements)))

    ax.set_xticks(x_positions)
    ax.set_xticklabels(elements, rotation=45, ha="right", fontsize=8)
    ax.set_yscale("log")
    ax.set_xlim(-0.5, len(elements) - 0.5)
    _apply_grid(ax, axes_cfg)

    for s in series_list:
        style = s.get("style", {})
        points = s.get("points", [])

        # Group points by analysis_id
        by_analysis = {}
        for p in points:
            aid = p.get("analysis_id")
            if aid not in by_analysis:
                by_analysis[aid] = []
            by_analysis[aid].append(p)

        color = style.get("line_color", "#D55E00")
        line_width = style.get("line_width_pt", 0.8)
        line_dash = DASH_MAP.get(style.get("line_dash", "solid"), "-")
        # Independent alpha for lines
        line_alpha = style.get("line_alpha", 1.0)

        # Plot each analysis as a separate line
        for aid, analysis_points in by_analysis.items():
            # Sort by x position
            analysis_points.sort(key=lambda p: p.get("x", 0))

            # Keep NaN for missing values to create proper gaps (B09 fix)
            xs = [p.get("x") for p in analysis_points]
            ys = [p.get("y") if p.get("y") is not None else float('nan') for p in analysis_points]

            if not xs:
                continue

            if style.get("connect", True):
                ax.plot(xs, ys, color=color, linewidth=line_width,
                       linestyle=line_dash, alpha=line_alpha, zorder=2)
            # 有效点标记按点级 resolved_style 分组（R15：面积 pt²、alpha 只应用一次、空心透明）
            valid_pts = [p for p in analysis_points if p.get("y") is not None]
            for g in _group_points_by_resolved_style(valid_pts, style):
                _scatter_group(ax, [p.get("x") for p in g["pts"]], [p.get("y") for p in g["pts"]],
                              g["style"], zorder=3)


def _render_spider(ax, series_list, axes_cfg, scene_dict):
    elements = scene_dict.get("variables", {}).get("elements", [])
    if not elements:
        elements = ["La","Ce","Pr","Nd","Sm","Eu","Gd","Tb","Dy","Ho","Er","Tm","Yb","Lu"]
    x_positions = list(range(len(elements)))

    ax.set_xticks(x_positions)
    ax.set_xticklabels(elements, rotation=45, ha="right", fontsize=8)
    ax.set_yscale("log")
    ax.set_xlim(-0.5, len(elements) - 0.5)

    # Draw unity reference line at y=1
    ax.axhline(y=1.0, color="gray", linestyle="--", linewidth=0.8, alpha=0.5, zorder=1)
    _apply_grid(ax, axes_cfg)

    for s in series_list:
        style = s.get("style", {})
        points = s.get("points", [])

        by_analysis = {}
        for p in points:
            aid = p.get("analysis_id")
            if aid not in by_analysis:
                by_analysis[aid] = []
            by_analysis[aid].append(p)

        color = style.get("line_color", "#D55E00")
        line_width = style.get("line_width_pt", 0.8)
        line_dash = DASH_MAP.get(style.get("line_dash", "solid"), "-")
        # Independent alpha for lines
        line_alpha = style.get("line_alpha", 1.0)

        for aid, analysis_points in by_analysis.items():
            analysis_points.sort(key=lambda p: p.get("x", 0))
            # Keep NaN for missing values to create proper gaps (B09 fix)
            xs = [p.get("x") for p in analysis_points]
            ys = [p.get("y") if p.get("y") is not None else float('nan') for p in analysis_points]
            if not xs:
                continue
            if style.get("connect", True):
                ax.plot(xs, ys, color=color, linewidth=line_width,
                       linestyle=line_dash, alpha=line_alpha, zorder=2)
            # 有效点标记按点级 resolved_style 分组（R15）
            valid_pts = [p for p in analysis_points if p.get("y") is not None]
            for g in _group_points_by_resolved_style(valid_pts, style):
                _scatter_group(ax, [p.get("x") for p in g["pts"]], [p.get("y") for p in g["pts"]],
                              g["style"], zorder=3)


def _render_tas(ax, series_list, axes_cfg, scene_dict):
    from matplotlib.patches import Polygon as MplPolygon

    # 只消费 Scene 冻结几何（QR04：渲染端不回读磁盘 manifest）
    geometry = scene_dict.get("diagram_geometry") or {}
    polygons = geometry.get("polygons") or []
    labels = geometry.get("labels") or []
    segments = geometry.get("segments") or []

    if polygons:
        for poly_data in polygons:
            boundary = poly_data.get("vertices") or []
            if len(boundary) < 3:
                continue  # 空 poly 占位项不绘图
            poly = MplPolygon(boundary, closed=True, facecolor="none",
                             edgecolor="#888888", linewidth=0.6, alpha=0.7, zorder=1)
            ax.add_patch(poly)
        for label in labels:
            ax.text(label.get("x", 0), label.get("y", 0), label.get("text", ""),
                    fontsize=5, ha="center", va="center", color="#666666", zorder=1)
    elif segments:
        # 无 polygon 时按去重线段绘制（与前端 geometryTraces 同语义）
        for p1, p2 in segments:
            ax.plot([p1[0], p2[0]], [p1[1], p2[1]],
                    color="#888888", linewidth=0.6, alpha=0.7, zorder=1)

    # 轴范围来自 Scene（手动范围/反转保留；无范围时用模型窗口，不覆盖用户设置）
    x_cfg = axes_cfg.get("x", {}) or {}
    y_cfg = axes_cfg.get("y", {}) or {}
    x_range = x_cfg.get("range")
    y_range = y_cfg.get("range")
    if x_range and len(x_range) == 2:
        ax.set_xlim(x_range[1], x_range[0]) if x_cfg.get("reversed") else ax.set_xlim(x_range)
    else:
        ax.set_xlim(35, 88)
    if y_range and len(y_range) == 2:
        ax.set_ylim(y_range[1], y_range[0]) if y_cfg.get("reversed") else ax.set_ylim(y_range)
    else:
        ax.set_ylim(0, 18)

    _render_scatter(ax, series_list, axes_cfg)
    ax.set_xlabel(x_cfg.get("label") or "SiO2 (wt%)")
    ax.set_ylabel(y_cfg.get("label") or "Na2O + K2O (wt%)")
