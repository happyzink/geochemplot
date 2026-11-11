import { create } from 'zustand';
import { ApiError, pollJob, type ApiClient } from '../lib/api/client';
import type { ClientResolution } from '../lib/api';
import type {
  AnalysisDetail,
  AnalysisQueryResponse,
  AnalysisSummary,
  AxisSpec,
  CatalogEntry,
  ChartType,
  Dataset,
  ExportRecord,
  ExportRoot,
  Facets,
  Figure,
  FigureDraft,
  FigureRevision,
  LayoutSpec,
  LayerSpec,
  LayerStyle,
  PlotScene,
  PlotSpec,
  Project,
  QueryFilter,
  ReferenceComposition,
  SelectionSet,
} from '../lib/generated/types';
import {
  CONTRAST_STYLE,
  DEFAULT_STYLE,
  defaultAxis,
  describeExpression,
  measurement,
} from '../lib/expressions';
import { REE_ELEMENTS, SPIDER_ELEMENTS } from '../lib/elements';

export type Page = 'import' | 'workspace' | 'figures' | 'exports' | 'projects';
export type RightTab = 'variables' | 'layers' | 'style' | 'layout';
export type ComputeState = 'idle' | 'computing' | 'ready' | 'error';
export type ToastKind = 'info' | 'success' | 'error';

interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

interface SelectionState {
  ids: Set<string>;
  intent: 'explicit' | 'filter';
  saved: SelectionSet | null;
}

export interface SeriesPanelTarget {
  analysisId: string | null;
  layerId: string;
  scope: 'current' | 'all' | 'selected';
}

export interface AxisPanelTarget {
  axis: 'x' | 'y';
}

interface Snapshot {
  spec: PlotSpec;
  label: string;
}

interface WorkspaceState {
  booted: boolean;
  client: ApiClient | null;
  mode: 'mock' | 'live';
  modeReason: string;
  bootError: string | null;
  page: Page;
  rightTab: RightTab;
  toasts: Toast[];

  catalog: CatalogEntry[];
  datasets: Dataset[];
  references: ReferenceComposition[];
  pendingConfirmations: number;
  projects: Project[];
  project: Project | null;

  facets: Facets | null;
  filter: QueryFilter;
  searchMode: 'exact' | 'parent' | 'contains';
  searchText: string;
  activeDatasetIds: string[];
  activeLayerId: string | null;

  analyses: AnalysisSummary[];
  analysesTotal: number;
  analysesCounts: AnalysisQueryResponse['counts'] | null;
  analysesLoading: boolean;
  analysesOffset: number;
  pageSize: number;

  selection: SelectionState;
  filteredIdsForDeselect: string[];

  chartType: ChartType;
  spec: PlotSpec;
  scene: PlotScene | null;
  computeState: ComputeState;
  sceneError: string | null;
  stale: boolean;
  lastComputeAt: string | null;

  figure: Figure | null;
  draft: FigureDraft | null;
  revisions: FigureRevision[];
  figures: Figure[];
  autosaveState: 'idle' | 'pending' | 'saving' | 'saved' | 'conflict' | 'error';
  autosaveError: string | null;
  lastSavedAt: string | null;

  undoStack: Snapshot[];
  redoStack: Snapshot[];

  axisPanel: AxisPanelTarget | null;
  seriesPanel: SeriesPanelTarget | null;
  legendEditorOpen: boolean;
  referencePickerOpen: boolean;
  selectedAnalysisId: string | null;
  selectedAnalysisDetail: AnalysisDetail | null;
  highlightIds: string[];
  hoverAnalysisId: string | null;

  exports: ExportRecord[];
  exportRoots: ExportRoot[];
  exportsLoading: boolean;
  activeExportJob: { exportId: string; jobId: string } | null;

  bottomTab: 'samples' | 'points';
  leftCollapsed: boolean;
  rightCollapsed: boolean;

  init: (resolution: ClientResolution) => Promise<void>;
  reload: () => Promise<void>;
  setPage: (page: Page) => void;
  setRightTab: (tab: RightTab) => void;
  toast: (kind: ToastKind, text: string) => void;
  dismissToast: (id: number) => void;

  setProject: (projectId: string) => Promise<void>;
  setFilter: (patch: Partial<QueryFilter>) => Promise<void>;
  setSearch: (mode: 'exact' | 'parent' | 'contains', text: string) => Promise<void>;
  setSearchMode: (mode: 'exact' | 'parent' | 'contains') => void;
  setSearchText: (text: string) => void;
  toggleDataset: (datasetId: string) => Promise<void>;
  loadAnalyses: (offset?: number) => Promise<void>;
  setActiveLayer: (layerId: string | null) => void;

  toggleAnalysis: (analysisId: string) => void;
  togglePage: () => void;
  clearSelection: () => void;
  selectAllFiltered: () => Promise<void>;
  deselectFiltered: () => Promise<void>;
  saveSelection: (name: string) => Promise<SelectionSet | null>;
  addSelectionLayer: (mode: 'layer' | 'compare', name?: string) => Promise<void>;

  setChartType: (type: ChartType) => void;
  setVariableX: (expr: PlotSpec['variables']['x']) => void;
  setVariableY: (expr: PlotSpec['variables']['y']) => void;
  setElements: (elements: string[]) => void;
  setValueMode: (mode: 'raw' | 'normalized') => void;
  setReference: (refId: string, version: string) => void;
  setQualityPolicy: (patch: Partial<PlotSpec['quality_policy']>) => void;
  setTasDiagram: (diagram: PlotSpec['diagram']) => void;

  updateAxis: (axis: 'x' | 'y', patch: Partial<AxisSpec>) => void;
  updateLayerStyle: (layerId: string, patch: Partial<LayerStyle>) => void;
  updateOverrides: (layerId: string, analysisIds: string[], patch: Partial<LayerStyle>) => void;
  clearOverrides: (layerId: string, analysisIds?: string[]) => void;
  setLayout: (patch: Partial<LayoutSpec>) => void;
  setLegend: (patch: Partial<LayoutSpec['legend']>) => void;
  setLegendAnchor: (x: number, y: number) => void;
  addAnnotation: (text: string) => void;
  updateAnnotation: (id: string, patch: Partial<LayoutSpec['annotations'][number]>) => void;
  removeAnnotation: (id: string) => void;
  commitSpec: (next: PlotSpec, label: string, options?: { history?: boolean }) => void;

