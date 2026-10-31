/**
 * 界面中文标签。枚举取值与 generated/types.ts 一一对应；
 * 未知值一律回退到原始键，避免把后端新值显示成空白。
 */

import type {
  AxisScale,
  DatasetRole,
  ExportRecord,
  LineDash,
  MaterialType,
  MineralGroup,
  Mission,
  NumberFormat,
  TickDirection,
  ValueMode,
} from './generated/types';

export const MISSION: Record<Mission, string> = {
  CE5: '嫦娥五号',
  CE6: '嫦娥六号',
  Apollo: 'Apollo',
  unknown: '未知任务',
};

export const MATERIAL: Record<MaterialType, string> = {
  whole_rock: '全岩',
  mineral: '单矿物',
  glass: '玻璃',
  soil: '月壤',
  clast: '岩屑',
  separate: '分选物',
  leachate: '淋滤液',
  residue: '残余物',
  matrix: '基质',
  groundmass: '基质',
  vein: '脉体',
  mesostasis: '间隙物',
  melt_inclusion: '熔体包裹体',
  unknown: '待确认',
};

export const MINERAL: Record<MineralGroup, string> = {
  pyroxene: '辉石',
  plagioclase: '斜长石',
  olivine: '橄榄石',
  oxide: '氧化物',
  phosphate: '磷酸盐',
  other: '其他',
  unknown: '待确认',
};

export const ROLE: Record<DatasetRole, string> = {
  own: '自有数据',
  literature: '文献数据',
  comparison: '对比数据',
  derived_view: '派生视图',
};

export const QUALITY_FLAG: Record<string, string> = {
  below_detection: '低于检出限',
  unit_unconfirmed: '单位未确认',
  unit_conflict: '单位冲突',
  partial: '部分缺失',
  duplicate: '重复记录',
  derived: '派生行',
  suspicious: '可疑值',
  missing_parent: '缺母样品',
  unclassified: '未分类',
};

export const VALUE_STATE: Record<string, string> = {
  measured: '实测',
  derived: '派生',
  reported: '文献报告',
  below_detection: '低于检出限',
  not_reported: '未报告',
  unknown: '未知',
};

export const AXIS_SCALE_LABEL: Record<AxisScale, string> = {
  linear: '线性（linear）',
  log10: '对数（log10）',
  category: '分类（category）',
};

export const NUMBER_FORMAT_LABEL: Record<NumberFormat, string> = {
  auto: '自动',
  fixed: '定点小数',
  scientific: '科学计数',
};

export const LINE_DASH_LABEL: Record<LineDash, string> = {
  solid: '实线',
  dash: '虚线',
  dot: '点线',
  dashdot: '点划线',
};

export const TICK_DIRECTION_LABEL: Record<TickDirection, string> = {
  out: '向外',
  in: '向内',
};

export const VALUE_MODE: Record<ValueMode, string> = {
  raw: '原始值',
  normalized: '标准化值',
};

export const EXPORT_STATE_LABEL: Record<ExportRecord['state'], string> = {
  queued: '排队中',
  rendering: '渲染中',
  verifying: '校验文件',
  committing: '写入目录',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
  interrupted: '已中断',
};

export const REASON_CODE: Record<string, string> = {
  missing_value: '缺少测量值',
  unit_unconfirmed: '单位未确认',
  unit_conflict: '单位不可换算',
  reference_missing: '参考组成版本缺失',
  reference_incomplete: '参考组成不完整',
  division_by_zero: '分母为零',
  unsupported_expression: '不支持的表达式',
  nonpositive_log: '非正值无法取对数',
  censored: '低于检出限',
  missing_spider: '蛛网图缺元素',
  category_missing: '分类值缺失',
  selector_missing: '选择集缺失',
};

const lookup = (map: Record<string, string>, key: string | null | undefined): string =>
  key ? map[key] ?? key : '—';

export const missionLabel = (key: Mission | string | null | undefined): string => lookup(MISSION, key);
export const materialLabel = (key: MaterialType | string | null | undefined): string => lookup(MATERIAL, key);
export const mineralLabel = (key: MineralGroup | string | null | undefined): string => lookup(MINERAL, key);
export const roleLabel = (key: DatasetRole | string | null | undefined): string => lookup(ROLE, key);
export const flagLabel = (key: string | null | undefined): string => lookup(QUALITY_FLAG, key);
export const reasonLabel = (key: string | null | undefined): string => lookup(REASON_CODE, key);
export const valueStateLabel = (key: string | null | undefined): string => lookup(VALUE_STATE, key);
export const exportStateLabel = (key: ExportRecord['state'] | string | null | undefined): string =>
  lookup(EXPORT_STATE_LABEL, key);
