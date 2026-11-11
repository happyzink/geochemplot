/**
 * 演示模式 PlotScene 构造器（后端替身）。
 *
 * 生产环境由 Qoder 的计算内核与 Scene 服务产生；此文件只在 demo=1 时经
 * src/lib/api 引入。数值全部来自 fixture（合成），标准化/比值在这里仅用于
 * 让界面可交互，禁止把它当作科学计算实现或在 T08 后继续启用。
 */

import type {
  AxisSpec,
  Expression,
  LayerSpec,
  LayerStyle,
  PlotScene,
  PlotSpec,
  ReferenceComposition,
  SceneAxis,
  SceneExclusion,
  ScenePoint,
  SceneSeries,
} from '../generated/types';
import { describeExpression, expressionUnit, formatAnalyte } from '../expressions';
import type { MockAnalysis } from './fixtures';
import { referenceByKey, REE_ELEMENTS, SPIDER_ELEMENTS } from './fixtures';

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

export function hashString(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0xc2b2ae35;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ ch, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

interface EvalResult {
  value: number | null;
  unit: string | null;
  reason: string | null;
  analyte?: string;
  reference_value?: number | null;
  detail: string[];
}

function convertUnit(value: number, from: string | null, to: string | null): { value: number | null; reason: string | null } {
  if (!from || !to) return { value: null, reason: 'unit_unconfirmed' };
  if (from === to) return { value, reason: null };
  if (from === 'ppm' && to === 'ppb') return { value: value * 1000, reason: null };
  if (from === 'ppb' && to === 'ppm') return { value: value / 1000, reason: null };
  if (from === 'wt%' && to === 'wt%') return { value, reason: null };
  return { value: null, reason: 'unit_conflict' };
}

function evaluate(analysis: MockAnalysis, expr: Expression, refs: ReferenceComposition[]): EvalResult {
  switch (expr.kind) {
    case 'measurement': {
      const raw = analysis.values[expr.analyte];
      if (raw == null) return { value: null, unit: expr.unit, reason: 'missing_value', analyte: expr.analyte, detail: [] };
      if (analysis.unconfirmed_units.includes(expr.analyte)) {
        return { value: null, unit: expr.unit, reason: 'unit_unconfirmed', analyte: expr.analyte, detail: [`${expr.analyte} 单位未确认`] };
      }
      const converted = convertUnit(raw, analysis.units[expr.analyte] ?? null, expr.unit);
      return {
        value: converted.value,
        unit: expr.unit,
        reason: converted.reason,
        analyte: expr.analyte,
        detail: [`${formatAnalyte(expr.analyte)} 原值 ${raw} ${analysis.units[expr.analyte] ?? '?'}`],
      };
    }
    case 'normalize': {
      const inner = evaluate(analysis, expr.value, refs);
      if (inner.value == null) return { ...inner, unit: null };
      const ref = refs.find((r) => r.ref_id === expr.reference_id && r.version === expr.reference_version);
      if (!ref) return { value: null, unit: null, reason: 'reference_missing', detail: ['参考组成版本不存在'] };
      const analyte = inner.analyte ?? (expr.value.kind === 'measurement' ? expr.value.analyte : null);
      if (!analyte) return { value: null, unit: null, reason: 'reference_incomplete', detail: ['只能标准化单元素测量'] };
      const refValue = ref.values[analyte];
      if (refValue == null || refValue <= 0) {
        return { value: null, unit: null, reason: 'reference_incomplete', analyte, detail: [`参考组成缺少 ${analyte} 或值非正`] };
      }
      return {
        value: inner.value / refValue,
        unit: null,
        reason: null,
        analyte,
        reference_value: refValue,
        detail: [...inner.detail, `${analyte} / ${ref.ref_id}@${ref.version} = ${refValue}`],
      };
    }
    case 'ratio': {
      const num = evaluate(analysis, expr.numerator, refs);
      const den = evaluate(analysis, expr.denominator, refs);
      if (num.value == null) return { value: null, unit: null, reason: num.reason ?? 'missing_value', detail: num.detail };
      if (den.value == null) return { value: null, unit: null, reason: den.reason ?? 'missing_value', detail: den.detail };
      if (num.unit && den.unit && num.unit !== den.unit) {
        const a = convertUnit(num.value, num.unit, den.unit);
        if (a.value == null) return { value: null, unit: null, reason: a.reason, detail: ['分子分母单位不可换算'] };
        if (den.value === 0) return { value: null, unit: null, reason: 'division_by_zero', detail: [] };
        return { value: a.value / den.value, unit: null, reason: null, detail: [...num.detail, ...den.detail] };
      }
      if (den.value === 0) return { value: null, unit: null, reason: 'division_by_zero', detail: [] };
      return { value: num.value / den.value, unit: null, reason: null, detail: [...num.detail, ...den.detail] };
    }
    case 'add': {
      let sum = 0;
      let unit: string | null = null;
      const detail: string[] = [];
      for (const operand of expr.operands) {
        const part = evaluate(analysis, operand, refs);
        if (part.value == null) return { value: null, unit: null, reason: part.reason ?? 'missing_value', detail: part.detail };
        if (unit && part.unit !== unit) return { value: null, unit: null, reason: 'unit_conflict', detail: ['加法只允许同单位'] };
        unit = part.unit;
        sum += part.value;
        detail.push(...part.detail);
      }
      return { value: sum, unit, reason: null, detail };
    }
    case 'constant':
      return { value: expr.value, unit: expr.unit, reason: null, detail: [] };
    default:
      return { value: null, unit: null, reason: 'unsupported_expression', detail: [] };
  }
}

function mergeStyle(base: LayerStyle, overrides: Partial<LayerStyle> | undefined): LayerStyle {
  return { ...base, ...(overrides ?? {}) } as LayerStyle;
}

function styleSignature(style: LayerStyle): string {
  return hashString(stableStringify(style));
}

function rangeFor(axis: AxisSpec, values: number[], fallback: [number, number]): [number, number] {
  if (axis.range_mode === 'manual' && axis.min != null && axis.max != null) return [axis.min, axis.max];
  const finite = values.filter((v) => Number.isFinite(v) && (axis.scale !== 'log10' || v > 0));
  if (!finite.length) return fallback;
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  if (axis.scale === 'log10') {
    const lo = Math.log10(min) - 0.25;
    const hi = Math.log10(max) + 0.25;
    return [Number((10 ** lo).toPrecision(4)), Number((10 ** hi).toPrecision(4))];
  }
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    return [min - pad, max + pad];
  }
  const pad = (max - min) * 0.06;
  return [Number((min - pad).toPrecision(4)), Number((max + pad).toPrecision(4))];
}