  toggleLayerVisible: (layerId: string) => void;
  renameLayer: (layerId: string, label: string) => void;
  duplicateLayer: (layerId: string) => void;
  removeLayer: (layerId: string) => void;
  moveLayer: (layerId: string, direction: -1 | 1) => void;

  undo: () => void;
  redo: () => void;
  runCompute: () => Promise<void>;

  setAxisPanel: (target: AxisPanelTarget | null) => void;
  setSeriesPanel: (target: SeriesPanelTarget | null) => void;
  setLegendEditor: (open: boolean) => void;
  setReferencePicker: (open: boolean) => void;
  setSelectedAnalysis: (id: string | null) => Promise<void>;
  setHighlight: (ids: string[]) => void;
  applyHighlightToSelection: () => void;
  setHover: (id: string | null) => void;
  setViewportRange: (axis: 'x' | 'y', range: [number, number]) => void;
  useCurrentViewForExport: (ranges: { x?: [number, number]; y?: [number, number] }) => void;
  setBottomTab: (tab: 'samples' | 'points') => void;
  toggleLeft: () => void;
  toggleRight: () => void;

  openFigure: (figureId: string) => Promise<void>;
  refreshFigures: () => Promise<void>;
  newFigure: (name: string) => Promise<void>;
  saveDraftNow: (options?: { silent?: boolean }) => Promise<boolean>;
  saveRevision: () => Promise<FigureRevision | null>;
  restoreRevision: (revisionId: string) => Promise<void>;
  renameFigure: (name: string) => Promise<void>;
  archiveFigure: (archived: boolean) => Promise<void>;

  loadExports: () => Promise<void>;
  loadExportRoots: () => Promise<void>;
  chooseExportRoot: () => Promise<ExportRoot | null>;
  registerExportRoot: (path: string) => Promise<ExportRoot | null>;
  startExport: (input: { formats: Array<'png' | 'pdf' | 'svg'>; dpi: number | null; background: 'white' | 'transparent'; width: number; height: number; exportRootId: string }) => Promise<void>;
  reexport: (exportId: string, exportRootId?: string) => Promise<void>;
  openExportFolder: (exportId: string) => Promise<void>;
  refreshExport: (exportId: string) => Promise<void>;
  demoRemoveFile: (exportId: string, filename: string) => Promise<void>;
  saveProjectName: (name: string) => Promise<void>;
  createProject: (name: string) => Promise<void>;
  demoReset: () => Promise<void>;
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const LAYER_COLORS = ['#D55E00', '#0072B2', '#009E73', '#6B6B6B', '#CC79A7', '#E69F00', '#56B4E9', '#F0E442'];

let api: ApiClient | null = null;
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
let computeTimer: ReturnType<typeof setTimeout> | null = null;
let computeGate = 0;
let toastSeq = 0;

function emptySpec(): PlotSpec {
  return {
    schema_version: '1.1',
    plot_id: 'plot_new',
    revision: 1,
    chart_type: 'scatter',
    layers: [],
    variables: {
      x: measurement('MgO', 'wt%', 'oxide'),
      y: measurement('SiO2', 'wt%', 'oxide'),
      elements: [...REE_ELEMENTS],
      value_mode: 'normalized',
      reference_id: 'Chondrite_MS95',
      reference_version: '1',
    },
    quality_policy: { censored: 'exclude', nonpositive_log: 'exclude', missing_spider: 'gap', unconfirmed_unit: 'exclude' },
    axes: { x: defaultAxis('linear'), y: defaultAxis('linear') },
    layout: {
      width_mm: 183,
      height_mm: 110,
      preset: 'nature_main_2026',
      font_family: 'Arial',
      font_size_pt: 7,
      tick_font_size_pt: 6,
      legend: { position: 'right', anchor_x: null, anchor_y: null },
      legend_show_counts: true,
      annotations: [],
    },
    diagram: null,
    channel_policy_id: null,
  };
}

const initialSpec = emptySpec();

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  booted: false,
  client: null,
  mode: 'mock',
  modeReason: '',
  bootError: null,
  page: 'workspace',
  rightTab: 'variables',
  toasts: [],

  catalog: [],
  datasets: [],
  references: [],
  pendingConfirmations: 0,
  projects: [],
  project: null,

  facets: null,
  filter: {},
  searchMode: 'exact',
  searchText: '',
  activeDatasetIds: [],
  activeLayerId: null,

  analyses: [],
  analysesTotal: 0,
  analysesCounts: null,
  analysesLoading: false,
  analysesOffset: 0,
  pageSize: 100,

  selection: { ids: new Set(), intent: 'explicit', saved: null },
  filteredIdsForDeselect: [],

  chartType: 'scatter',
  spec: initialSpec,
  scene: null,
  computeState: 'idle',
  sceneError: null,
  stale: false,
  lastComputeAt: null,

  figure: null,
  draft: null,
  revisions: [],
  figures: [],
  autosaveState: 'idle',
  autosaveError: null,
  lastSavedAt: null,

  undoStack: [],
  redoStack: [],

  axisPanel: null,
  seriesPanel: null,
  legendEditorOpen: false,
  referencePickerOpen: false,
  selectedAnalysisId: null,
  selectedAnalysisDetail: null,
  highlightIds: [],
  hoverAnalysisId: null,

  exports: [],
  exportRoots: [],
  exportsLoading: false,
  activeExportJob: null,

  bottomTab: 'samples',
  leftCollapsed: false,
  rightCollapsed: false,

