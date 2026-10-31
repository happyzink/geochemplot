/**
 * 合同类型（schema 1.1）
 *
 * 来源：docs/geochem-plotter/05_接口与共享契约.md 与 15_v2接口与任务增补.md。
 * 唯一权威仍为 Qoder 在 contracts/ 下发布的 JSON Schema/OpenAPI。
 * 当 docs/progress/CONTRACT_READY.json 为 ready 时，运行 `npm run generate:api`
 * 用生成的类型覆盖 contracts.generated.ts，并以契约测试比对字段。
 * 本文件在合同就绪前用于隔离 mock 与界面开发，禁止在此发明后端没有的字段。
 */

export type SchemaVersion = '1.1';

export type ChartType = 'scatter' | 'ree' | 'spider' | 'tas';

export type MarkerShape =
  | 'circle'
  | 'square'
  | 'triangle_up'
  | 'triangle_down'
  | 'diamond'
  | 'plus'
  | 'cross'
  | 'star'
  | 'hexagon';

export type MarkerFill = 'solid' | 'open';

export type LineDash = 'solid' | 'dash' | 'dot' | 'dashdot';

export type AxisScale = 'linear' | 'log10' | 'category';

export type RangeMode = 'auto' | 'manual';

export type TickMode = 'auto' | 'step';

export type NumberFormat = 'auto' | 'fixed' | 'scientific';

export type TickDirection = 'out' | 'in';

export type LegendPosition = 'right' | 'inside' | 'custom';

export type ValueMode = 'raw' | 'normalized';

/** 15 §1：每个 layer 的完整样式。父层 opacity 已废弃。 */
export interface LayerStyle {
  marker_shape: MarkerShape;
  marker_fill: MarkerFill;
  marker_fill_color: string;
  marker_edge_color: string;
  marker_size_pt: number;
  marker_edge_width_pt: number;
  marker_alpha: number;
  line_color: string;
  line_width_pt: number;
  line_dash: LineDash;
  line_alpha: number;
  connect: boolean;
}

/** 15 §2：每个轴独立对象。 */
export interface AxisSpec {
  scale: AxisScale;
  range_mode: RangeMode;
  min: number | null;
  max: number | null;
  reversed: boolean;
  tick_mode: TickMode;
  tick_step: number | null;
  log_exponent_step: number | null;
  number_format: NumberFormat;
  decimal_places: number | null;
  significant_digits: number | null;
  title_override: string | null;
  title_font_size_pt: number;
  tick_font_size_pt: number;
  major_grid: boolean;
  minor_ticks: boolean;
  tick_direction: TickDirection;
  /** 仅 category 轴 */
  category_order?: string[];
  visible_categories?: string[];
}

export interface AnnotationSpec {
  id: string;
  text: string;
  anchor_x: number;
  anchor_y: number;
  font_size_pt: number;
  color: string;
}

export interface LegendSpec {
  position: LegendPosition;
  anchor_x: number | null;
  anchor_y: number | null;
}

export interface LayoutSpec {
  width_mm: number;
  height_mm: number;
  preset: 'nature_main_2026' | 'thesis_cn' | 'custom';
  font_family: string;
  font_size_pt: number;
  tick_font_size_pt: number;
  legend: LegendSpec;
  legend_show_counts: boolean;
  annotations: AnnotationSpec[];
}

/** 05 §3 / 15 §1：CSS 颜色只允许 #RRGGBB；alpha 独立。 */
export interface LayerSpec {
  layer_id: string;
  label: string;
  selection_id: string;
  visible: boolean;
  aggregation: 'none';
  style: LayerStyle;
  analysis_style_overrides: Record<string, Partial<LayerStyle>>;
}

export type Expression =
  | {
      kind: 'measurement';
      analyte: string;
      chemical_form: 'element' | 'oxide' | 'isotope_ratio' | 'index';
      unit: string;
      channel?: string | null;
    }
  | { kind: 'normalize'; value: Expression; reference_id: string; reference_version: string }
  | { kind: 'ratio'; numerator: Expression; denominator: Expression }
  | { kind: 'add'; operands: Expression[] }
  | { kind: 'constant'; value: number; unit: string };

export interface QualityPolicy {
  censored: 'exclude' | 'include';
  nonpositive_log: 'exclude' | 'include';
  missing_spider: 'gap' | 'drop';
  unconfirmed_unit: 'exclude' | 'include';
}

export interface TasDiagramSpec {
  model_id: string;
  model_version: string;
  mode: 'reference';
  oxide_basis: 'raw' | 'anhydrous_100';
  oxide_set: string[];
  iron_policy: string | null;
}

