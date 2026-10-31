/**
 * 变量表达式的构造、展示、校验与样式默认值。
 *
 * 科学含义（单位换算、标准化、比值、坐标变换）全部在后端计算；
 * 本文件只负责生成 PlotSpec 里的声明、可读标签与前端校验，
 * 不复制任何后端算法。
 */

import type {
  AxisScale,
  AxisSpec,
  Expression,
  LayerStyle,
  MarkerShape,
} from './generated/types';

const SUBSCRIPT: Record<string, string> = {
  '0': '₀',
  '1': '₁',
  '2': '₂',
  '3': '₃',
  '4': '₄',
  '5': '₅',
  '6': '₆',
  '7': '₇',
  '8': '₈',
  '9': '₉',
};

/** SiO2 → SiO₂；只转换数字，不改动词头。 */
export function formatAnalyte(analyte: string): string {
  if (!analyte) return '';
  return analyte.replace(/[0-9]/g, (digit) => SUBSCRIPT[digit] ?? digit);
}

export function measurement(
  analyte: string,
  unit: string,
  chemical_form: 'element' | 'oxide' | 'isotope_ratio' | 'index' = 'element',
  channel: string | null = null,
): Expression {
  return { kind: 'measurement', analyte, chemical_form, unit, channel };
}

export function ratio(numerator: Expression, denominator: Expression): Expression {
  return { kind: 'ratio', numerator, denominator };
}

export function normalize(value: Expression, reference_id: string, reference_version: string): Expression {
  return { kind: 'normalize', value, reference_id, reference_version };
}

export function add(operands: Expression[]): Expression {
  return { kind: 'add', operands };
}

export function constant(value: number, unit: string): Expression {
  return { kind: 'constant', value, unit };
}

function referenceLabelOf(expr: Extract<Expression, { kind: 'normalize' }>): string {
  return `${expr.reference_id}@${expr.reference_version}`;
}

/** 展示用标签；标准化表达式必须带参考组成 id@版本。 */
export function describeExpression(expr: Expression | null, referenceLabel?: string): string {
  if (!expr) return '未选择变量';
  switch (expr.kind) {
    case 'measurement': {
      const label = formatAnalyte(expr.analyte);
      return expr.unit ? `${label} (${expr.unit})` : label;
    }
    case 'normalize': {
      const label = referenceLabel ?? referenceLabelOf(expr);
      return `${describeExpression(expr.value)}ₙ (${label})`;
    }
    case 'ratio': {
      const num = expr.numerator;
      const den = expr.denominator;
      if (num.kind === 'normalize' && den.kind === 'normalize') {
        const label = referenceLabel ?? referenceLabelOf(num);
        return `(${bare(num.value)}/${bare(den.value)})ₙ (${label})`;
      }
      return `${describeExpression(num, referenceLabel)}/${describeExpression(den, referenceLabel)}`;
    }
    case 'add':
      return expr.operands.map((operand) => describeExpression(operand, referenceLabel)).join(' + ');
    case 'constant':
      return expr.unit ? `${expr.value} ${expr.unit}` : String(expr.value);
    default:
      return '未知变量';
  }
}

/** 比值内部只显示元素名，不重复单位。 */
function bare(expr: Expression): string {
  if (expr.kind === 'measurement') return formatAnalyte(expr.analyte);
  return describeExpression(expr);
}

/** 稳定的表达式键：用于选择集缓存、Scene 指纹与图层比较。 */
export function expressionKey(expr: Expression | null): string {
  if (!expr) return 'null';
  switch (expr.kind) {
    case 'measurement':
      return `m:${expr.analyte}:${expr.unit}:${expr.chemical_form}:${expr.channel ?? ''}`;
    case 'ratio':
      return `r(${expressionKey(expr.numerator)}/${expressionKey(expr.denominator)})`;
    case 'normalize':
      return `n(${expressionKey(expr.value)}@${expr.reference_id}@${expr.reference_version})`;
    case 'add':
      return `a(${expr.operands.map(expressionKey).join('+')})`;
    case 'constant':
      return `c:${expr.value}:${expr.unit}`;
    default:
      return 'unknown';
  }
}

/** 轴单位：标准化与比值在图上无单位；测量沿用测量单位。 */
export function expressionUnit(expr: Expression | null): string | null {
  if (!expr) return null;
  switch (expr.kind) {
    case 'measurement':
      return expr.unit || null;
    case 'normalize':
    case 'ratio':
      return null;
    case 'add': {
      const units = new Set(expr.operands.map((operand) => expressionUnit(operand)).filter(Boolean));
      return units.size === 1 ? [...units][0] ?? null : null;
    }
    case 'constant':
      return expr.unit || null;
    default:
      return null;
  }
}

