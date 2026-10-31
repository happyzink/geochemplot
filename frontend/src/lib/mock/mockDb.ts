/**
 * 演示模式的持久化替身（localStorage）。
 * 真实实现由 Qoder 的 SQLite repository 提供；这里保证刷新/重启后图件、草稿、
 * 版本、导出记录与项目仍可恢复，用于验证 UI 行为。
 */

import type {
  Dataset,
  ExportFile,
  ExportRecord,
  ExportRoot,
  Figure,
  FigureDraft,
  FigureRevision,
  ImportPreview,
  ImportReport,
  Job,
  OperationRecord,
  PlotSpec,
  Project,
  SelectionSet,
} from '../generated/types';
import { CATALOG, DATASETS, DATA_IDS } from './fixtures';
import { hashString } from './scene';

const STORAGE_KEY = 'geoplot.mock.db.v1';

export interface MockDb {
  projects: Project[];
  figures: Figure[];
  drafts: FigureDraft[];
  revisions: FigureRevision[];
  operations: OperationRecord[];
  exports: ExportRecord[];
  roots: ExportRoot[];
  selections: SelectionSet[];
  attached: Record<string, string>;
  last_opened_figure_id: string | null;
}

export function loadDb(): MockDb {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as MockDb;
      if (parsed && Array.isArray(parsed.projects)) return parsed;
    }
  } catch {
    /* 存储损坏时重建演示库，不阻塞界面 */
  }
  return seedDb();
}

export function saveDb(db: MockDb): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    /* 存储满/隐私模式下不打断操作，状态栏会提示保存失败由上层处理 */
  }
}

export function resetDb(): MockDb {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  return seedDb();
}