export interface PlotVariables {
  x: Expression | null;
  y: Expression | null;
  /** REE/spider 元素顺序；散点为 null（scene-1.2 fixture 实测）。 */
  elements: string[] | null;
  value_mode: ValueMode | null;
  reference_id: string | null;
  reference_version: string | null;
}

export interface PlotSpec {
  schema_version: SchemaVersion;
  plot_id: string;
  revision: number;
  chart_type: ChartType;
  layers: LayerSpec[];
  variables: PlotVariables;
  quality_policy: QualityPolicy;
  axes: { x: AxisSpec; y: AxisSpec };
  layout: LayoutSpec;
  diagram: TasDiagramSpec | null;
  channel_policy_id: string | null;
}

export interface SceneStyle extends LayerStyle {}

export interface ScenePoint {
  point_id: string;
  analysis_id: string;
  x: number | null;
  y: number | null;
  x_error: number | null;
  y_error: number | null;
  quality_flags: string[];
  provenance: Record<string, unknown>;
  /** 分析级覆盖样式（已解析进 Scene）；未覆盖为 null。 */
  resolved_style?: LayerStyle | null;
}

export interface SceneSeries {
  series_id: string;
  layer_id: string;
  analysis_ids: string[];
  sample_ids: string[];
  label: string;
  style: SceneStyle;
  points: ScenePoint[];
  break_at_missing: boolean;
}

export interface SceneAxis {
  label: string;
  unit: string | null;
  scale: AxisScale;
  range: [number, number] | null;
  ticks: Array<number | string>;
  reversed?: boolean;
  category_order?: string[];
  number_format?: NumberFormat;
  decimal_places?: number | null;
  significant_digits?: number | null;
  tick_mode?: TickMode;
  tick_step?: number | null;
  log_exponent_step?: number | null;
  title_font_size_pt?: number;
  tick_font_size_pt?: number;
  major_grid?: boolean;
  minor_ticks?: boolean;
  tick_direction?: TickDirection;
}

export interface ReferenceSnapshot {
  ref_id: string;
  version: string;
  hash: string;
  values: Record<string, number>;
  units: Record<string, string> | string;
  citation: string;
  verification_status: string;
}

export interface SceneExclusion {
  analysis_id: string;
  analyte?: string | null;
  reason_code: string;
  source_cells?: string[];
}

export interface SceneCounts {
  selected_analyses: number;
  valid_analyses: number;
  excluded_analyses: number;
  distinct_samples: number;
  physical_identity_unknown: number;
  plotted_points: number;
  out_of_view: number;
  hidden_by_style: number;
}

export interface FontManifest {
  primary: string;
  fallback: string[];
  available: boolean;
  substituted_with: string | null;
}

export interface PlotScene {
  scene_id: string;
  schema_version: SchemaVersion;
  request_id: string;
  spec_hash: string;
  scene_hash: string;
  plot_revision: number;
  chart_type: ChartType;
  resolved_selections: Array<{
    selection_id: string;
    selection_hash: string;
    analysis_ids: string[];
    /** schema 为自由 string map；真实 fixture 仅含 version，不假造 dataset_id。 */
    dataset_versions: Array<Record<string, string>>;
  }>;
  reference_snapshots: ReferenceSnapshot[];
  variables: PlotVariables;
  axes: { x: SceneAxis; y: SceneAxis };
  series: SceneSeries[];
  diagram_geometry: Record<string, unknown> | null;
  /** schema 1.2 为自由对象；真实 fixture 为空对象，图例真值在 layout.legend。 */
  legend: Partial<LegendSpec> & { show_counts?: boolean };
  layout: LayoutSpec;
  font_manifest: FontManifest;
  warnings: string[];
  counts: SceneCounts;
  exclusions: SceneExclusion[];
  software_version: string;
}

/* ------------------------------------------------------------------ */
/* 目录、数据集、分析                                                   */
/* ------------------------------------------------------------------ */

export type DatasetRole = 'own' | 'literature' | 'comparison' | 'derived_view';

export interface Dataset {
  dataset_id: string;
  version: string;
  label: string;
  role: DatasetRole;
  file_id: string;
  sheets: string[];
  counts: {
    physical_rows: number;
    accepted_analyses: number;
    quarantined_rows: number;
    skipped_rows: number;
    linked_derived_rows: number;
  };
  mapping_version: string;
  created_at: string;
}

export type MaterialType =
  | 'whole_rock'
  | 'mineral'
  | 'glass'
  | 'soil'
  | 'clast'
  | 'separate'
  | 'leachate'
  | 'residue'
  | 'matrix'
  | 'groundmass'
  | 'vein'
  | 'mesostasis'
  | 'melt_inclusion'
  | 'unknown';

export type MineralGroup =
  | 'pyroxene'
  | 'plagioclase'
  | 'olivine'
  | 'oxide'
  | 'phosphate'
  | 'other'
  | 'unknown';