  toast: (kind, text) => {
    toastSeq += 1;
    const id = toastSeq;
    set((state) => ({ toasts: [...state.toasts, { id, kind, text }] }));
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 8000 : 4000);
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),

  init: async (resolution) => {
    api = resolution.client;
    set({ client: resolution.client, mode: resolution.mode, modeReason: resolution.reason });
    try {
      const [catalogRes, references, projects, datasets] = await Promise.all([
        resolution.client.getCatalog(),
        resolution.client.listReferences(),
        resolution.client.listProjects(),
        resolution.client.listDatasets(),
      ]);
      const project = projects[0] ?? (await resolution.client.createProject('未命名项目'));
      const projectDetail = await resolution.client.getProject(project.project_id);
      const activeDatasets = projectDetail.dataset_versions.map((v) => v.dataset_id);
      set({
        catalog: catalogRes.entries,
        references,
        pendingConfirmations: catalogRes.pending_confirmations,
        projects,
        project: projectDetail,
        datasets,
        activeDatasetIds: activeDatasets,
      });
      // 启动即加载分面（否则筛选面板分面区为空，直到首次改筛选才出现）
      set({
        facets: await resolution.client.getFacets({
          dataset_versions: versionsOf(get()),
          filter: get().filter,
        }),
      });
      await get().refreshFigures();
      await get().loadExportRoots();
      const lastOpened = localStorage.getItem('geoplot.last_figure_id');
      const target = get().figures.find((f) => f.figure_id === lastOpened) ?? get().figures[0];
      if (target) await get().openFigure(target.figure_id);
      await get().loadAnalyses(0);
      await get().loadExports();
      set({ booted: true });
    } catch (error) {
      set({ bootError: error instanceof Error ? error.message : '初始化失败', booted: true });
    }
  },

  reload: async () => {
    if (!api) return;
    const [catalogRes, facets] = await Promise.all([
      api.getCatalog(),
      api.getFacets({ dataset_versions: versionsOf(get()), filter: get().filter }),
    ]);
    set({ catalog: catalogRes.entries, references: await api.listReferences(), facets });
    await get().loadAnalyses(0);
  },

  setPage: (page) => set({ page }),
  setRightTab: (tab) => set({ rightTab: tab }),

  setProject: async (projectId) => {
    if (!api) return;
    const project = await api.getProject(projectId);
    set({ project, activeDatasetIds: project.dataset_versions.map((v) => v.dataset_id), figure: null, draft: null, scene: null });
    set({
      facets: await api.getFacets({ dataset_versions: versionsOf(get()), filter: get().filter }),
    });
    await get().refreshFigures();
    await get().loadExports();
    const first = get().figures[0];
    if (first) await get().openFigure(first.figure_id);
    await get().loadAnalyses(0);
  },

  setFilter: async (patch) => {
    const filter = { ...get().filter, ...patch };
    if (patch.sample_search === null) delete filter.sample_search;
    set({ filter, analysesOffset: 0 });
    if (!api) return;
    const facets = await api.getFacets({ dataset_versions: versionsOf(get()), filter });
    set({ facets });
    await get().loadAnalyses(0);
  },

  setSearch: async (mode, text) => {
    set({ searchMode: mode, searchText: text });
    await get().setFilter({ sample_search: text.trim() ? { mode, text: text.trim() } : null });
  },

  setSearchMode: (mode) => set({ searchMode: mode }),
  setSearchText: (text) => set({ searchText: text }),
  setActiveLayer: (layerId) => set({ activeLayerId: layerId }),

  toggleDataset: async (datasetId) => {
    const active = get().activeDatasetIds;
    const next = active.includes(datasetId) ? active.filter((d) => d !== datasetId) : [...active, datasetId];
    if (!next.length) {
      get().toast('error', '至少保留一个数据来源');
      return;
    }
    set({ activeDatasetIds: next });
    await get().setFilter({});
  },

  loadAnalyses: async (offset) => {
    const state = get();
    if (!api) return;
    const pageOffset = offset ?? state.analysesOffset;
    set({ analysesLoading: true });
    try {
      const response = await api.queryAnalyses({
        dataset_versions: versionsOf(state),
        filter: state.filter,
        sort: null,
        offset: pageOffset,
        limit: state.pageSize,
      });
      set({
        analyses: response.rows,
        analysesTotal: response.total,
        analysesCounts: response.counts,
        analysesOffset: pageOffset,
        analysesLoading: false,
      });
    } catch (error) {
      set({ analysesLoading: false });
      get().toast('error', `样品查询失败：${(error as Error).message}`);
    }
  },

  toggleAnalysis: (analysisId) => {
    const ids = new Set(get().selection.ids);
    if (ids.has(analysisId)) ids.delete(analysisId);
    else ids.add(analysisId);
    set({ selection: { ...get().selection, ids, intent: 'explicit', saved: null } });
  },

  togglePage: () => {
    const ids = new Set(get().selection.ids);
    const pageIds = get().analyses.map((a) => a.analysis_id);
    const allSelected = pageIds.every((id) => ids.has(id));
    pageIds.forEach((id) => (allSelected ? ids.delete(id) : ids.add(id)));
    set({ selection: { ...get().selection, ids, intent: 'explicit', saved: null } });
  },

  clearSelection: () => set({ selection: { ids: new Set(), intent: 'explicit', saved: null } }),

  selectAllFiltered: async () => {
    if (!api) return;
    const saved = await api.createSelection({
      name: `${get().searchText || '当前筛选'} 全部结果`,
      dataset_versions: versionsOf(get()),
      mode: 'snapshot',
      filter: get().filter,
      include_ids: [],
      exclude_ids: [],
    });
    set({
      selection: { ids: new Set(saved.resolved_ids ?? []), intent: 'filter', saved },
      filteredIdsForDeselect: saved.resolved_ids ?? [],
    });
    get().toast('success', `已选择筛选结果 ${saved.resolved_count ?? 0} 条分析记录`);
  },

  deselectFiltered: async () => {
    if (!api) return;
    const resolved = await api.createSelection({
      name: '筛选结果解析',
      dataset_versions: versionsOf(get()),
      mode: 'snapshot',
      filter: get().filter,
      include_ids: [],
      exclude_ids: [],
    });
    const drop = new Set(resolved.resolved_ids ?? []);
    const ids = new Set([...get().selection.ids].filter((id) => !drop.has(id)));
    set({ selection: { ...get().selection, ids, saved: null } });
  },

  saveSelection: async (name) => {
    if (!api) return null;
    const ids = get().selection.ids;
    if (!ids.size) {
      get().toast('error', '当前没有勾选任何分析，无法保存选择集');
      return null;
    }
    try {
      const selection = await api.createSelection({
        name,
        dataset_versions: versionsOf(get()),
        mode: 'snapshot',
        filter: get().filter,
        include_ids: [...ids],
        exclude_ids: [],
      });
      set({ selection: { ...get().selection, saved: selection } });
      get().toast('success', `已保存选择集「${name}」：${selection.resolved_count} 条分析 / ${selection.distinct_samples} 个母样品`);
      return selection;
    } catch (error) {
      get().toast('error', `保存选择集失败：${(error as Error).message}`);
      return null;
    }
  },

  addSelectionLayer: async (mode, name) => {
    if (!api) return;
    const state = get();
    const ids = state.selection.ids;
    if (!ids.size) {
      get().toast('error', '请先勾选分析记录（筛选本身不会自动改变投图选择）');
      return;
    }
    if (!state.spec) return;
    try {
      const selection = await api.createSelection({
        name: name ?? `${state.searchText || '手动勾选'} ${new Date().toLocaleTimeString('zh-CN')}`,
        dataset_versions: versionsOf(state),
        mode: 'snapshot',
        filter: state.selection.intent === 'filter' ? state.filter : {},
        include_ids: state.selection.intent === 'filter' ? [] : [...ids],
        exclude_ids: [],
      });
      const index = state.spec.layers.length;
      const baseStyle = mode === 'compare' ? clone(CONTRAST_STYLE) : clone(DEFAULT_STYLE);
      const color = LAYER_COLORS[index % LAYER_COLORS.length];
      baseStyle.marker_fill_color = color;
      baseStyle.marker_edge_color = color;
      baseStyle.line_color = color;
      const layer: LayerSpec = {
        layer_id: `layer_${Date.now().toString(36)}`,
        label: name ?? (state.selection.intent === 'filter' ? `筛选结果 ${index + 1}` : `选择集 ${index + 1}`),
        selection_id: selection.selection_id!,
        visible: true,
        aggregation: 'none',
        style: baseStyle,
        analysis_style_overrides: {},
      };
      const next: PlotSpec = { ...state.spec, layers: [...state.spec.layers, layer] };
      get().commitSpec(next, mode === 'compare' ? '添加对比图层' : '添加图层');
      set({
        selection: { ids: new Set(), intent: 'explicit', saved: null },
        rightTab: 'layers',
        activeLayerId: layer.layer_id,
      });
      get().toast('success', `已添加图层「${layer.label}」：${selection.resolved_count} 条分析 / ${selection.distinct_samples} 个母样品${mode === 'compare' ? '（对比）' : ''}`);
    } catch (error) {
      get().toast('error', `创建图层失败：${(error as Error).message}`);
    }
  },

  setChartType: (type) => {
    const state = get();
    if (state.chartType === type) return;
    const spec = clone(state.spec);
    spec.chart_type = type;
    if (type === 'scatter') {
      spec.variables.x = spec.variables.x ?? measurement('MgO', 'wt%', 'oxide');
      spec.variables.y = spec.variables.y ?? measurement('SiO2', 'wt%', 'oxide');
      if (spec.axes.y.scale === 'log10') spec.axes.y.scale = 'linear';
      spec.diagram = null;
      spec.layers = spec.layers.map((l) => ({ ...l, style: { ...l.style, connect: false } }));
    } else if (type === 'ree') {
      spec.variables.elements = [...REE_ELEMENTS];
      spec.variables.value_mode = 'normalized';
      spec.variables.reference_id = spec.variables.reference_id ?? 'Chondrite_MS95';
      spec.variables.reference_version = spec.variables.reference_version ?? '1';
      spec.axes.x = defaultAxis('category');
      spec.axes.y = { ...defaultAxis('log10'), scale: 'log10' };
      spec.diagram = null;
      spec.layers = spec.layers.map((l) => ({ ...l, style: { ...l.style, connect: true } }));
    } else if (type === 'spider') {
      spec.variables.elements = [...SPIDER_ELEMENTS];
      spec.variables.value_mode = 'normalized';
      spec.variables.reference_id = 'PM_SM89';
      spec.variables.reference_version = '1';
      spec.axes.x = defaultAxis('category');
      spec.axes.y = { ...defaultAxis('log10'), scale: 'log10' };
      spec.diagram = null;
      spec.layers = spec.layers.map((l) => ({ ...l, style: { ...l.style, connect: true } }));
    } else if (type === 'tas') {
      spec.variables.x = null;
      spec.variables.y = null;
      spec.axes.x = defaultAxis('linear');
      spec.axes.y = defaultAxis('linear');
      spec.diagram = { model_id: 'tas_LeMaitre', model_version: '1', mode: 'reference', oxide_basis: 'raw', oxide_set: ['SiO2', 'Na2O', 'K2O'], iron_policy: null };
      spec.layers = spec.layers.map((l) => ({ ...l, style: { ...l.style, connect: false } }));
    }
    set({ chartType: type });
    get().commitSpec(spec, `切换到${type}图`);
  },

  setVariableX: (expr) => {
    const spec = clone(get().spec);
    spec.variables.x = expr;
    get().commitSpec(spec, '修改 X 变量');
  },
  setVariableY: (expr) => {
    const spec = clone(get().spec);
    spec.variables.y = expr;
    get().commitSpec(spec, '修改 Y 变量');
  },
  setElements: (elements) => {
    const spec = clone(get().spec);
    spec.variables.elements = elements;
    spec.axes.x.visible_categories = elements;
    spec.axes.x.category_order = elements;
    get().commitSpec(spec, '调整元素序列');
  },
  setValueMode: (mode) => {
    const spec = clone(get().spec);
    spec.variables.value_mode = mode;
    get().commitSpec(spec, '切换原始/标准化模式');
  },
  setReference: (refId, version) => {
    const spec = clone(get().spec);
    spec.variables.reference_id = refId;
    spec.variables.reference_version = version;
    get().commitSpec(spec, `切换参考组成 ${refId}@${version}`);
  },
  setQualityPolicy: (patch) => {
    const spec = clone(get().spec);
    spec.quality_policy = { ...spec.quality_policy, ...patch };
    get().commitSpec(spec, '修改质量策略');
  },
  setTasDiagram: (diagram) => {
    const spec = clone(get().spec);
    spec.diagram = diagram;
    get().commitSpec(spec, '修改 TAS 模式');
  },

  updateAxis: (axis, patch) => {
    const spec = clone(get().spec);
    spec.axes[axis] = { ...spec.axes[axis], ...patch };
    get().commitSpec(spec, `修改 ${axis.toUpperCase()} 轴`);
  },

  updateLayerStyle: (layerId, patch) => {
    const spec = clone(get().spec);
    const layer = spec.layers.find((l) => l.layer_id === layerId);
    if (!layer) return;
    layer.style = { ...layer.style, ...patch };
    get().commitSpec(spec, '修改图层样式');
  },

  updateOverrides: (layerId, analysisIds, patch) => {
    const spec = clone(get().spec);
    const layer = spec.layers.find((l) => l.layer_id === layerId);
    if (!layer) return;
    for (const id of analysisIds) {
      layer.analysis_style_overrides[id] = { ...(layer.analysis_style_overrides[id] ?? {}), ...patch };
    }
    get().commitSpec(spec, `设置单点样式（${analysisIds.length} 条）`);
  },

  clearOverrides: (layerId, analysisIds) => {
    const spec = clone(get().spec);
    const layer = spec.layers.find((l) => l.layer_id === layerId);
    if (!layer) return;
    if (!analysisIds) layer.analysis_style_overrides = {};
    else analysisIds.forEach((id) => delete layer.analysis_style_overrides[id]);
    get().commitSpec(spec, '清除单点样式覆盖');
  },

  setLayout: (patch) => {
    const spec = clone(get().spec);
    spec.layout = { ...spec.layout, ...patch };
    // 按后端 LayoutConfig 约束钳制，避免手输/清空输入越界触发 422
    const clampOr = (value: number, lo: number, hi: number, dflt: number) =>
      Number.isFinite(value) ? Math.min(hi, Math.max(lo, value)) : dflt;
    spec.layout.width_mm = clampOr(spec.layout.width_mm, 20, 500, 183);
    spec.layout.height_mm = clampOr(spec.layout.height_mm, 20, 500, 110);
    spec.layout.font_size_pt = clampOr(spec.layout.font_size_pt, 4, 36, 7);
    spec.layout.tick_font_size_pt = clampOr(spec.layout.tick_font_size_pt, 4, 36, 6);
    get().commitSpec(spec, '修改版面');
  },

  setLegend: (patch) => {
    const spec = clone(get().spec);
    spec.layout.legend = { ...spec.layout.legend, ...patch };
    get().commitSpec(spec, '修改图例');
  },

  setLegendAnchor: (x, y) => {
    const spec = clone(get().spec);
    const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5);
    spec.layout.legend = { position: 'custom', anchor_x: Number(clamp01(x).toFixed(4)), anchor_y: Number(clamp01(y).toFixed(4)) };
    get().commitSpec(spec, '拖动图例');
  },

  addAnnotation: (text) => {
    const spec = clone(get().spec);
    spec.layout.annotations.push({
      id: `ann_${Date.now().toString(36)}`,
      text,
      anchor_x: 0.08,
      anchor_y: 0.92,
      font_size_pt: 7,
      color: '#222222',
    });
    get().commitSpec(spec, '添加注释');
  },

  updateAnnotation: (id, patch) => {
    const spec = clone(get().spec);
    const ann = spec.layout.annotations.find((a) => a.id === id);
    if (!ann) return;
    Object.assign(ann, patch);
    // 按后端 Annotation 约束钳制，避免手输越界触发 422
    const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);
    ann.font_size_pt = clamp(ann.font_size_pt, 4, 36);
    ann.anchor_x = clamp(ann.anchor_x, 0, 1);
    ann.anchor_y = clamp(ann.anchor_y, 0, 1);
    get().commitSpec(spec, '修改注释');
  },

  removeAnnotation: (id) => {
    const spec = clone(get().spec);
    spec.layout.annotations = spec.layout.annotations.filter((a) => a.id !== id);
    get().commitSpec(spec, '删除注释');
  },

  commitSpec: (next, label, options = {}) => {
    const { history = true } = options;
    const state = get();
    next.revision = Math.max(state.spec.revision + 1, next.revision + 1);
    const undoStack = history ? [...state.undoStack, { spec: clone(state.spec), label }].slice(-50) : state.undoStack;
    set({
      spec: next,
      chartType: next.chart_type,
      undoStack,
      redoStack: history ? [] : state.redoStack,
      stale: state.scene != null,
      autosaveState: 'pending',
    });
    if (computeTimer) clearTimeout(computeTimer);
    computeTimer = setTimeout(() => {
      void get().runCompute();
    }, 250);
    scheduleAutosave();
  },

  toggleLayerVisible: (layerId) => {
    const spec = clone(get().spec);
    const layer = spec.layers.find((l) => l.layer_id === layerId);
    if (!layer) return;
    layer.visible = !layer.visible;
    get().commitSpec(spec, layer.visible ? '显示图层' : '隐藏图层');
  },

  renameLayer: (layerId, label) => {
    const spec = clone(get().spec);
    const layer = spec.layers.find((l) => l.layer_id === layerId);
    if (!layer) return;
    layer.label = label;
    get().commitSpec(spec, '重命名图层');
  },

  duplicateLayer: (layerId) => {
    const spec = clone(get().spec);
    const layer = spec.layers.find((l) => l.layer_id === layerId);
    if (!layer) return;
    const copy = clone(layer);
    copy.layer_id = `layer_${Date.now().toString(36)}`;
    copy.label = `${layer.label} 副本`;
    copy.style.marker_fill_color = LAYER_COLORS[spec.layers.length % LAYER_COLORS.length];
    copy.style.marker_edge_color = copy.style.marker_fill_color;
    copy.style.line_color = copy.style.marker_fill_color;
    spec.layers.push(copy);
    get().commitSpec(spec, '复制图层');
  },

  removeLayer: (layerId) => {
    const spec = clone(get().spec);
    spec.layers = spec.layers.filter((l) => l.layer_id !== layerId);
    if (get().activeLayerId === layerId) {
      set({ activeLayerId: spec.layers[0]?.layer_id ?? null });
    }
    get().commitSpec(spec, '移除图层');
  },

  moveLayer: (layerId, direction) => {
    const spec = clone(get().spec);
    const index = spec.layers.findIndex((l) => l.layer_id === layerId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= spec.layers.length) return;
    [spec.layers[index], spec.layers[target]] = [spec.layers[target], spec.layers[index]];
    get().commitSpec(spec, '调整图层顺序');
  },

  undo: () => {
    const state = get();
    const previous = state.undoStack[state.undoStack.length - 1];
    if (!previous) return;
    set({
      spec: previous.spec,
      chartType: previous.spec.chart_type,
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, { spec: clone(state.spec), label: previous.label }],
      stale: true,
      autosaveState: 'pending',
    });
    void get().runCompute();
    scheduleAutosave();
  },

  redo: () => {
    const state = get();
    const next = state.redoStack[state.redoStack.length - 1];
    if (!next) return;
    set({
      spec: next.spec,
      chartType: next.spec.chart_type,
      redoStack: state.redoStack.slice(0, -1),
      undoStack: [...state.undoStack, { spec: clone(state.spec), label: next.label }],
      stale: true,
      autosaveState: 'pending',
    });
    void get().runCompute();
    scheduleAutosave();
  },

  runCompute: async () => {
    if (!api) return;
    const spec = get().spec;
    // 合同要求 layers 至少 1 条；空图层不发计算请求（否则 422）
    if (spec.layers.length === 0) {
      set({ computeState: 'idle', scene: null, stale: false, sceneError: null, lastComputeAt: new Date().toISOString() });
      return;
    }
    const gate = ++computeGate;
    set({ computeState: 'computing', sceneError: null });
    try {
      const scene = await api.computePlot(spec);
      if (gate !== computeGate) return;
      set({
        scene,
        computeState: 'ready',
        stale: false,
        sceneError: null,
        lastComputeAt: new Date().toISOString(),
      });
    } catch (error) {
      if (gate !== computeGate) return;
      set({
        computeState: 'error',
        sceneError: error instanceof Error ? error.message : '计算失败',
        stale: true,
      });
    }
  },

  setAxisPanel: (target) => set({ axisPanel: target }),
  setSeriesPanel: (target) => set({ seriesPanel: target }),
  setLegendEditor: (open) => set({ legendEditorOpen: open }),
  setReferencePicker: (open) => set({ referencePickerOpen: open }),

  setSelectedAnalysis: async (id) => {
    if (!id) {
      set({ selectedAnalysisId: null, selectedAnalysisDetail: null });
      return;
    }
    set({ selectedAnalysisId: id });
    if (!api) return;
    try {
      const detail = await api.getAnalysis(id);
      if (get().selectedAnalysisId === id) set({ selectedAnalysisDetail: detail });
    } catch (error) {
      get().toast('error', `读取分析详情失败：${(error as Error).message}`);
    }
  },

  setHighlight: (ids) => set({ highlightIds: ids }),
  applyHighlightToSelection: () => {
    const ids = new Set(get().selection.ids);
    get().highlightIds.forEach((id) => ids.add(id));
    set({ selection: { ...get().selection, ids, intent: 'explicit', saved: null } });
    get().toast('info', `已将高亮 ${get().highlightIds.length} 个点加入投图选择（尚未生成新图层）`);
  },
  setHover: (id) => set({ hoverAnalysisId: id }),

  setViewportRange: (axis, range) => {
    const scene = get().scene;
    if (!scene) return;
    set({
      scene: {
        ...scene,
        axes: {
          ...scene.axes,
          [axis]: { ...scene.axes[axis], range, ...(axis === 'x' ? {} : {}) },
        },
      },
    });
  },

  useCurrentViewForExport: (ranges) => {
    const spec = clone(get().spec);
    let changed = false;
    if (ranges.x && spec.axes.x.scale !== 'category') {
      spec.axes.x = { ...spec.axes.x, range_mode: 'manual', min: ranges.x[0], max: ranges.x[1] };
      changed = true;
    }
    if (ranges.y) {
      spec.axes.y = { ...spec.axes.y, range_mode: 'manual', min: ranges.y[0], max: ranges.y[1] };
      changed = true;
    }
    if (!changed) {
      get().toast('info', '当前视野没有可写回的数值范围（分类轴不写回）');
      return;
    }
    get().commitSpec(spec, '将当前视野用于导出');
    get().toast('success', '已把当前视野写回 PlotSpec 轴范围，并计入撤销历史');
  },

  setBottomTab: (tab) => set({ bottomTab: tab }),
  toggleLeft: () => set((s) => ({ leftCollapsed: !s.leftCollapsed })),
  toggleRight: () => set((s) => ({ rightCollapsed: !s.rightCollapsed })),

  openFigure: async (figureId) => {
    if (!api) return;
    if (autosaveTimer) clearTimeout(autosaveTimer);
    try {
      const { figure, draft, revisions } = await api.getFigure(figureId);
      const spec = draft?.spec ?? initialSpec;
      set({
        figure,
        draft,
        revisions,
        spec,
        chartType: spec.chart_type,
        activeLayerId: spec.layers[0]?.layer_id ?? null,
        undoStack: [],
        redoStack: [],
        scene: null,
        stale: false,
        autosaveState: draft ? 'saved' : 'idle',
        lastSavedAt: draft?.saved_at ?? null,
        lastComputeAt: null,
      });
      localStorage.setItem('geoplot.last_figure_id', figure.figure_id);
      await get().runCompute();
    } catch (error) {
      get().toast('error', `打开图件失败：${(error as Error).message}`);
    }
  },

  refreshFigures: async () => {
    if (!api || !get().project) return;
    const figures = await api.listFigures(get().project!.project_id);
    set({ figures });
  },

  newFigure: async (name) => {
    if (!api || !get().project) return;
    try {
      const { figure, draft } = await api.createFigure(get().project!.project_id, name, get().spec, []);
      set({
        figure,
        draft,
        revisions: [],
        undoStack: [],
        redoStack: [],
        activeLayerId: get().spec.layers[0]?.layer_id ?? null,
      });
      localStorage.setItem('geoplot.last_figure_id', figure.figure_id);
      await get().refreshFigures();
      await get().runCompute();
      get().toast('success', `已新建图件「${name}」`);
    } catch (error) {
      get().toast('error', `新建图件失败：${(error as Error).message}`);
    }
  },

  saveDraftNow: async (options = {}) => {
    const state = get();
    if (!api || !state.figure) return false;
    if (autosaveTimer) clearTimeout(autosaveTimer);
    const expected = state.figure.draft_revision;
    set({ autosaveState: 'saving', autosaveError: null });
    try {
      const draft = await api.saveDraft(
        state.figure.figure_id,
        expected,
        get().spec,
        snapshotsOf(state),
        options.silent ? '自动保存草稿' : '保存草稿',
      );
      set({
        draft,
        figure: get().figure ? { ...get().figure!, draft_revision: draft.draft_revision } : null,
        autosaveState: 'saved',
        lastSavedAt: draft.saved_at,
        autosaveError: null,
      });
      return true;
    } catch (error) {
      const apiError = error as ApiError;
      set({
        autosaveState: apiError.code === 'STALE_REVISION' ? 'conflict' : 'error',
        autosaveError: apiError.message,
      });
      if (apiError.code === 'STALE_REVISION') {
        get().toast('error', '草稿被其他窗口更新：请重新载入图件，或另存为新图件后再保存');
      } else if (!options.silent) {
        get().toast('error', `保存草稿失败：${apiError.message}`);
      }
      return false;
    }
  },

  saveRevision: async () => {
    const state = get();
    if (!api || !state.figure) {
      get().toast('error', '请先新建或打开一个图件');
      return null;
    }
    if (state.computeState === 'error' || !state.scene) {
      await get().runCompute();
    }
    const saved = await get().saveDraftNow();
    if (!saved) return null;
    await get().runCompute();
    const latest = get();
    if (!latest.scene) {
      get().toast('error', '没有可冻结的 Scene，无法保存版本');
      return null;
    }
    try {
      const revision = await api.createRevision(latest.figure!.figure_id, latest.figure!.draft_revision, latest.scene.scene_id);
      set({ revisions: await api.listRevisions(latest.figure!.figure_id) });
      await get().refreshFigures();
      get().toast('success', `已保存版本 v${revision.revision_number}（不可变）`);
      return revision;
    } catch (error) {
      get().toast('error', `保存版本失败：${(error as Error).message}`);
      return null;
    }
  },

  restoreRevision: async (revisionId) => {
    if (!api || !get().figure) return;
    try {
      const { figure, draft } = await api.restoreRevision(get().figure!.figure_id, revisionId);
      set({
        figure,
        draft,
        spec: draft.spec,
        chartType: draft.spec.chart_type,
        activeLayerId: draft.spec.layers[0]?.layer_id ?? null,
        undoStack: [],
        redoStack: [],
        autosaveState: 'saved',
        lastSavedAt: draft.saved_at,
      });
      set({ revisions: await api.listRevisions(figure.figure_id) });
      await get().runCompute();
      get().toast('success', '已恢复历史版本并生成新版本，旧历史未被覆盖');
    } catch (error) {
      get().toast('error', `恢复版本失败：${(error as Error).message}`);
    }
  },

  renameFigure: async (name) => {
    if (!api || !get().figure) return;
    try {
      const figure = await api.patchFigure(get().figure!.figure_id, get().figure!.metadata_revision, { name });
      set({ figure });
      await get().refreshFigures();
      get().toast('success', '图件已重命名');
    } catch (error) {
      get().toast('error', `重命名失败：${(error as Error).message}`);
    }
  },

  archiveFigure: async (archived) => {
    if (!api || !get().figure) return;
    try {
      const figure = await api.patchFigure(get().figure!.figure_id, get().figure!.metadata_revision, { archived });
      set({ figure });
      await get().refreshFigures();
      get().toast('success', archived ? '图件已归档' : '图件已恢复');
    } catch (error) {
      get().toast('error', `归档失败：${(error as Error).message}`);
    }
  },

  loadExports: async () => {
    if (!api || !get().project) return;
    set({ exportsLoading: true });
    try {
      const exports = await api.listExports(get().project!.project_id);
      set({ exports, exportsLoading: false });
    } catch (error) {
      set({ exportsLoading: false });
      get().toast('error', `读取导出记录失败：${(error as Error).message}`);
    }
  },

  loadExportRoots: async () => {
    if (!api || !get().project) return;
    try {
      const exportRoots = await api.listExportRoots(get().project!.project_id);
      set({ exportRoots });
    } catch {
      set({ exportRoots: [] });
    }
  },

  chooseExportRoot: async () => {
    if (!api || !get().project) return null;
    try {
      const job = await api.chooseExportRoot(get().project!.project_id);
      const done = await pollJob<{ status: 'succeeded' | 'cancelled'; export_root: ExportRoot | null }>(api, job.job_id, {
        timeoutMs: 180_000,
      });
      if (done.status === 'failed' || done.status === 'cancelled' || done.status === 'interrupted') {
        get().toast('error', `选择文件夹未完成：${done.error?.message ?? done.status}`);
        return null;
      }
      const root = done.result?.export_root ?? null;
      if (!root) {
        get().toast('info', '未选择导出文件夹');
        return null;
      }
      await get().loadExportRoots();
      get().toast('success', `导出目录：${root.absolute_path}`);
      return root;
    } catch (error) {
      get().toast('error', `选择导出目录失败：${(error as Error).message}`);
      return null;
    }
  },

  registerExportRoot: async (path) => {
    if (!api || !get().project) return null;
    try {
      const root = await api.registerExportRoot(get().project!.project_id, path);
      await get().loadExportRoots();
      get().toast('success', `已登记导出目录：${root.absolute_path}`);
      return root;
    } catch (error) {
      get().toast('error', `目录不可用：${(error as Error).message}`);
      return null;
    }
  },

  startExport: async (input) => {
    const state = get();
    if (!api || !state.figure || !state.scene) {
      get().toast('error', '请先保存图件版本并完成 Scene 计算');
      return;
    }
    if (state.stale) {
      get().toast('error', '图件正在重新计算或仍有未计算的修改，禁止用旧场景导出');
      return;
    }
    try {
      const revisionId = state.figure.current_revision_id;
      if (!revisionId) {
        get().toast('error', '请先“保存版本”后再导出（导出必须冻结不可变版本）');
        return;
      }
      const { job_id, export_id } = await api.startExport({
        figure_id: state.figure.figure_id,
        revision_id: revisionId,
        scene_id: state.scene.scene_id,
        formats: input.formats,
        dpi: input.dpi,
        background: input.background,
        size_mm: { width: input.width, height: input.height },
        export_root_id: input.exportRootId,
        include_bundle: true,
      });
      set({ activeExportJob: { exportId: export_id, jobId: job_id } });
      for (let i = 0; i < 120; i += 1) {
        const job = await api.getJob<{ export_id: string }>(job_id);
        if (['succeeded', 'failed', 'cancelled', 'interrupted'].includes(job.status)) break;
        await new Promise((resolve) => setTimeout(resolve, 220));
      }
      await get().loadExports();
      const record = await api.getExport(export_id);
      set({ activeExportJob: null });
      if (record.state === 'succeeded') {
        get().toast('success', `导出完成：${record.files[0]?.absolute_path ?? record.relative_dir}`);
      } else {
        get().toast('error', `导出未成功：${record.error?.message ?? record.state}`);
      }
    } catch (error) {
      set({ activeExportJob: null });
      get().toast('error', `导出失败：${(error as Error).message}`);
    }
  },

  reexport: async (exportId, exportRootId) => {
    if (!api) return;
    try {
      const { job_id } = await api.reexport(exportId, exportRootId);
      for (let i = 0; i < 120; i += 1) {
        const job = await api.getJob(job_id);
        if (['succeeded', 'failed', 'cancelled', 'interrupted'].includes(job.status)) break;
        await new Promise((resolve) => setTimeout(resolve, 220));
      }
      await get().loadExports();
      get().toast('success', '已按原冻结版本生成新导出（旧记录保留）');
    } catch (error) {
      get().toast('error', `重导失败：${(error as Error).message}`);
    }
  },

  openExportFolder: async (exportId) => {
    if (!api) return;
    try {
      const result = await api.openExportFolder(exportId);
      if (result.opened) get().toast('success', `已打开：${result.path}`);
      else get().toast('error', `无法打开文件夹：${result.error ?? '未知原因'}\n${result.path}`);
    } catch (error) {
      get().toast('error', `打开文件夹失败：${(error as Error).message}`);
    }
  },

  refreshExport: async (exportId) => {
    if (!api) return;
    try {
      const record = await api.getExport(exportId);
      set({ exports: get().exports.map((e) => (e.export_id === exportId ? record : e)) });
    } catch (error) {
      get().toast('error', `刷新记录失败：${(error as Error).message}`);
    }
  },

  demoRemoveFile: async (exportId, filename) => {
    if (!api?.demoRemoveExportFile) return;
    const record = await api.demoRemoveExportFile(exportId, filename);
    set({ exports: get().exports.map((e) => (e.export_id === exportId ? record : e)) });
    get().toast('info', '演示：已标记一份输出文件被外部移除，刷新可见缺失');
  },

  saveProjectName: async (name) => {
    if (!api || !get().project) return;
    try {
      const project = await api.putProject(get().project!.project_id, get().project!.revision, name);
      set({ project, projects: get().projects.map((p) => (p.project_id === project.project_id ? project : p)) });
      get().toast('success', '项目名已保存');
    } catch (error) {
      get().toast('error', `保存项目失败：${(error as Error).message}`);
    }
  },

  createProject: async (name) => {
    if (!api) return;
    try {
      const project = await api.createProject(name);
      set({ projects: [...get().projects, project] });
      await get().setProject(project.project_id);
      get().toast('success', `已新建项目「${name}」`);
    } catch (error) {
      get().toast('error', `新建项目失败：${(error as Error).message}`);
    }
  },

  demoReset: async () => {
    if (api && 'demoReset' in api) (api as unknown as { demoReset: () => void }).demoReset();
    localStorage.removeItem('geoplot.last_figure_id');
    window.location.reload();
  },
}));