export interface ExpressionValidation {
  ok: boolean;
  nodes: number;
  error: string | null;
}

export function validateExpression(expr: Expression | null): ExpressionValidation {
  if (!expr) return { ok: false, nodes: 0, error: '未选择变量' };
  let nodes = 0;
  const errors: string[] = [];

  const walk = (node: Expression): void => {
    nodes += 1;
    switch (node.kind) {
      case 'measurement': {
        if (!node.analyte?.trim()) errors.push('测量变量缺少元素或化合物');
        if (!node.unit?.trim()) errors.push('测量变量缺少单位');
        break;
      }
      case 'normalize': {
        if (!node.reference_id?.trim() || !node.reference_version?.trim()) {
          errors.push('标准化需要选择参考组成版本（reference_id 与 reference_version 不能为空）');
        }
        walk(node.value);
        break;
      }
      case 'ratio': {
        walk(node.numerator);
        walk(node.denominator);
        break;
      }
      case 'add': {
        if (node.operands.length < 2) errors.push('加法至少需要两个操作数');
        node.operands.forEach(walk);
        break;
      }
      case 'constant':
        break;
      default:
        errors.push('未知变量类型');
    }
  };

  walk(expr);
  return { ok: errors.length === 0, nodes, error: errors.length ? errors[0] : null };
}

/* ------------------------------------------------------------------ */
/* 标记形状与线型                                                       */
/* ------------------------------------------------------------------ */

export interface MarkerShapeOption {
  value: MarkerShape;
  label: string;
}

export const MARKER_SHAPES: MarkerShapeOption[] = [
  { value: 'circle', label: '圆形' },
  { value: 'square', label: '方形' },
  { value: 'triangle_up', label: '上三角' },
  { value: 'triangle_down', label: '下三角' },
  { value: 'diamond', label: '菱形' },
  { value: 'plus', label: '加号' },
  { value: 'cross', label: '叉号' },
  { value: 'star', label: '星形' },
  { value: 'hexagon', label: '六边形' },
];

const GLYPHS: Record<MarkerShape, string> = {
  circle: '●',
  square: '■',
  triangle_up: '▲',
  triangle_down: '▼',
  diamond: '◆',
  plus: '＋',
  cross: '✕',
  star: '★',
  hexagon: '⬢',
};

export function markerGlyph(shape: MarkerShape): string {
  return GLYPHS[shape] ?? '●';
}

/* ------------------------------------------------------------------ */
/* 透明度：界面 0% = 完全不透明，100% = 完全透明                         */
/* ------------------------------------------------------------------ */

export function uiTransparencyToAlpha(uiPercent: number): number {
  const clamped = Math.min(100, Math.max(0, uiPercent));
  const alpha = 1 - clamped / 100;
  return Math.round(alpha * 1000) / 1000;
}

export function alphaToUiTransparency(alpha: number): number {
  const clamped = Math.min(1, Math.max(0, alpha));
  return Math.round((1 - clamped) * 100);
}

/* ------------------------------------------------------------------ */
/* 默认样式                                                             */
/* ------------------------------------------------------------------ */

export const DEFAULT_STYLE: LayerStyle = {
  marker_shape: 'circle',
  marker_fill: 'solid',
  marker_fill_color: '#D55E00',
  marker_edge_color: '#8C3A00',
  marker_size_pt: 6,
  marker_edge_width_pt: 0.75,
  marker_alpha: 1,
  line_color: '#D55E00',
  line_width_pt: 1,
  line_dash: 'solid',
  line_alpha: 1,
  connect: false,
};

/** 对比图层默认空心 + 虚线，便于与主动图层区分但不改科学数据。 */
export const CONTRAST_STYLE: LayerStyle = {
  marker_shape: 'square',
  marker_fill: 'open',
  marker_fill_color: '#FFFFFF',
  marker_edge_color: '#0072B2',
  marker_size_pt: 7,
  marker_edge_width_pt: 1,
  marker_alpha: 1,
  line_color: '#0072B2',
  line_width_pt: 1.25,
  line_dash: 'dash',
  line_alpha: 1,
  connect: false,
};

export function defaultAxis(scale: AxisScale): AxisSpec {
  const axis: AxisSpec = {
    scale,
    range_mode: 'auto',
    min: null,
    max: null,
    reversed: false,
    tick_mode: 'auto',
    tick_step: null,
    log_exponent_step: scale === 'log10' ? 1 : null,
    number_format: 'auto',
    decimal_places: null,
    significant_digits: null,
    title_override: null,
    title_font_size_pt: 7,
    tick_font_size_pt: 6,
    major_grid: false,
    minor_ticks: false,
    tick_direction: 'out',
  };
  if (scale === 'category') {
    axis.category_order = [];
    axis.visible_categories = [];
  }
  return axis;
}