export type Mission = 'CE5' | 'CE6' | 'Apollo' | 'unknown';

export interface AnalysisSummary {
  analysis_id: string;
  sample_id: string;
  raw_name: string;
  parent_sample: string | null;
  subsample: string | null;
  mission: Mission;
  /** 样品名称前段标号分组（sample_prefix_v1 派生，如 14049 / 036 / CE6） */
  sample_group?: string;
  batch: string | null;
  material_type: MaterialType;
  mineral_group: MineralGroup;
  phase: string | null;
  rock_type: string | null;
  citation: string | null;
  source: { file_id: string; sheet: string; row: number };
  quality_flags: string[];
}

export interface AnalysisDetail extends AnalysisSummary {
  measurements: Array<{
    measurement_id: string;
    analyte: string;
    chemical_form: 'element' | 'oxide' | 'isotope_ratio' | 'index';
    channel: string | null;
    value: number | null;
    unit: string | null;
    unit_confirmed: boolean;
    value_state: string;
    quality_flags: string[];
    source_cell: string | null;
    uncertainty: number | null;
    uncertainty_label: string | null;
    detection_limit: number | null;
  }>;
  classification_evidence: Array<{
    field: string;
    raw_value: string | null;
    normalized_value: string | null;
    rule_id: string | null;
    evidence_cells: string[];
    confidence: number;
    confirmed: boolean;
  }>;
}

export interface SelectionSet {
  selection_id?: string;
  name: string;
  dataset_versions: Array<{ dataset_id: string; version: string }>;
  mode: 'snapshot' | 'dynamic';
  filter: QueryFilter;
  include_ids: string[];
  exclude_ids: string[];
  resolved_ids?: string[];
  resolved_count?: number;
  distinct_samples?: number;
  selection_hash?: string;
}

export interface QueryFilter {
  mission?: Mission[];
  sample_group?: string[];
  material_type?: MaterialType[];
  mineral_group?: MineralGroup[];
  parent_sample?: string | null;
  sample_search?: { mode: 'exact' | 'parent' | 'contains'; text: string } | null;
}

export interface FacetBucket {
  value: string;
  label: string;
  count: number;
  children?: FacetBucket[];
}

export interface Facets {
  datasets: FacetBucket[];
  missions: FacetBucket[];
  sample_groups: FacetBucket[];
  material_types: FacetBucket[];
  mineral_groups: FacetBucket[];
  parents: FacetBucket[];
}

export interface AnalysisQueryRequest {
  dataset_versions: Array<{ dataset_id: string; version: string }>;
  filter: QueryFilter;
  sort: { field: string; direction: 'asc' | 'desc' } | null;
  offset: number;
  limit: number;
}

export interface AnalysisQueryResponse {
  rows: AnalysisSummary[];
  total: number;
  counts: {
    total: number;
    whole_rock: number;
    mineral: number;
    glass: number;
    unknown_material: number;
  };
  query_hash: string;
  dataset_versions: Array<{ dataset_id: string; version: string }>;
}

/* ------------------------------------------------------------------ */
/* 参考组成                                                             */
/* ------------------------------------------------------------------ */

export interface ReferenceComposition {
  ref_id: string;
  version: string;
  label: string;
  elements: string[];
  values: Record<string, number>;
  units: Record<string, string>;
  citation: string;
  verification_status: string;
  hash: string;
  is_custom: boolean;
  note: string | null;
}

/* ------------------------------------------------------------------ */
/* 导入                                                                 */
/* ------------------------------------------------------------------ */

export interface ImportSheet {
  sheet_name: string;
  rows: number;
  columns: number;
  suggested_role: 'samples' | 'reference' | 'derived_view' | 'ignored';
  suggested_dataset_id: string | null;
  role: 'samples' | 'reference' | 'derived_view' | 'ignored';
  enabled: boolean;
}

export interface ImportColumn {
  sheet: string;
  column_index: number;
  column_letter: string;
  header_raw: string;
  sample_values: string[];
  target:
    | 'metadata'
    | 'measurement'
    | 'uncertainty'
    | 'detection_limit'
    | 'ignored';
  analyte: string | null;
  chemical_form: 'element' | 'oxide' | 'isotope_ratio' | 'index' | null;
  unit: string | null;
  value_state: string;
  channel: string | null;
  confirmed: boolean;
  duplicate_of: number | null;
}

export interface ImportIssue {
  issue_id: string;
  severity: 'blocker' | 'warning' | 'info';
  kind:
    | 'excel_error'
    | 'empty_name'
    | 'unknown_unit'
    | 'channel_conflict'
    | 'duplicate_header'
    | 'overlap'
    | 'skipped_row'
    | 'other';
  sheet: string;
  row: number | null;
  column_letter: string | null;
  message: string;
  count: number;
}