export function seedDb(): MockDb {
  const now = new Date().toISOString();
  const project: Project = {
    project_id: 'proj_demo',
    name: '月球对比项目（演示）',
    revision: 1,
    dataset_versions: DATASETS.map((d) => ({ dataset_id: d.dataset_id, version: d.version })),
    figure_count: 1,
    export_root: null,
    created_at: now,
    updated_at: now,
  };
  const selections: SelectionSet[] = [
    {
      selection_id: 'sel_own_ce6',
      name: '自有 CE6',
      dataset_versions: [{ dataset_id: 'ds_own_summary', version: '1' }],
      mode: 'snapshot',
      filter: { mission: ['CE6'] },
      include_ids: [],
      exclude_ids: [],
    },
    {
      selection_id: 'sel_ce5',
      name: 'CE5 文献',
      dataset_versions: [{ dataset_id: 'ds_ce', version: '1' }],
      mode: 'snapshot',
      filter: { mission: ['CE5'] },
      include_ids: [],
      exclude_ids: [],
    },
    {
      selection_id: 'sel_apollo_74235',
      name: 'Apollo 74235 全岩',
      dataset_versions: [{ dataset_id: 'ds_apollo', version: '1' }],
      mode: 'snapshot',
      filter: {
        material_type: ['whole_rock'],
        sample_search: { mode: 'parent', text: '74235' },
      },
      include_ids: [],
      exclude_ids: [],
    },
  ];
  const spec: PlotSpec = {
    schema_version: '1.1',
    plot_id: 'plot_demo_scatter',
    revision: 1,
    chart_type: 'scatter',
    layers: [
      {
        layer_id: 'layer_own',
        label: '自有 CE6',
        selection_id: 'sel_own_ce6',
        visible: true,
        aggregation: 'none',
        style: {
          marker_shape: 'circle', marker_fill: 'solid', marker_fill_color: '#D55E00',
          marker_edge_color: '#D55E00', marker_size_pt: 3.5, marker_edge_width_pt: 0.35,
          marker_alpha: 1, line_color: '#D55E00', line_width_pt: 0.8, line_dash: 'solid',
          line_alpha: 1, connect: false,
        },
        analysis_style_overrides: {},
      },
      {
        layer_id: 'layer_ce5',
        label: 'CE5 文献',
        selection_id: 'sel_ce5',
        visible: true,
        aggregation: 'none',
        style: {
          marker_shape: 'triangle_up', marker_fill: 'solid', marker_fill_color: '#0072B2',
          marker_edge_color: '#0072B2', marker_size_pt: 3, marker_edge_width_pt: 0.35,
          marker_alpha: 0.85, line_color: '#0072B2', line_width_pt: 0.6, line_dash: 'solid',
          line_alpha: 0.85, connect: false,
        },
        analysis_style_overrides: {},
      },
      {
        layer_id: 'layer_apollo',
        label: 'Apollo 74235',
        selection_id: 'sel_apollo_74235',
        visible: true,
        aggregation: 'none',
        style: {
          marker_shape: 'diamond', marker_fill: 'solid', marker_fill_color: '#6B6B6B',
          marker_edge_color: '#6B6B6B', marker_size_pt: 3, marker_edge_width_pt: 0.35,
          marker_alpha: 0.6, line_color: '#6B6B6B', line_width_pt: 0.6, line_dash: 'dash',
          line_alpha: 0.6, connect: false,
        },
        analysis_style_overrides: {},
      },
    ],
    variables: {
      x: { kind: 'ratio', numerator: { kind: 'measurement', analyte: 'Rb', chemical_form: 'element', unit: 'ppm', channel: null }, denominator: { kind: 'measurement', analyte: 'Sr', chemical_form: 'element', unit: 'ppm', channel: null } },
      y: {
        kind: 'ratio',
        numerator: { kind: 'normalize', value: { kind: 'measurement', analyte: 'La', chemical_form: 'element', unit: 'ppm', channel: null }, reference_id: 'Chondrite_MS95', reference_version: '1' },
        denominator: { kind: 'normalize', value: { kind: 'measurement', analyte: 'Yb', chemical_form: 'element', unit: 'ppm', channel: null }, reference_id: 'Chondrite_MS95', reference_version: '1' },
      },
      elements: ['La', 'Ce', 'Pr', 'Nd', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb', 'Lu'],
      value_mode: 'normalized',
      reference_id: 'Chondrite_MS95',
      reference_version: '1',
    },
    quality_policy: { censored: 'exclude', nonpositive_log: 'exclude', missing_spider: 'gap', unconfirmed_unit: 'exclude' },
    axes: {
      x: {
        scale: 'linear', range_mode: 'auto', min: null, max: null, reversed: false, tick_mode: 'auto',
        tick_step: null, log_exponent_step: null, number_format: 'auto', decimal_places: null,
        significant_digits: null, title_override: null, title_font_size_pt: 7, tick_font_size_pt: 6,
        major_grid: false, minor_ticks: false, tick_direction: 'out',
      },
      y: {
        scale: 'linear', range_mode: 'auto', min: null, max: null, reversed: false, tick_mode: 'auto',
        tick_step: null, log_exponent_step: null, number_format: 'auto', decimal_places: null,
        significant_digits: null, title_override: null, title_font_size_pt: 7, tick_font_size_pt: 6,
        major_grid: false, minor_ticks: false, tick_direction: 'out',
      },
    },
    layout: {
      width_mm: 183, height_mm: 110, preset: 'nature_main_2026', font_family: 'Arial',
      font_size_pt: 7, tick_font_size_pt: 6,
      legend: { position: 'right', anchor_x: null, anchor_y: null },
      legend_show_counts: true,
      annotations: [],
    },
    diagram: null,
    channel_policy_id: null,
  };
  const figure: Figure = {
    figure_id: 'fig_demo_scatter',
    project_id: project.project_id,
    name: '月球对比散点（示例）',
    chart_type: 'scatter',
    thumbnail_artifact_id: null,
    current_revision_id: 'rev_demo_1',
    metadata_revision: 1,
    draft_revision: 1,
    archived: false,
    created_at: now,
    updated_at: now,
  };
  const draft: FigureDraft = {
    figure_id: figure.figure_id,
    draft_revision: 1,
    spec,
    selection_snapshots: selections.map((s) => ({ selection_id: s.selection_id!, name: s.name, analysis_ids: [] })),
    saved_at: now,
  };
  const revision: FigureRevision = {
    figure_id: figure.figure_id,
    revision_id: 'rev_demo_1',
    revision_number: 1,
    spec,
    scene_id: null,
    source_versions: project.dataset_versions,
    reference_snapshots: [],
    resolved_analysis_ids: [],
    created_at: now,
    content_hash: 'seed',
  };
  const root: ExportRoot = {
    export_root_id: 'root_default',
    project_id: project.project_id,
    absolute_path: 'C:\\Users\\演示用户\\Documents\\GeoPlot\\Exports',
    display_name: '文档/GeoPlot/Exports（演示路径）',
    selected_by_user_at: now,
    writable_check: 'ok',
    is_default: true,
  };
  return {
    projects: [project],
    figures: [figure],
    drafts: [draft],
    revisions: [revision],
    operations: [],
    exports: [],
    roots: [root],
    selections,
    attached: Object.fromEntries(
      CATALOG.filter((c) => c.dataset_id).map((c) => [c.data_id, c.dataset_id as string]),
    ),
    last_opened_figure_id: figure.figure_id,
  };
}

/* ------------------------------------------------------------------ */
/* 导入预览 fixture                                                     */
/* ------------------------------------------------------------------ */

const SHEET_SPECS: Array<{
  name: string;
  rows: number;
  cols: number;
  role: ImportPreview['sheets'][number]['suggested_role'];
  columns: Array<Omit<ImportPreview['columns'][number], 'sheet'>>;
  issueRows: Array<[number, string]>;
}> = [
  {
    name: '原始实验数据_合并', rows: 375, cols: 306, role: 'samples',
    columns: [
      { column_index: 0, column_letter: 'A', header_raw: 'sample', sample_values: ['CE6-129-PX - 1', 'CE6-118-GLASS - 1'], target: 'metadata', analyte: null, chemical_form: null, unit: null, value_state: 'metadata', channel: null, confirmed: false, duplicate_of: null },
      { column_index: 1, column_letter: 'B', header_raw: 'phase', sample_values: ['PX', 'GLASS'], target: 'metadata', analyte: null, chemical_form: null, unit: null, value_state: 'metadata', channel: null, confirmed: false, duplicate_of: null },
      { column_index: 8, column_letter: 'IQ', header_raw: 'source_file', sample_values: ['原始数据_1.xlsx'], target: 'metadata', analyte: null, chemical_form: null, unit: null, value_state: 'metadata', channel: null, confirmed: false, duplicate_of: null },
      { column_index: 12, column_letter: 'M', header_raw: 'La139_ppm_mean', sample_values: ['2.31', '1.02'], target: 'measurement', analyte: 'La', chemical_form: 'element', unit: 'ppm', value_state: 'raw_concentration', channel: 'La139', confirmed: true, duplicate_of: null },
      { column_index: 13, column_letter: 'N', header_raw: 'Ce140_ppm_mean', sample_values: ['5.02', '2.4'], target: 'measurement', analyte: 'Ce', chemical_form: 'element', unit: 'ppm', value_state: 'raw_concentration', channel: 'Ce140', confirmed: true, duplicate_of: null },
      { column_index: 14, column_letter: 'O', header_raw: 'La139_2SE(int)', sample_values: ['0.04', '0.02'], target: 'uncertainty', analyte: 'La', chemical_form: 'element', unit: 'ppm', value_state: 'uncertainty', channel: 'La139', confirmed: true, duplicate_of: null },
      { column_index: 15, column_letter: 'P', header_raw: 'LOD_Longerich', sample_values: ['0.01', '0.01'], target: 'detection_limit', analyte: 'La', chemical_form: 'element', unit: 'ppm', value_state: 'detection_limit', channel: 'La139', confirmed: true, duplicate_of: null },
      { column_index: 60, column_letter: 'BI', header_raw: 'PbTotal_ppm_mean', sample_values: ['1.2', '0.8'], target: 'measurement', analyte: 'Pb', chemical_form: 'element', unit: 'ppm', value_state: 'raw_concentration', channel: 'PbTotal', confirmed: false, duplicate_of: null },
      { column_index: 61, column_letter: 'BJ', header_raw: 'Pb204_ppm_mean', sample_values: ['0.3', '0.2'], target: 'measurement', analyte: 'Pb', chemical_form: 'element', unit: 'ppm', value_state: 'raw_concentration', channel: 'Pb204', confirmed: false, duplicate_of: 60 },
    ],
    issueRows: [[75, '重复表头'], [154, '缺样品号']],
  },
  {
    name: '实验数据汇总', rows: 260, cols: 55, role: 'samples',
    columns: [
      { column_index: 0, column_letter: 'A', header_raw: 'task', sample_values: ['LABLE', 'CE6'], target: 'metadata', analyte: null, chemical_form: null, unit: null, value_state: 'metadata', channel: null, confirmed: false, duplicate_of: null },
      { column_index: 1, column_letter: 'B', header_raw: 'phase', sample_values: ['GLASS', 'PX'], target: 'metadata', analyte: null, chemical_form: null, unit: null, value_state: 'metadata', channel: null, confirmed: false, duplicate_of: null },
      { column_index: 2, column_letter: 'C', header_raw: 'mineral_group', sample_values: ['Glass', 'Pyroxene'], target: 'metadata', analyte: null, chemical_form: null, unit: null, value_state: 'metadata', channel: null, confirmed: false, duplicate_of: null },
      { column_index: 3, column_letter: 'D', header_raw: 'original_name', sample_values: ['CE6-118-GLASS - 1', 'CE6-129-PX - 2'], target: 'metadata', analyte: null, chemical_form: null, unit: null, value_state: 'metadata', channel: null, confirmed: false, duplicate_of: null },
      { column_index: 6, column_letter: 'G', header_raw: 'Si', sample_values: ['229518.73', '225000'], target: 'measurement', analyte: 'Si', chemical_form: 'element', unit: null, value_state: 'raw_concentration', channel: 'Si', confirmed: false, duplicate_of: null },
      { column_index: 51, column_letter: 'AZ', header_raw: '(La/Yb)n', sample_values: ['0.2029152', '1.31'], target: 'measurement', analyte: null, chemical_form: 'index', unit: null, value_state: 'normalized', channel: null, confirmed: false, duplicate_of: null },
      { column_index: 52, column_letter: 'BB', header_raw: '(La/Yb)n', sample_values: ['0.2029152', '1.31'], target: 'measurement', analyte: null, chemical_form: 'index', unit: null, value_state: 'normalized', channel: null, confirmed: false, duplicate_of: 51 },
    ],
    issueRows: [[2, 'LABLE 批次与 CE6 任务建议冲突'], [47, '未知单位']],
  },
  {
    name: '嫦娥搜集数据', rows: 8349, cols: 85, role: 'samples',
    columns: [
      { column_index: 1, column_letter: 'B', header_raw: 'DOI', sample_values: ['10.1016/j.xxx'], target: 'metadata', analyte: null, chemical_form: null, unit: null, value_state: 'metadata', channel: null, confirmed: false, duplicate_of: null },
      { column_index: 2, column_letter: 'C', header_raw: '第一作者_年份', sample_values: ['Li 2021'], target: 'metadata', analyte: null, chemical_form: null, unit: null, value_state: 'metadata', channel: null, confirmed: false, duplicate_of: null },
      { column_index: 4, column_letter: 'E', header_raw: '任务', sample_values: ['CE5', 'CE6'], target: 'metadata', analyte: null, chemical_form: null, unit: null, value_state: 'metadata', channel: null, confirmed: false, duplicate_of: null },
      { column_index: 5, column_letter: 'F', header_raw: '样品编号', sample_values: ['036-004-py-2', 'CE6-118'], target: 'metadata', analyte: null, chemical_form: null, unit: null, value_state: 'metadata', channel: null, confirmed: false, duplicate_of: null },
      { column_index: 6, column_letter: 'G', header_raw: '分析对象', sample_values: ['Pyroxene', 'Glass'], target: 'metadata', analyte: null, chemical_form: null, unit: null, value_state: 'metadata', channel: null, confirmed: false, duplicate_of: null },
      { column_index: 25, column_letter: 'Z', header_raw: 'La', sample_values: ['2.3', '1.1'], target: 'measurement', analyte: 'La', chemical_form: 'element', unit: null, value_state: 'raw_concentration', channel: null, confirmed: false, duplicate_of: null },
      { column_index: 38, column_letter: 'AL', header_raw: 'Yb', sample_values: ['7.7', '3.4'], target: 'measurement', analyte: 'Yb', chemical_form: 'element', unit: null, value_state: 'raw_concentration', channel: null, confirmed: false, duplicate_of: null },
      { column_index: 36, column_letter: 'AJ', header_raw: 'Mg#', sample_values: ['#DIV/0!', '72.1'], target: 'measurement', analyte: null, chemical_form: 'index', unit: null, value_state: 'source_index', channel: null, confirmed: false, duplicate_of: null },
    ],
    issueRows: [[1087, '#DIV/0! 公式错误'], [2041, '缺样品编号']],
  },
  {
    name: 'CE with trace ele', rows: 536, cols: 85, role: 'derived_view',
    columns: [
      { column_index: 4, column_letter: 'E', header_raw: '任务', sample_values: ['CE5', 'CE5'], target: 'metadata', analyte: null, chemical_form: null, unit: null, value_state: 'metadata', channel: null, confirmed: false, duplicate_of: null },
      { column_index: 25, column_letter: 'Z', header_raw: 'La', sample_values: ['2.3', '1.2'], target: 'measurement', analyte: 'La', chemical_form: 'element', unit: null, value_state: 'raw_concentration', channel: null, confirmed: false, duplicate_of: null },
      { column_index: 36, column_letter: 'BK', header_raw: 'La', sample_values: ['9.70464135021097', '5.06'], target: 'measurement', analyte: 'La', chemical_form: 'element', unit: null, value_state: 'normalized', channel: null, confirmed: false, duplicate_of: 25 },
      { column_index: 41, column_letter: 'BP', header_raw: '(La/Yb)n', sample_values: ['0.2029152282316839', '0.87'], target: 'measurement', analyte: null, chemical_form: 'index', unit: null, value_state: 'normalized', channel: null, confirmed: false, duplicate_of: null },
      { column_index: 52, column_letter: 'CA', header_raw: '(La/Yb)n', sample_values: ['0.2029152282316839', '0.87'], target: 'measurement', analyte: null, chemical_form: 'index', unit: null, value_state: 'normalized', channel: null, confirmed: false, duplicate_of: 41 },
    ],
    issueRows: [[480, '#VALUE! 公式错误'], [2, '与主表 535 行匹配']],
  },
  {
    name: 'Normalization value', rows: 17, cols: 4, role: 'reference',
    columns: [
      { column_index: 0, column_letter: 'A', header_raw: '(空表头) La: 0.237', sample_values: ['"La": 0.237', '"Ce": 0.613'], target: 'metadata', analyte: null, chemical_form: null, unit: null, value_state: 'metadata', channel: null, confirmed: false, duplicate_of: null },
      { column_index: 3, column_letter: 'D', header_raw: '(无表头)', sample_values: ['0.237', '0.613'], target: 'measurement', analyte: null, chemical_form: 'element', unit: null, value_state: 'reference', channel: null, confirmed: false, duplicate_of: null },
    ],
    issueRows: [[3, 'A4:A17 参考值文本，非表头']],
  },
  {
    name: 'Apollo数据', rows: 35803, cols: 66, role: 'samples',
    columns: [
      { column_index: 0, column_letter: 'A', header_raw: 'Sample Name', sample_values: ['74235', '74235,52'], target: 'metadata', analyte: null, chemical_form: null, unit: null, value_state: 'metadata', channel: null, confirmed: false, duplicate_of: null },
      { column_index: 1, column_letter: 'B', header_raw: 'Citation', sample_values: ['Papike et al. (1998)'], target: 'metadata', analyte: null, chemical_form: null, unit: null, value_state: 'metadata', channel: null, confirmed: false, duplicate_of: null },
      { column_index: 6, column_letter: 'G', header_raw: 'Analyzed Material', sample_values: ['WHOLE ROCK', 'MINERAL'], target: 'metadata', analyte: null, chemical_form: null, unit: null, value_state: 'metadata', channel: null, confirmed: false, duplicate_of: null },
      { column_index: 10, column_letter: 'K', header_raw: 'La', sample_values: ['2.4', '1.1'], target: 'measurement', analyte: 'La', chemical_form: 'element', unit: 'ppm', value_state: 'raw_concentration', channel: null, confirmed: true, duplicate_of: null },
      { column_index: 23, column_letter: 'X', header_raw: 'Yb', sample_values: ['0.4', '1.2'], target: 'measurement', analyte: 'Yb', chemical_form: 'element', unit: 'ppm', value_state: 'raw_concentration', channel: null, confirmed: true, duplicate_of: null },
    ],
    issueRows: [[4200, '矿物记录被误判全岩的风险'], [8801, '缺分析对象']],
  },
];

export function buildPreview(file: File): ImportPreview {
  const sheets = SHEET_SPECS.map((s) => ({
    sheet_name: s.name,
    rows: s.rows,
    columns: s.cols,
    suggested_role: s.role,
    suggested_dataset_id: roleToDataset(s.name),
    role: s.role,
    enabled: s.role !== 'ignored',
  }));
  const columns: ImportPreview['columns'] = [];
  for (const spec of SHEET_SPECS) {
    for (const column of spec.columns) {
      columns.push({ ...column, sheet: spec.name });
    }
  }
  const issues: ImportPreview['issues'] = [
    { issue_id: 'iss_excel_error_main', severity: 'warning', kind: 'excel_error', sheet: '嫦娥搜集数据', row: null, column_letter: 'AJ', message: 'Mg#/An# 公式缓存含 2,943 个错误值（如 #DIV/0!）；整行其他有效浓度保留', count: 2943 },
    { issue_id: 'iss_excel_error_trace', severity: 'warning', kind: 'excel_error', sheet: 'CE with trace ele', row: 480, column_letter: 'BR', message: '公式缓存错误 60 个（如 #VALUE!）', count: 60 },
    { issue_id: 'iss_dup_header_raw', severity: 'blocker', kind: 'duplicate_header', sheet: '原始实验数据_合并', row: 75, column_letter: null, message: '第 75 行为嵌入式重复表头，将记入 skipped_rows', count: 1 },
    { issue_id: 'iss_empty_names', severity: 'warning', kind: 'empty_name', sheet: '原始实验数据_合并', row: null, column_letter: 'A', message: '13 行缺样品号，不使用上一行名称填充', count: 13 },
    { issue_id: 'iss_unknown_unit', severity: 'blocker', kind: 'unknown_unit', sheet: '实验数据汇总', row: null, column_letter: 'G:O', message: 'Si/Ti/Al/Fe/Mn/Mg/Ca/Na/K 无单位：建议 ppm 但需确认', count: 9 },
    { issue_id: 'iss_channel_conflict', severity: 'warning', kind: 'channel_conflict', sheet: '原始实验数据_合并', row: null, column_letter: 'BI:BJ', message: 'PbTotal 与 Pb204 等多通道并存，不合并为单一浓度', count: 4 },
    { issue_id: 'iss_overlap_535', severity: 'warning', kind: 'overlap', sheet: 'CE with trace ele', row: null, column_letter: null, message: '535 行关键字段与嫦娥主表匹配，其中 2 行多候选，默认主表投图', count: 535 },
    { issue_id: 'iss_dup_header_summary', severity: 'blocker', kind: 'duplicate_header', sheet: '实验数据汇总', row: null, column_letter: 'AZ/BB', message: '两列同名 (La/Yb)n：AZ 为公式、BB 为静态值，均保留原身份', count: 2 },
  ];
  return {
    preview_id: `preview_${Date.now().toString(36)}`,
    file_name: file.name,
    file_size: file.size,
    sha256: hashString(`${file.name}:${file.size}:${file.lastModified}`).padEnd(64, '0'),
    sheets,
    columns,
    head_rows: [
      ['sample', 'phase', 'source_file', 'La139_ppm_mean', 'Ce140_ppm_mean'],
      ['CE6-129-PX - 1', 'PX', '原始数据_1.xlsx', '2.31', '5.02'],
      ['CE6-118-GLASS - 1', 'GLASS', '原始数据_1.xlsx', '1.02', '2.40'],
      ['CE6-129-PX - 2', 'PX', '原始数据_1.xlsx', '2.28', '4.91'],
      ['', '', '', '', ''],
    ],
    issues,
    overlaps: [
      { derived_sheet: 'CE with trace ele', main_sheet: '嫦娥搜集数据', matched_rows: 535, multi_candidate_rows: 2, default_plot_source: 'main', note: '关键字段与测量值匹配；派生视图默认不新增独立点' },
    ],
  };
  function roleToDataset(name: string): string | null {
    if (name === 'Apollo数据') return DATA_IDS.apollo;
    if (name === '嫦娥搜集数据') return DATA_IDS.ce;
    if (name === '实验数据汇总') return DATA_IDS.ownSummary;
    if (name === '原始实验数据_合并') return DATA_IDS.ownRaw;
    if (name === 'CE with trace ele') return DATA_IDS.ceTrace;
    return null;
  }
}

export function buildImportReport(preview: ImportPreview): ImportReport {
  const datasets: Dataset[] = [];
  const report: ImportReport['report'] = [];
  for (const sheet of preview.sheets.filter((s) => s.enabled && s.role === 'samples')) {
    const datasetId = sheet.suggested_dataset_id ?? `ds_${sheet.sheet_name}`;
    const existing = DATASETS.find((d) => d.dataset_id === datasetId);
    const physical = sheet.rows - 1;
    const skipped = sheet.sheet_name === '原始实验数据_合并' ? 1 : 0;
    const quarantined = Math.max(0, Math.round(physical * 0.004));
    const linked = sheet.sheet_name === 'CE with trace ele' ? 535 : 0;
    const accepted = physical - skipped - quarantined;
    datasets.push({
      dataset_id: datasetId,
      version: existing?.version ?? '1',
      label: existing?.label ?? sheet.sheet_name,
      role: existing?.role ?? 'own',
      file_id: `file_${preview.preview_id}`,
      sheets: [sheet.sheet_name],
      counts: { physical_rows: physical, accepted_analyses: accepted, quarantined_rows: quarantined, skipped_rows: skipped, linked_derived_rows: linked },
      mapping_version: 'mv_import_1',
      created_at: new Date().toISOString(),
    });
    report.push({
      sheet: sheet.sheet_name,
      physical_rows: physical,
      accepted,
      quarantined,
      skipped,
      linked_derived: linked,
      unit_proposals: [
        { group: `${sheet.sheet_name} 浓度列`, unit: 'ppm', state: 'proposed' },
        { group: `${sheet.sheet_name} 氧化物列`, unit: 'wt%', state: 'proposed' },
      ],
    });
  }
  return { datasets, report };
}

export function makeExportFiles(
  exportId: string,
  formats: string[],
  relativeDir: string,
  root: string,
  includeBundle: boolean,
  namePrefix = '',
): ExportFile[] {
  const files: ExportFile[] = formats.map((format) => ({
    artifact_id: `art_${exportId}_${format}`,
    filename: `${namePrefix}figure.${format}`,
    format: format as ExportFile['format'],
    byte_size: format === 'png' ? 1_284_331 : format === 'pdf' ? 96_420 : 214_887,
    sha256: hashString(`${exportId}:${format}`).padEnd(64, 'a'),
    absolute_path: `${root}\\${relativeDir}\\${namePrefix}figure.${format}`,
    exists: true,
  }));
  if (includeBundle) {
    const bundle: Array<[string, ExportFile['format'], number]> = [
      ['plot_spec.json', 'json', 18_240],
      ['scene.json', 'json', 220_418],
      ['plot_data.csv', 'csv', 34_802],
      ['excluded_records.csv', 'csv', 1_204],
      ['reference_snapshot.json', 'json', 2_884],
      ['provenance.json', 'json', 9_102],
      ['font_manifest.json', 'json', 640],
      ['README.md', 'md', 1_820],
    ];
    for (const [name, format, size] of bundle) {
      files.push({
        artifact_id: null,
        filename: name,
        format,
        byte_size: size,
        sha256: hashString(`${exportId}:${name}`).padEnd(64, 'b'),
        absolute_path: `${root}\\${relativeDir}\\${name}`,
        exists: true,
      });
    }
  }
  return files;
}

export type { Job, ExportRecord };