function linearTicks(range: [number, number], step: number | null, target = 6): number[] {
  if (step != null && step > 0) {
    const ticks: number[] = [];
    const start = Math.ceil(range[0] / step) * step;
    for (let v = start; v <= range[1] + step * 1e-9; v += step) {
      ticks.push(Number(v.toPrecision(12)));
      if (ticks.length > 50) break;
    }
    return ticks;
  }
  const span = range[1] - range[0];
  if (!Number.isFinite(span) || span <= 0) return [];
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const residual = raw / mag;
  const mult = residual >= 5 ? 5 : residual >= 2 ? 2 : 1;
  const nice = mult * mag;
  const ticks: number[] = [];
  const start = Math.ceil(range[0] / nice) * nice;
  for (let v = start; v <= range[1] + nice * 1e-9; v += nice) {
    ticks.push(Number(v.toPrecision(12)));
    if (ticks.length > 50) break;
  }
  return ticks;
}

function logTicks(range: [number, number], exponentStep: number | null): number[] {
  if (!(range[0] > 0) || !(range[1] > 0)) return [];
  const lo = Math.log10(range[0]);
  const hi = Math.log10(range[1]);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) return [];
  const step = exponentStep && exponentStep >= 1 && exponentStep <= 6 ? exponentStep : 1;
  const ticks: number[] = [];
  for (let e = Math.ceil(lo); e <= Math.floor(hi) + 1e-9; e += step) {
    ticks.push(Number((10 ** e).toPrecision(6)));
  }
  return ticks;
}

function axisTitleForSpec(axis: AxisSpec, generated: string): string {
  return axis.title_override?.trim() ? axis.title_override : generated;
}

/** 表达式里出现的参考组成都要进入 reference_snapshots，散点标准化同样如此。 */
function collectReferenceKeys(expr: Expression | null, into: Set<string>): void {
  if (!expr) return;
  switch (expr.kind) {
    case 'normalize':
      into.add(`${expr.reference_id}@${expr.reference_version}`);
      collectReferenceKeys(expr.value, into);
      break;
    case 'ratio':
      collectReferenceKeys(expr.numerator, into);
      collectReferenceKeys(expr.denominator, into);
      break;
    case 'add':
      expr.operands.forEach((operand) => collectReferenceKeys(operand, into));
      break;
    default:
      break;
  }
}