export interface ImportOverlap {
  derived_sheet: string;
  main_sheet: string;
  matched_rows: number;
  multi_candidate_rows: number;
  default_plot_source: 'main' | 'derived';
  note: string;
}

export interface ImportPreview {
  preview_id: string;
  file_name: string;
  file_size: number;
  sha256: string;
  sheets: ImportSheet[];
  columns: ImportColumn[];
  head_rows: string[][];
  issues: ImportIssue[];
  overlaps: ImportOverlap[];
}

export interface ImportReport {
  datasets: Dataset[];
  report: {
    sheet: string;
    physical_rows: number;
    accepted: number;
    quarantined: number;
    skipped: number;
    linked_derived: number;
    unit_proposals: Array<{ group: string; unit: string; state: 'proposed' | 'confirmed' }>;
  }[];
}

/* ------------------------------------------------------------------ */
/* 图件、版本、记录                                                     */
/* ------------------------------------------------------------------ */

export interface Figure {
  figure_id: string;
  project_id: string;
  name: string;
  chart_type: ChartType;
  thumbnail_artifact_id: string | null;
  current_revision_id: string | null;
  metadata_revision: number;
  draft_revision: number;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface FigureDraft {
  figure_id: string;
  draft_revision: number;
  spec: PlotSpec;
  selection_snapshots: Array<{ selection_id: string; name: string; analysis_ids: string[] }>;
  saved_at: string;
}

export interface FigureRevision {
  figure_id: string;
  revision_id: string;
  revision_number: number;
  spec: PlotSpec;
  scene_id: string | null;
  source_versions: Array<{ dataset_id: string; version: string }>;
  reference_snapshots: ReferenceSnapshot[];
  resolved_analysis_ids: string[];
  created_at: string;
  content_hash: string;
}

export interface OperationRecord {
  operation_id: string;
  figure_id: string;
  draft_or_revision: string;
  timestamp: string;
  action: string;
  changed_fields: string[];
  before_summary: string;
  after_summary: string;
  request_id: string;
}

export interface ExportRoot {
  export_root_id: string;
  project_id: string;
  absolute_path: string;
  display_name: string;
  selected_by_user_at: string;
  writable_check: 'ok' | 'unwritable' | 'unknown';
  is_default: boolean;
}

export interface ExportFile {
  artifact_id: string | null;
  filename: string;
  format: 'png' | 'pdf' | 'svg' | 'json' | 'csv' | 'md';
  byte_size: number | null;
  sha256: string | null;
  absolute_path: string;
  exists: boolean;
}

export interface ExportRecord {
  export_id: string;
  figure_id: string;
  revision_id: string;
  scene_id: string;
  scene_hash: string;
  export_seq: number;
  formats: string[];
  size_mm: { width: number; height: number };
  dpi: number | null;
  background: 'white' | 'transparent';
  export_root_id: string;
  relative_dir: string;
  state:
    | 'queued'
    | 'rendering'
    | 'verifying'
    | 'committing'
    | 'succeeded'
    | 'failed'
    | 'cancelled'
    | 'interrupted';
  files: ExportFile[];
  error: { code: string; message: string } | null;
  counts: SceneCounts | null;
  created_at: string;
  finished_at: string | null;
}

/* ------------------------------------------------------------------ */
/* 任务、项目、运行时                                                   */
/* ------------------------------------------------------------------ */

export type JobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export interface Job<T = unknown> {
  job_id: string;
  status: JobStatus;
  phase: string;
  processed: number;
  total: number;
  result: T | null;
  error: { code: string; message: string; details?: unknown } | null;
}

export interface Project {
  project_id: string;
  name: string;
  revision: number;
  dataset_versions: Array<{ dataset_id: string; version: string }>;
  figure_count: number;
  export_root: ExportRoot | null;
  created_at: string;
  updated_at: string;
}

export interface CatalogEntry {
  data_id: string;
  label: string;
  sheet: string;
  record_baseline: number;
  role: DatasetRole;
  default_visible: boolean;
  attached: boolean;
  dataset_id: string | null;
  version: string | null;
  unit_confirmation_pending: number;
  note: string;
}

export interface RuntimeStatus {
  app_id: string;
  app_version: string;
  profile_id: string;
  instance_id: string;
  pid: number;
  process_started_at: string;
  state: 'running' | 'stopped' | 'starting' | 'failed';
  base_url: string;
  active_jobs: number;
}

export interface ApiErrorPayload {
  error: {
    code: string;
    message: string;
    field_errors?: Array<{ path: string; message: string }>;
    details?: unknown;
    request_id: string;
  };
}
