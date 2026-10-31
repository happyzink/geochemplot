/**
 * 演示模式 fixture（SYNTHETIC）。
 *
 * 仅用于合同就绪前的界面开发与交互检查；记录数值为合成值，不代表真实月球样品。
 * 真实参考组成固定取 13 文档与 pyrolite 数值库：Chondrite_MS95@1 14 元素、
 * PM_SM89@1 27 元素。禁止把本文件称为真实工作簿数据。
 */

import type {
  CatalogEntry,
  Dataset,
  ReferenceComposition,
  AnalysisSummary,
  Mission,
  MaterialType,
  MineralGroup,
} from '../generated/types';

export const REE_ELEMENTS = ['La', 'Ce', 'Pr', 'Nd', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb', 'Lu'] as const;

export const SPIDER_ELEMENTS = [
  'Cs', 'Rb', 'Ba', 'Th', 'U', 'Nb', 'Ta', 'La', 'Ce', 'Pb', 'Pr', 'Sr', 'Nd', 'Zr', 'Hf',
  'Sm', 'Eu', 'Ti', 'Gd', 'Tb', 'Dy', 'Y', 'Ho', 'Er', 'Tm', 'Yb', 'Lu',
] as const;

export const CHONDRITE_VALUES: Record<string, number> = {
  La: 0.237, Ce: 0.613, Pr: 0.0928, Nd: 0.457, Sm: 0.148, Eu: 0.0563, Gd: 0.199,
  Tb: 0.0361, Dy: 0.246, Ho: 0.0546, Er: 0.16, Tm: 0.0247, Yb: 0.161, Lu: 0.0246,
};

export const PM_VALUES: Record<string, number> = {
  Cs: 0.032, Rb: 0.635, Ba: 6.989, Th: 0.085, U: 0.021, Nb: 0.713, Ta: 0.041, La: 0.687,
  Ce: 1.775, Pb: 0.185, Pr: 0.276, Sr: 21.1, Nd: 1.354, Zr: 11.2, Hf: 0.309, Sm: 0.444,
  Eu: 0.168, Ti: 1300, Gd: 0.596, Tb: 0.108, Dy: 0.737, Y: 4.55, Ho: 0.164, Er: 0.48,
  Tm: 0.074, Yb: 0.493, Lu: 0.074,
};

const ppmUnits = (elements: readonly string[]): Record<string, string> =>
  Object.fromEntries(elements.map((e) => [e, 'ppm']));

export const REFERENCES: ReferenceComposition[] = [
  {
    ref_id: 'Chondrite_MS95',
    version: '1',
    label: 'Chondrite_MS95@1',
    elements: [...REE_ELEMENTS],
    values: CHONDRITE_VALUES,
    units: ppmUnits(REE_ELEMENTS),
    citation: 'McDonough & Sun (1995), The composition of the Earth；数值取自 pyrolite 维护者参考库（数值数据库核对）',
    verification_status: '数值数据库核对',
    hash: 'fixture_chondrite_ms95_v1',
    is_custom: false,
    note: 'REE 默认参考组成；14 元素，单位 ppm。',
  },
  {
    ref_id: 'PM_SM89',
    version: '1',
    label: 'PM_SM89@1',
    elements: [...SPIDER_ELEMENTS],
    values: PM_VALUES,
    units: ppmUnits(SPIDER_ELEMENTS),
    citation: 'Sun & McDonough (1989)；数值取自 pyrolite 维护者参考库（数值数据库核对）',
    verification_status: '数值数据库核对',
    hash: 'fixture_pm_sm89_v1',
    is_custom: false,
    note: '蛛网默认参考组成；27 元素，单位 ppm。Ti 为元素 Ti(ppm)，不是 TiO₂。',
  },
  {
    ref_id: 'workbook_custom_ree_v1',
    version: '1',
    label: '工作簿自定义 REE 参考值（出处待确认）',
    elements: [...REE_ELEMENTS],
    values: CHONDRITE_VALUES,
    units: ppmUnits(REE_ELEMENTS),
    citation: '来源：用户工作簿 Normalization value 表；作者/年份/单位未确认',
    verification_status: '出处待确认',
    hash: 'fixture_workbook_custom_ree_v1',
    is_custom: true,
    note: '数值与 MS95 相同不代表作者引用了该文献；单位使用前需确认。',
  },
];

export const DATA_IDS = {
  apollo: 'lunar_apollo_0910',
  ce: 'lunar_ce_0910',
  ownSummary: 'own_summary_0910',
  ownRaw: 'own_raw_0910',
  ceTrace: 'ce_trace_view_0910',
  tutorial: 'tutorial_synthetic_0910',
} as const;

export const DATASETS: Dataset[] = [
  {
    dataset_id: 'ds_apollo', version: '1', label: 'Apollo文献数据', role: 'literature', file_id: 'file_lunar_workbook',
    sheets: ['Apollo数据'], counts: { physical_rows: 35802, accepted_analyses: 134, quarantined_rows: 0, skipped_rows: 0, linked_derived_rows: 0 },
    mapping_version: 'mv_fixture_1', created_at: '2026-10-28T09:00:00+08:00',
  },
  {
    dataset_id: 'ds_ce', version: '1', label: '嫦娥文献数据', role: 'literature', file_id: 'file_lunar_workbook',
    sheets: ['嫦娥搜集数据'], counts: { physical_rows: 8348, accepted_analyses: 122, quarantined_rows: 0, skipped_rows: 0, linked_derived_rows: 0 },
    mapping_version: 'mv_fixture_1', created_at: '2026-10-28T09:00:00+08:00',
  },
  {
    dataset_id: 'ds_own_summary', version: '1', label: '我的实验数据·汇总', role: 'own', file_id: 'file_lunar_workbook',
    sheets: ['实验数据汇总'], counts: { physical_rows: 259, accepted_analyses: 40, quarantined_rows: 0, skipped_rows: 0, linked_derived_rows: 0 },
    mapping_version: 'mv_fixture_1', created_at: '2026-10-28T09:00:00+08:00',
  },
  {
    dataset_id: 'ds_own_raw', version: '1', label: '我的实验数据·原始', role: 'own', file_id: 'file_lunar_workbook',
    sheets: ['原始实验数据_合并'], counts: { physical_rows: 374, accepted_analyses: 20, quarantined_rows: 0, skipped_rows: 1, linked_derived_rows: 0 },
    mapping_version: 'mv_fixture_1', created_at: '2026-10-28T09:00:00+08:00',
  },
  {
    dataset_id: 'ds_ce_trace', version: '1', label: '嫦娥微量元素视图', role: 'derived_view', file_id: 'file_lunar_workbook',
    sheets: ['CE with trace ele'], counts: { physical_rows: 535, accepted_analyses: 15, quarantined_rows: 0, skipped_rows: 0, linked_derived_rows: 15 },
    mapping_version: 'mv_fixture_1', created_at: '2026-10-28T09:00:00+08:00',
  },
  {
    dataset_id: 'ds_tutorial', version: '1', label: '教程合成示例（SYNTHETIC）', role: 'comparison', file_id: 'file_synthetic_tutorial',
    sheets: ['SYNTHETIC'], counts: { physical_rows: 1, accepted_analyses: 1, quarantined_rows: 0, skipped_rows: 0, linked_derived_rows: 0 },
    mapping_version: 'mv_fixture_1', created_at: '2026-10-28T09:00:00+08:00',
  },
];

export const CATALOG: CatalogEntry[] = [
  { data_id: DATA_IDS.apollo, label: 'Apollo文献数据', sheet: 'Apollo数据', record_baseline: 35802, role: 'literature', default_visible: true, attached: true, dataset_id: 'ds_apollo', version: '1', unit_confirmation_pending: 0, note: '演示模式载入 134 条合成记录；全岩/矿物/玻璃分开筛选。' },
  { data_id: DATA_IDS.ce, label: '嫦娥文献数据', sheet: '嫦娥搜集数据', record_baseline: 8348, role: 'literature', default_visible: true, attached: true, dataset_id: 'ds_ce', version: '1', unit_confirmation_pending: 0, note: 'CE5/CE6 为同一库筛选视图，不复制两套记录。' },
  { data_id: DATA_IDS.ownSummary, label: '我的实验数据·汇总', sheet: '实验数据汇总', record_baseline: 259, role: 'own', default_visible: true, attached: true, dataset_id: 'ds_own_summary', version: '1', unit_confirmation_pending: 9, note: 'task 混合批次/任务；LABLE、MOUNT 保持 batch。' },
  { data_id: DATA_IDS.ownRaw, label: '我的实验数据·原始', sheet: '原始实验数据_合并', record_baseline: 374, role: 'own', default_visible: false, attached: true, dataset_id: 'ds_own_raw', version: '1', unit_confirmation_pending: 0, note: '默认折叠，仅供追溯；第 75 行重复表头跳过。' },
  { data_id: DATA_IDS.ceTrace, label: '嫦娥微量元素视图', sheet: 'CE with trace ele', record_baseline: 535, role: 'derived_view', default_visible: true, attached: true, dataset_id: 'ds_ce_trace', version: '1', unit_confirmation_pending: 0, note: '主表派生视图，不额外增加独立点。' },
  { data_id: 'workbook_custom_ree_v1', label: '工作簿自定义REE标准', sheet: 'Normalization value', record_baseline: 14, role: 'derived_view', default_visible: true, attached: true, dataset_id: null, version: null, unit_confirmation_pending: 1, note: '仅作为参考组成入口，不出现在样品树。' },
];

/* ------------------------------------------------------------------ */
/* 合成分析记录                                                        */
/* ------------------------------------------------------------------ */

const OXIDES = ['SiO2', 'TiO2', 'Al2O3', 'FeOT', 'MnO', 'MgO', 'CaO', 'Na2O', 'K2O', 'P2O5'];

export interface MockAnalysis extends AnalysisSummary {
  dataset_id: string;
  values: Record<string, number | null>;
  units: Record<string, string>;
  unconfirmed_units: string[];
  synthetic: boolean;
  linked_derived_to?: string;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20261028);
const between = (lo: number, hi: number) => lo + (hi - lo) * rand();
const skewed = (median: number, spread: number) => median * Math.exp((rand() - 0.5) * spread);

const REE_SHAPE: Record<string, number> = {
  La: 1, Ce: 2.2, Pr: 0.26, Nd: 1.15, Sm: 0.34, Eu: 0.12, Gd: 0.36, Tb: 0.06,
  Dy: 0.42, Ho: 0.09, Er: 0.25, Tm: 0.035, Yb: 0.24, Lu: 0.036,
};

const SPIDER_SHAPE: Record<string, number> = {
  Cs: 0.03, Rb: 0.9, Ba: 18, Th: 0.09, U: 0.03, Nb: 2.1, Ta: 0.12, Pb: 0.4, Sr: 60,
  Zr: 25, Hf: 0.7, Ti: 900, Y: 8, Pr: 0.3, Nd: 1.2, Sm: 0.34, Eu: 0.12, Gd: 0.36,
  Tb: 0.06, Dy: 0.42, Ho: 0.09, Er: 0.25, Tm: 0.035, Yb: 0.24, Lu: 0.036,
};

function buildValues(level: number, missingRate: number): Record<string, number | null> {
  const values: Record<string, number | null> = {};
  for (const el of REE_ELEMENTS) {
    values[el] = rand() < missingRate ? null : Number((level * REE_SHAPE[el] * between(0.75, 1.25)).toFixed(4));
  }
  for (const el of SPIDER_ELEMENTS) {
    if (values[el] != null) continue;
    if (['La', 'Ce', 'Pr', 'Nd', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb', 'Lu'].includes(el)) continue;
    values[el] = rand() < missingRate ? null : Number((level * SPIDER_SHAPE[el] * between(0.75, 1.25)).toFixed(4));
  }
  return values;
}

function buildOxides(): Record<string, number | null> {
  const raw = {
    SiO2: between(43, 55),
    TiO2: between(0.6, 3.4),
    Al2O3: between(9, 19),
    FeOT: between(7, 19),
    MnO: between(0.1, 0.4),
    MgO: between(4, 13),
    CaO: between(7, 15),
    Na2O: between(0.8, 6.5),
    K2O: between(0.05, 2.4),
    P2O5: between(0.05, 1.1),
  };
  const sum = Object.values(raw).reduce((a, b) => a + b, 0);
  const scaled: Record<string, number | null> = {};
  for (const [k, v] of Object.entries(raw)) scaled[k] = Number(((v / sum) * 100).toFixed(3));
  return scaled;
}

interface RowSeed {
  dataset_id: string;
  mission: Mission;
  material: MaterialType;
  mineral: MineralGroup;
  phase: string | null;
  raw_name: string;
  parent: string | null;
  subsample: string | null;
  batch: string | null;
  citation: string | null;
  sheet: string;
  row: number;
  rock_type?: string | null;
  missingRate?: number;
  oxides?: boolean;
}

function makeAnalysis(seed: RowSeed, index: number): MockAnalysis {
  const level = seed.material === 'mineral' ? skewed(1.6, 2.2) : skewed(2.6, 1.8);
  const values = buildValues(level, seed.missingRate ?? 0.06);
  if (seed.oxides) Object.assign(values, buildOxides());
  if (seed.material === 'mineral') {
    // 矿物分析不提供完整主量，避免被误用于 TAS 无挥发分重算
    for (const ox of OXIDES) if (ox !== 'SiO2' && ox !== 'TiO2') delete values[ox];
    values.SiO2 = values.SiO2 ?? null;
    values.TiO2 = values.TiO2 ?? null;
  }
  const units: Record<string, string> = {};
  for (const key of Object.keys(values)) {
    units[key] = OXIDES.includes(key) ? 'wt%' : 'ppm';
  }
  const unconfirmed: string[] = [];
  if (seed.dataset_id === 'ds_own_summary' || seed.dataset_id === 'ds_ce_trace') {
    // 来源无单位列：演示 proposed 状态，未确认的单位不参与图
    unconfirmed.push('SiO2', 'TiO2', 'Al2O3');
  }
  return {
    analysis_id: `an_${seed.dataset_id}_${index}`,
    sample_id: `sp_${seed.dataset_id}_${index}`,
    raw_name: seed.raw_name,
    parent_sample: seed.parent,
    subsample: seed.subsample,
    mission: seed.mission,
    batch: seed.batch,
    material_type: seed.material,
    mineral_group: seed.mineral,
    phase: seed.phase,
    rock_type: seed.rock_type ?? null,
    citation: seed.citation,
    source: { file_id: 'file_lunar_workbook', sheet: seed.sheet, row: seed.row },
    quality_flags: [],
    dataset_id: seed.dataset_id,
    values,
    units,
    unconfirmed_units: unconfirmed,
    synthetic: true,
  };
}

function buildApollo(): MockAnalysis[] {
  const rows: MockAnalysis[] = [];
  const exact = ['74235', '74235', '74235', '74235'];
  const variants = [
    ['74235,62', '62'], ['74235,62', '62'], ['74235,52', '52'], ['74235,52', '52'],
    ['74235,52', '52'], ['74235,52', '52'], ['74235, 41', ' 41'], ['74235,18', '18'],
    ['74235,21', '21'], ['74235,23', '23'],
  ];
  let row = 2;
  exact.forEach((name, i) => {
    rows.push(
      makeAnalysis(
        {
          dataset_id: 'ds_apollo', mission: 'Apollo', material: 'whole_rock', mineral: 'unknown', phase: null,
          raw_name: name, parent: '74235', subsample: null, batch: null,
          citation: ['Papike et al. (1998)', 'Korotev et al. (2003)', 'Warren (2005)', 'Haskin et al. (1998)'][i],
          sheet: 'Apollo数据', row, rock_type: 'basalt', oxides: true, missingRate: 0.02,
        },
        rows.length,
      ),
    );
    row += 1;
  });
  variants.forEach(([name, sub]) => {
    rows.push(
      makeAnalysis(
        {
          dataset_id: 'ds_apollo', mission: 'Apollo', material: 'whole_rock', mineral: 'unknown', phase: null,
          raw_name: name, parent: '74235', subsample: sub.trim(), batch: null,
          citation: 'Apollo sample compilation (synthetic fixture)',
          sheet: 'Apollo数据', row, rock_type: 'basalt', oxides: true, missingRate: 0.02,
        },
        rows.length,
      ),
    );
    row += 1;
  });
  for (let i = 0; i < 120; i += 1) {
    const material: MaterialType = i % 5 === 0 ? 'glass' : i % 3 === 0 ? 'mineral' : 'whole_rock';
    const mineral: MineralGroup = material === 'mineral' ? (i % 2 === 0 ? 'pyroxene' : 'plagioclase') : 'unknown';
    const parent = ['12001', '15426', '70017', '15555', '12022', '742350'][i % 6];
    rows.push(
      makeAnalysis(
        {
          dataset_id: 'ds_apollo', mission: 'Apollo', material, mineral,
          phase: material === 'mineral' ? (mineral === 'pyroxene' ? 'AUG' : 'PL') : material === 'glass' ? 'GLASS' : null,
          raw_name: i % 7 === 0 ? `${parent},${i}` : parent,
          parent, subsample: i % 7 === 0 ? String(i) : null, batch: null,
          citation: i % 4 === 0 ? 'Apollo 17 sample compilation' : 'Lunar sample literature (synthetic fixture)',
          sheet: 'Apollo数据', row: row + i, rock_type: material === 'whole_rock' ? 'basalt' : 'rock',
          oxides: material === 'whole_rock', missingRate: 0.08,
        },
        rows.length,
      ),
    );
  }
  return rows;
}

function buildCe(): MockAnalysis[] {
  const rows: MockAnalysis[] = [];
  let row = 2;
  for (let i = 0; i < 120; i += 1) {
    const mission: Mission = i < 70 ? 'CE5' : i < 112 ? 'CE6' : 'unknown';
    const material: MaterialType = i % 4 === 0 ? 'glass' : i % 3 === 0 ? 'whole_rock' : 'mineral';
    const mineral: MineralGroup = material === 'mineral' ? (i % 2 === 0 ? 'pyroxene' : 'plagioclase') : 'unknown';
    const parent = [ 'CE5-101', 'CE6-129', 'CE5-036', 'CE6-118', 'CE5-155' ][i % 5];
    rows.push(
      makeAnalysis(
        {
          dataset_id: 'ds_ce', mission, material, mineral,
          phase: material === 'mineral' ? (mineral === 'pyroxene' ? 'PX' : 'Plg') : material === 'glass' ? 'GLASS' : null,
          raw_name: `${parent}-${material === 'mineral' ? (mineral === 'pyroxene' ? 'PX' : 'PL') : material === 'glass' ? 'GLASS' : 'WR'} - ${(i % 3) + 1}`,
          parent, subsample: String((i % 3) + 1), batch: null,
          citation: i < 70 ? '嫦娥五号样品研究（合成 fixture）' : '嫦娥六号样品研究（合成 fixture）',
          sheet: '嫦娥搜集数据', row, rock_type: material === 'whole_rock' ? 'basalt' : null,
          oxides: material === 'whole_rock', missingRate: 0.1,
        },
        rows.length,
      ),
    );
    row += 1;
  }
  return rows;
}

function buildOwnSummary(): MockAnalysis[] {
  const rows: MockAnalysis[] = [];
  let row = 2;
  for (let i = 0; i < 40; i += 1) {
    const task = ['CE6', 'CE5', 'LABLE', 'MOUNT-2', 'MOUNT-3'][i % 5];
    const mission: Mission = task === 'CE6' ? 'CE6' : task === 'CE5' ? 'CE5' : 'unknown';
    const material: MaterialType = i % 4 === 0 ? 'glass' : i % 3 === 0 ? 'whole_rock' : 'mineral';
    const mineral: MineralGroup = material === 'mineral' ? (i % 2 === 0 ? 'pyroxene' : 'plagioclase') : 'unknown';
    const parent = ['CE6-118', 'CE6-129', 'CE5-101', 'LABLE-A', 'MOUNT-2-B'][i % 5];
    rows.push(
      makeAnalysis(
        {
          dataset_id: 'ds_own_summary', mission, material, mineral,
          phase: material === 'mineral' ? (mineral === 'pyroxene' ? 'PX' : 'PL') : material === 'glass' ? 'GLASS' : null,
          raw_name: `${parent}${material === 'glass' ? '-GLASS' : material === 'mineral' ? `-${mineral === 'pyroxene' ? 'PX' : 'PL'}` : ''} - ${(i % 3) + 1}`,
          parent, subsample: String((i % 3) + 1), batch: task.startsWith('LABLE') || task.startsWith('MOUNT') ? task : null,
          citation: '本研究实测（合成 fixture）',
          sheet: '实验数据汇总', row, rock_type: null, oxides: material === 'whole_rock', missingRate: 0.05,
        },
        rows.length,
      ),
    );
    row += 1;
  }
  return rows;
}

function buildOwnRaw(): MockAnalysis[] {
  const rows: MockAnalysis[] = [];
  for (let i = 0; i < 20; i += 1) {
    rows.push(
      makeAnalysis(
        {
          dataset_id: 'ds_own_raw', mission: i % 2 === 0 ? 'CE6' : 'CE5', material: i % 3 === 0 ? 'mineral' : 'whole_rock',
          mineral: i % 3 === 0 ? 'pyroxene' : 'unknown', phase: i % 3 === 0 ? 'PX' : null,
          raw_name: `RAW-${i + 1}`, parent: `RAW-${(i % 4) + 1}`, subsample: String(i + 1), batch: null,
          citation: '原始实验数据（合成 fixture）', sheet: '原始实验数据_合并', row: i + 3,
          oxides: false, missingRate: 0.12,
        },
        rows.length,
      ),
    );
  }
  return rows;
}

function buildCeTrace(): MockAnalysis[] {
  const rows: MockAnalysis[] = [];
  for (let i = 0; i < 15; i += 1) {
    rows.push({
      ...makeAnalysis(
        {
          dataset_id: 'ds_ce_trace', mission: 'CE5', material: 'mineral', mineral: 'pyroxene', phase: 'pyroxene',
          raw_name: `CE5-036-004-py-${(i % 8) + 1}`, parent: 'CE5-036', subsample: String((i % 8) + 1), batch: null,
          citation: '嫦娥五号 trace 视图（合成 fixture）', sheet: 'CE with trace ele', row: i + 2,
          oxides: false, missingRate: 0.08,
        },
        rows.length,
      ),
      linked_derived_to: 'an_ds_ce_2',
    });
  }
  return rows;
}

export const TUTORIAL_ANALYSIS: MockAnalysis = {
  analysis_id: 'an_tutorial_001',
  sample_id: 'sp_tutorial_001',
  raw_name: 'SYNTHETIC-EXAMPLE',
  parent_sample: 'SYNTHETIC-EXAMPLE',
  subsample: null,
  mission: 'unknown',
  batch: null,
  material_type: 'whole_rock',
  mineral_group: 'unknown',
  phase: null,
  rock_type: null,
  citation: '教程合成示例：Rb=10ppm、Sr=100ppm、La=2.37ppm、Yb=0.322ppm（显式 SYNTHETIC）',
  source: { file_id: 'file_synthetic_tutorial', sheet: 'SYNTHETIC', row: 2 },
  quality_flags: [],
  dataset_id: 'ds_tutorial',
  values: {
    Rb: 10, Sr: 100, La: 2.37, Yb: 0.322, Ce: 0.613, Pr: 0.0928, Nd: 0.457, Sm: 0.148,
    Eu: 0.0563, Gd: 0.199, Tb: 0.0361, Dy: 0.246, Ho: 0.0546, Er: 0.16, Tm: 0.0247, Lu: 0.0246,
    Cs: 0.032, Ba: 6.989, Th: 0.085, U: 0.021, Nb: 0.713, Ta: 0.041, Pb: 0.185, Zr: 11.2,
    Hf: 0.309, Ti: 1300, Y: 4.55,
    SiO2: 50, TiO2: 2, Al2O3: 15, FeOT: 10, MnO: 0.2, MgO: 6, CaO: 10, Na2O: 2, K2O: 1, P2O5: 0.5,
  },
  units: {
    ...Object.fromEntries([...REE_ELEMENTS, ...SPIDER_ELEMENTS, 'Rb', 'Sr'].map((e) => [e, 'ppm'])),
    ...Object.fromEntries(OXIDES.map((o) => [o, 'wt%'])),
  },
  unconfirmed_units: [],
  synthetic: true,
};

export const ANALYSES: MockAnalysis[] = [
  ...buildApollo(),
  ...buildCe(),
  ...buildOwnSummary(),
  ...buildOwnRaw(),
  ...buildCeTrace(),
  TUTORIAL_ANALYSIS,
];

export const DATASETS_BY_ID: Record<string, Dataset> = Object.fromEntries(DATASETS.map((d) => [d.dataset_id, d]));

export function referenceByKey(refId: string | null, version: string | null): ReferenceComposition | null {
  if (!refId) return null;
  return REFERENCES.find((r) => r.ref_id === refId && (!version || r.version === version)) ?? null;
}