function versionsOf(state: Pick<WorkspaceState, 'activeDatasetIds' | 'datasets'>) {
  return state.activeDatasetIds.map((id) => ({ dataset_id: id, version: state.datasets.find((d) => d.dataset_id === id)?.version ?? '1' }));
}

function snapshotsOf(state: WorkspaceState): FigureDraft['selection_snapshots'] {
  const snapshots = new Map<string, FigureDraft['selection_snapshots'][number]>();
  state.spec.layers.forEach((layer) => {
    const existing = state.draft?.selection_snapshots.find((s) => s.selection_id === layer.selection_id);
    if (existing) snapshots.set(layer.selection_id, existing);
    else if (state.selection.saved?.selection_id === layer.selection_id) {
      snapshots.set(layer.selection_id, {
        selection_id: layer.selection_id,
        name: state.selection.saved.name,
        analysis_ids: state.selection.saved.resolved_ids ?? [],
      });
    }
  });
  return [...snapshots.values()];
}

function scheduleAutosave() {
  const state = useWorkspace.getState();
  if (!state.figure) return;
  useWorkspace.setState({ autosaveState: 'pending' });
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    void useWorkspace.getState().saveDraftNow({ silent: true });
  }, 3000);
}

/** 供调试与测试使用。 */
export function getLoadedApi(): ApiClient | null {
  return api;
}

export function describeSpecAxis(spec: PlotSpec, axis: 'x' | 'y'): string {
  const expr = axis === 'x' ? spec.variables.x : spec.variables.y;
  return expr ? describeExpression(expr) : '未设置';
}