interface SelectionResolution {
  selection_id: string;
  selection_hash: string;
  analysis_ids: string[];
  dataset_versions: Array<{ dataset_id: string; version: string }>;
}

export interface SceneBuildInput {
  spec: PlotSpec;
  requestId: string;
  analyses: MockAnalysis[];
  selections: SelectionResolution[];
  references: ReferenceComposition[];
  softwareVersion: string;
}

export function buildScene(input: SceneBuildInput): PlotScene {
  const { spec, requestId, analyses, selections, references } = input;
  const specHash = hashString(stableStringify(spec));
  const byId = new Map(analyses.map((a) => [a.analysis_id, a]));
  const exclusions: SceneExclusion[] = [];
  const series: SceneSeries[] = [];
  const usedRefs = new Map<string, ReferenceComposition>();
  const warnings: PlotScene['warnings'] = [];
  const excludedIds = new Set<string>();
  const selectedIds = new Set<string>();
  const xValues: number[] = [];
  const yValues: number[] = [];

  for (const layer of spec.layers) {
    const resolved = selections.find((s) => s.selection_id === layer.selection_id);
    if (!resolved) {
      warnings.push(`SELECTION_MISSING：图层「${layer.label}」的选择集尚未解析`);
      continue;
    }
    // 与后端合同一致：隐藏层不进入渲染 series，但选择仍保留在 resolved_selections。
    if (!layer.visible) continue;
    resolved.analysis_ids.forEach((id) => selectedIds.add(id));
    const layerAnalyses = resolved.analysis_ids.map((id) => byId.get(id)).filter(Boolean) as MockAnalysis[];

    if (spec.chart_type === 'scatter' || spec.chart_type === 'tas') {
      const groups = new Map<string, { style: LayerStyle; items: Array<{ analysis: MockAnalysis; point: ScenePoint }> }>();
      const refKeys = new Set<string>();
      collectReferenceKeys(spec.variables.x, refKeys);
      collectReferenceKeys(spec.variables.y, refKeys);
      for (const key of refKeys) {
        const [refId, version] = key.split('@');
        const ref = referenceByKey(refId, version);
        if (ref) usedRefs.set(key, ref);
      }
      for (const analysis of layerAnalyses) {
        const xExpr = spec.variables.x;
        const yExpr = spec.variables.y;
        let x: number | null = null;
        let y: number | null = null;
        let reason: string | null = null;
        let unresolved: string | null = null;
        if (spec.chart_type === 'tas') {
          const xr = evaluate(analysis, { kind: 'measurement', analyte: 'SiO2', chemical_form: 'oxide', unit: 'wt%' }, references);
          const yr = evaluate(analysis, { kind: 'measurement', analyte: 'Na2O', chemical_form: 'oxide', unit: 'wt%' }, references);
          const kr = evaluate(analysis, { kind: 'measurement', analyte: 'K2O', chemical_form: 'oxide', unit: 'wt%' }, references);
          if (!xr.value || yr.value == null || kr.value == null) {
            reason = xr.reason ?? yr.reason ?? kr.reason ?? 'missing_value';
          } else {
            x = xr.value;
            y = yr.value + kr.value;
            unresolved = `TAS 分区几何由后端 tas_LeMaitre@1 提供，演示模式不绘制分区线`;
          }
        } else if (xExpr && yExpr) {
          const xr = evaluate(analysis, xExpr, references);
          const yr = evaluate(analysis, yExpr, references);
          if (xr.value == null) {
            reason = xr.reason ?? 'missing_value';
          } else if (yr.value == null) {
            reason = yr.reason ?? 'missing_value';
          } else {
            x = xr.value;
            y = yr.value;
          }
        } else {
          reason = 'variable_not_set';
        }
        if ((spec.axes.x.scale === 'log10' && (x == null || x <= 0)) || (spec.axes.y.scale === 'log10' && (y == null || y <= 0))) {
          reason = reason ?? 'nonpositive_log';
        }
        if (reason || x == null || y == null) {
          excludedIds.add(analysis.analysis_id);
          if (!exclusions.some((e) => e.analysis_id === analysis.analysis_id)) {
            exclusions.push({
              analysis_id: analysis.analysis_id,
              reason_code: reason ?? 'missing_value',
              source_cells: [`${analysis.source.sheet}!${analysis.source.row}`],
            });
          }
          continue;
        }
        const override = layer.analysis_style_overrides[analysis.analysis_id];
        const style = mergeStyle(layer.style, override);
        const point: ScenePoint = {
          point_id: `${layer.layer_id}:${analysis.analysis_id}`,
          analysis_id: analysis.analysis_id,
          x,
          y,
          x_error: null,
          y_error: null,
          quality_flags: [],
          provenance: {
            raw_name: analysis.raw_name,
            mission: analysis.mission,
            material_type: analysis.material_type,
            citation: analysis.citation,
            parent_sample: analysis.parent_sample,
            source_sheet: analysis.source.sheet,
            source_row: analysis.source.row,
            synthetic: analysis.synthetic,
          },
        };
        xValues.push(x);
        yValues.push(y);
        const sig = styleSignature(style);
        if (!groups.has(sig)) groups.set(sig, { style, items: [] });
        groups.get(sig)!.items.push({ analysis, point });
        if (unresolved && !warnings.some((w) => w.startsWith('DIAGRAM_GEOMETRY_MISSING'))) {
          warnings.push(`DIAGRAM_GEOMETRY_MISSING：${unresolved}`);
        }
      }
      for (const [sig, group] of groups) {
        series.push({
          series_id: `${layer.layer_id}:${sig.slice(0, 8)}`,
          layer_id: layer.layer_id,
          analysis_ids: group.items.map((i) => i.analysis.analysis_id).sort(),
          sample_ids: group.items.map((i) => i.analysis.sample_id).sort(),
          label: layer.label,
          style: group.style,
          points: group.items.map((i) => i.point).sort((a, b) => a.analysis_id.localeCompare(b.analysis_id)),
          break_at_missing: false,
        });
      }
    } else {
      const elements = spec.variables.elements ?? [];
      const mode = spec.variables.value_mode;
      const ref =
        mode === 'normalized'
          ? referenceByKey(spec.variables.reference_id, spec.variables.reference_version)
          : null;
      if (ref) usedRefs.set(`${ref.ref_id}@${ref.version}`, ref);
      for (const analysis of layerAnalyses) {
        const points: ScenePoint[] = [];
        let validCount = 0;
        for (let index = 0; index < elements.length; index += 1) {
          const element = elements[index];
          let value: number | null = null;
          let reason: string | null = null;
          if (mode === 'normalized') {
            const expr: Expression = {
              kind: 'normalize',
              value: { kind: 'measurement', analyte: element, chemical_form: 'element', unit: 'ppm' },
              reference_id: spec.variables.reference_id ?? '',
              reference_version: spec.variables.reference_version ?? '',
            };
            const res = evaluate(analysis, expr, references);
            value = res.value;
            reason = res.reason;
          } else {
            const res = evaluate(analysis, { kind: 'measurement', analyte: element, chemical_form: 'element', unit: 'ppm' }, references);
            value = res.value;
            reason = res.reason;
          }
          if (value != null && spec.axes.y.scale === 'log10' && value <= 0) {
            reason = 'nonpositive_log';
            value = null;
          }
          if (value == null) {
            reason = reason ?? 'missing_value';
          } else {
            validCount += 1;
          }
          if (value != null) {
            yValues.push(value);
            xValues.push(index);
          }
          points.push({
            point_id: `${layer.layer_id}:${analysis.analysis_id}:${element}`,
            analysis_id: analysis.analysis_id,
            x: index,
            y: value,
            x_error: null,
            y_error: null,
            quality_flags: reason ? [reason] : [],
            provenance: {
              element,
              raw_name: analysis.raw_name,
              mission: analysis.mission,
              citation: analysis.citation,
              source_sheet: analysis.source.sheet,
              source_row: analysis.source.row,
              reason,
              value_mode: mode,
              raw_value: analysis.values[element] ?? null,
              raw_unit: analysis.units[element] ?? null,
              unit: mode === 'normalized' ? null : 'ppm',
              reference_id: ref?.ref_id ?? null,
              reference_version: ref?.version ?? null,
              reference_value: ref?.values[element] ?? null,
              reference_unit:
                ref && typeof ref.units === 'object' ? (ref.units[element] ?? null) : null,
              normalized_value: mode === 'normalized' ? value : null,
            },
          });
        }
        if (validCount < 2) {
          excludedIds.add(analysis.analysis_id);
          if (!exclusions.some((e) => e.analysis_id === analysis.analysis_id)) {
            exclusions.push({
              analysis_id: analysis.analysis_id,
              reason_code: validCount === 0 ? 'no_valid_elements' : 'insufficient_elements',
              source_cells: [`${analysis.source.sheet}!${analysis.source.row}`],
            });
          }
          continue;
        }
        const style = mergeStyle(layer.style, layer.analysis_style_overrides[analysis.analysis_id]);
        series.push({
          series_id: `${layer.layer_id}:${analysis.analysis_id}`,
          layer_id: layer.layer_id,
          analysis_ids: [analysis.analysis_id],
          sample_ids: [analysis.sample_id],
          label: `${layer.label} · ${analysis.raw_name}`,
          style,
          points,
          break_at_missing: true,
        });
      }
    }
  }

  const isCategory = spec.chart_type === 'ree' || spec.chart_type === 'spider';
  const elements = spec.variables.elements ?? [];
  const xTicks: Array<number | string> = isCategory ? elements : [];
  const rawXRange = isCategory ? null : rangeFor(spec.axes.x, xValues, [0, 1]);
  const rawYRange = rangeFor(spec.axes.y, yValues, isCategory ? [0.01, 100] : [0, 1]);
  // 对数轴的范围必须为正；自动范围含 0 时收紧到下一条正数据附近，避免 Plotly 画出压缩的假轴。
  const clampLog = (range: [number, number], values: number[], fallback: [number, number]): [number, number] => {
    if (range[0] > 0 && range[1] > 0) return range;
    const positive = values.filter((value) => value > 0);
    if (positive.length === 0) return fallback;
    const lo = Math.min(...positive) / 2;
    const hi = range[1] > 0 ? Math.max(range[1], lo * 10) : Math.max(...positive) * 2;
    return [lo, hi];
  };
  const xRange = rawXRange && spec.axes.x.scale === 'log10' ? clampLog(rawXRange, xValues, [0.1, 10]) : rawXRange;
  const yRange = spec.axes.y.scale === 'log10' ? clampLog(rawYRange, yValues, [0.1, 100]) : rawYRange;
  if (rawXRange && spec.axes.x.scale === 'log10' && (rawXRange[0] <= 0 || rawXRange[1] <= 0)) {
    warnings.push('LOG_RANGE_CLAMPED：X 轴自动范围包含非正值，已收紧到正数据区间');
  }
  if (spec.axes.y.scale === 'log10' && (rawYRange[0] <= 0 || rawYRange[1] <= 0)) {
    warnings.push('LOG_RANGE_CLAMPED：Y 轴自动范围包含非正值，已收紧到正数据区间');
  }
  if (!isCategory && xRange) {
    if (spec.axes.x.range_mode === 'manual' && xRange[0] >= xRange[1]) {
      warnings.push('AXIS_RANGE_INVALID：X 轴手动范围无效，已回退自动范围');
    }
  }
  const xTickValues = isCategory
    ? []
    : spec.axes.x.scale === 'log10'
      ? logTicks(xRange ?? [0, 1], spec.axes.x.log_exponent_step)
      : linearTicks(xRange ?? [0, 1], spec.axes.x.tick_step);
  const yTickValues = spec.axes.y.scale === 'log10'
    ? logTicks(yRange, spec.axes.y.log_exponent_step)
    : linearTicks(yRange, spec.axes.y.tick_step);

  const xLabel = isCategory
    ? '元素'
    : spec.chart_type === 'tas'
      ? 'SiO₂ (wt%)'
      : spec.variables.x
        ? axisTitleForSpec(spec.axes.x, describeExpression(spec.variables.x))
        : 'X 变量';
  const yLabel = isCategory
    ? spec.variables.value_mode === 'normalized'
      ? '样品 / 参考'
      : '浓度 (ppm)'
    : spec.chart_type === 'tas'
      ? 'Na₂O + K₂O (wt%)'
      : spec.variables.y
        ? axisTitleForSpec(spec.axes.y, describeExpression(spec.variables.y))
        : 'Y 变量';

  const xAxis: SceneAxis = {
    label: xLabel,
    unit: isCategory ? null : spec.chart_type === 'tas' ? 'wt%' : expressionUnit(spec.variables.x as Expression) ?? null,
    scale: isCategory ? 'category' : spec.axes.x.scale,
    range: xRange,
    ticks: isCategory ? xTicks : xTickValues,
    reversed: spec.axes.x.reversed,
    number_format: spec.axes.x.number_format,
    decimal_places: spec.axes.x.decimal_places,
    significant_digits: spec.axes.x.significant_digits,
    tick_mode: spec.axes.x.tick_mode,
    tick_step: spec.axes.x.tick_step,
    log_exponent_step: spec.axes.x.log_exponent_step,
    title_font_size_pt: spec.axes.x.title_font_size_pt,
    tick_font_size_pt: spec.axes.x.tick_font_size_pt,
    major_grid: spec.axes.x.major_grid,
    minor_ticks: spec.axes.x.minor_ticks,
    tick_direction: spec.axes.x.tick_direction,
    ...(isCategory ? { category_order: elements, visible_categories: spec.axes.x.visible_categories ?? elements } : {}),
  };
  const yAxis: SceneAxis = {
    label: yLabel,
    unit: isCategory ? (spec.variables.value_mode === 'normalized' ? null : 'ppm') : spec.chart_type === 'tas' ? 'wt%' : expressionUnit(spec.variables.y as Expression) ?? null,
    scale: spec.axes.y.scale,
    range: yRange,
    ticks: yTickValues,
    reversed: spec.axes.y.reversed,
    number_format: spec.axes.y.number_format,
    decimal_places: spec.axes.y.decimal_places,
    significant_digits: spec.axes.y.significant_digits,
    tick_mode: spec.axes.y.tick_mode,
    tick_step: spec.axes.y.tick_step,
    log_exponent_step: spec.axes.y.log_exponent_step,
    title_font_size_pt: spec.axes.y.title_font_size_pt,
    tick_font_size_pt: spec.axes.y.tick_font_size_pt,
    major_grid: spec.axes.y.major_grid,
    minor_ticks: spec.axes.y.minor_ticks,
    tick_direction: spec.axes.y.tick_direction,
  };

  // 计数
  const validPoints: ScenePoint[] = series.flatMap((s) => s.points.filter((p) => p.y != null));
  let outOfView = 0;
  let hiddenByStyle = 0;
  for (const s of series) {
    for (const p of s.points) {
      if (p.x == null || p.y == null) continue;
      const outsideX = xAxis.range ? p.x < xAxis.range[0] || p.x > xAxis.range[1] : false;
      const outsideY = yAxis.range ? p.y < yAxis.range[0] || p.y > yAxis.range[1] : false;
      if (outsideX || outsideY) outOfView += 1;
      if (s.style.marker_alpha === 0) hiddenByStyle += 1;
    }
  }
  const ids = [...selectedIds];
  const analysesOfIds = ids.map((id) => byId.get(id)).filter(Boolean) as MockAnalysis[];
  const distinct = new Set(analysesOfIds.map((a) => a.parent_sample ?? a.sample_id));
  const unknownIdentity = new Set(analysesOfIds.filter((a) => !a.parent_sample && !a.raw_name).map((a) => a.sample_id));
  const validIds = new Set(series.flatMap((s) => s.analysis_ids));
  const validAnalyses = [...validIds].filter((id) => !excludedIds.has(id));
  const allRefs = [...usedRefs.values()];
  const sceneHash = hashString(
    stableStringify({
      specHash,
      selections: selections.map((s) => s.selection_hash),
      points: series.map((s) => s.points.map((p) => [p.analysis_id, p.x, p.y])),
    }),
  );

  return {
    scene_id: `scene_${sceneHash}`,
    schema_version: '1.1',
    request_id: requestId,
    spec_hash: specHash,
    scene_hash: sceneHash,
    plot_revision: spec.revision,
    chart_type: spec.chart_type,
    resolved_selections: selections,
    reference_snapshots: allRefs.map((r) => ({
      ref_id: r.ref_id, version: r.version, hash: r.hash, values: r.values,
      units: r.units, citation: r.citation, verification_status: r.verification_status,
    })),
    variables: spec.variables,
    axes: { x: xAxis, y: yAxis },
    series,
    diagram_geometry: null,
    legend: { position: spec.layout.legend.position, anchor_x: spec.layout.legend.anchor_x, anchor_y: spec.layout.legend.anchor_y },
    layout: spec.layout,
    font_manifest: { primary: spec.layout.font_family, fallback: [spec.layout.font_family, 'Arial', 'sans-serif'], available: true, substituted_with: null },
    warnings,
    counts: {
      selected_analyses: ids.length,
      valid_analyses: validAnalyses.length,
      excluded_analyses: excludedIds.size,
      distinct_samples: distinct.size,
      physical_identity_unknown: unknownIdentity.size,
      plotted_points: validPoints.length,
      out_of_view: outOfView,
      hidden_by_style: hiddenByStyle,
    },
    exclusions,
    software_version: input.softwareVersion,
  };
}
