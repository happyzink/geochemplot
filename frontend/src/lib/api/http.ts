/**
 * 真实后端客户端（同源 /api/v1）。
 *
 * 所有路径集中在本文件，按后端实际路由适配（HANDOFF 45 端点）；
 * 请求体/响应形态差异在此映射，组件不直接拼 URL。
 * Scene 合同（18 §3）在 computePlot 内做运行时校验，不靠 TS 强转。
 */

import { ApiError, nextRequestId, type ApiClient, type CommitImportPayload, type ExportRequest, type ExportRootChoice, type HealthInfo } from './client';
import type {
  AnalysisDetail,
  AnalysisQueryRequest,
  AnalysisQueryResponse,
  CatalogEntry,
  Dataset,
  ExportRecord,
  ExportRoot,
  Facets,
  Figure,
  FigureDraft,
  FigureRevision,
  ImportPreview,
  Job,
  OperationRecord,
  PlotScene,
  PlotSpec,
  Project,
  QueryFilter,
  ReferenceComposition,
  RuntimeStatus,
  SelectionSet,
} from '../generated/types';

const API = '/api/v1';

/** 18 §3 冻结的 Scene 合同版本。 */
export const EXPECTED_SCENE_VERSION = '1.2';

const REQUIRED_SCENE_FIELDS = [
  'scene_id',
  'schema_version',
  'request_id',
  'spec_hash',
  'scene_hash',
  'plot_revision',
  'chart_type',
  'variables',
  'resolved_selections',
  'reference_snapshots',
  'axes',
  'series',
  'diagram_geometry',
  'legend',
  'layout',
  'font_manifest',
  'counts',
  'exclusions',
] as const;

const CHART_TYPES = new Set(['scatter', 'ree', 'spider', 'tas']);

export class SceneContractError extends ApiError {
  constructor(message: string, options: { requestId?: string; details?: unknown } = {}) {
    super('CONTRACT_MISMATCH', message, options);
    this.name = 'SceneContractError';
  }
}

/**
 * 运行时校验 HTTP Scene（18 §3），不靠 TypeScript 强转。
 * 收到 `{scene,status}` 包装、旧 schema、缺字段或 request_id 不回显时立即报错。
 */
export function assertSceneContract(payload: unknown, requestId: string): PlotScene {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new SceneContractError('后端响应不是 PlotScene 对象', { requestId });
  }
  const scene = payload as Record<string, unknown>;
  if ('scene' in scene) {
    throw new SceneContractError(
      '后端返回了 {scene,status} 包装；合同 1.2 要求 POST /plots/compute 的 200 响应直接是 PlotScene。',
      { requestId },
    );
  }
  if (scene.schema_version !== EXPECTED_SCENE_VERSION) {
    throw new SceneContractError(
      `Scene schema_version 为 ${String(scene.schema_version ?? '缺失')}，合同要求 ${EXPECTED_SCENE_VERSION}。`,
      { requestId },
    );
  }
  const missing = REQUIRED_SCENE_FIELDS.filter((field) => !(field in scene));
  if (missing.length) {
    throw new SceneContractError(`Scene 缺少合同字段：${missing.join('、')}`, { requestId });
  }
  if (scene.request_id !== requestId) {
    throw new SceneContractError(
      `Scene request_id（${String(scene.request_id)}）与本次请求（${requestId}）不一致，结果已丢弃。`,
      { requestId },
    );
  }
  if (!CHART_TYPES.has(String(scene.chart_type))) {
    throw new SceneContractError(`不支持或缺失的 chart_type：${String(scene.chart_type)}`, { requestId });
  }
  const axes = scene.axes as Record<string, unknown> | null;
  if (!axes || typeof axes !== 'object' || !axes.x || !axes.y) {
    throw new SceneContractError('Scene axes 必须同时包含 x 与 y', { requestId });
  }
  if (!Array.isArray(scene.series)) {
    throw new SceneContractError('Scene series 必须是数组', { requestId });
  }
  if (scene.chart_type === 'tas' && !scene.diagram_geometry) {
    throw new SceneContractError('TAS Scene 缺少 diagram_geometry', { requestId });
  }
  if (scene.chart_type === 'ree' || scene.chart_type === 'spider') {
    for (const raw of scene.series as Array<Record<string, unknown>>) {
      const ids = raw.analysis_ids;
      const points = raw.points;
      if (!Array.isArray(ids) || ids.length !== 1) {
        throw new SceneContractError(
          `曲线 series ${String(raw.series_id)} 必须一 analysis 一 series，实际 ${Array.isArray(ids) ? ids.length : '缺失'} 个 analysis。`,
          { requestId },
        );
      }
      if (!Array.isArray(points)) {
        throw new SceneContractError(`曲线 series ${String(raw.series_id)} 缺少 points`, { requestId });
      }
      if (points.some((point) => (point as Record<string, unknown>).analysis_id !== ids[0])) {
        throw new SceneContractError(
          `曲线 series ${String(raw.series_id)} 混入了其他 analysis 的点，禁止跨样品连线。`,
          { requestId },
        );
      }
    }
  }
  return scene as unknown as PlotScene;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  raw?: Blob | FormData;
}

/** 后端 dataset_versions 以版本字符串为键（analyses.dataset_version）。 */
function versionStrings(
  refs: Array<{ dataset_id: string; version: string }> | string[] | undefined,
): string[] {
  if (!refs || refs.length === 0) return ['1.0'];
  return refs.map((r) => (typeof r === 'string' ? r : r.version));
}

function toFigure(raw: Record<string, unknown>, projectId = ''): Figure {
  return {
    figure_id: String(raw.figure_id),
    project_id: String(raw.project_id ?? projectId),
    name: String(raw.name ?? raw.label ?? ''),
    chart_type: (raw.chart_type as Figure['chart_type']) ?? 'scatter',
    thumbnail_artifact_id: null,
    current_revision_id: (raw.current_revision_id as string | null) ?? null,
    metadata_revision: Number(raw.metadata_revision ?? 1),
    draft_revision: Number(raw.metadata_revision ?? 1),
    archived: Boolean(raw.archived),
    created_at: String(raw.created_at ?? ''),
    updated_at: String(raw.updated_at ?? raw.created_at ?? ''),
  };
}

function toExportRecord(raw: Record<string, unknown>): ExportRecord {
  return {
    export_id: String(raw.export_id),
    figure_id: String(raw.figure_id),
    revision_id: String(raw.revision_id ?? ''),
    scene_id: String(raw.scene_id ?? ''),
    scene_hash: String(raw.scene_hash ?? ''),
    export_seq: Number(raw.export_seq ?? 1),
    formats: (raw.formats as string[]) ?? [],
    size_mm: (raw.size_mm as ExportRecord['size_mm']) ?? { width: 183, height: 110 },
    dpi: (raw.dpi as number | null) ?? null,
    background: (raw.background as ExportRecord['background']) ?? 'white',
    export_root_id: String(raw.export_root_id ?? ''),
    relative_dir: String(raw.relative_dir ?? ''),
    state: (raw.state as ExportRecord['state']) ?? 'queued',
    files: ((raw.files as Array<Record<string, unknown>>) ?? []).map((f) => ({
      artifact_id: (f.artifact_id as string | null) ?? null,
      filename: String(f.filename),
      format: f.format as ExportRecord['files'][number]['format'],
      byte_size: (f.byte_size as number | null) ?? null,
      sha256: (f.sha256 as string | null) ?? null,
      absolute_path: String(f.absolute_path ?? ''),
      exists: Boolean(f.exists),
    })),
    error: (raw.error as ExportRecord['error']) ?? null,
    counts: null,
    created_at: String(raw.created_at ?? ''),
    finished_at: (raw.finished_at as string | null) ?? null,
  };
}

export class HttpApiClient implements ApiClient {
  readonly mode = 'live' as const;
  private baseUrl: string;

  constructor(baseUrl = '') {
    this.baseUrl = baseUrl;
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const requestId = nextRequestId();
    const headers: Record<string, string> = { 'X-Request-Id': requestId };
    let body: BodyInit | undefined;
    if (options.raw) {
      body = options.raw;
    } else if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${API}${path}`, {
        method: options.method ?? (body ? 'POST' : 'GET'),
        headers,
        body,
        signal: options.signal,
      });
    } catch (error) {
      if ((error as Error).name === 'AbortError') throw new ApiError('CANCELLED', '请求已取消');
      throw new ApiError('BACKEND_UNAVAILABLE', '无法连接本地服务，请确认 GeoPlot 已启动', { requestId });
    }
    if (!response.ok) {
      let payload: { error?: { code?: string; message?: string; field_errors?: Array<{ path: string; message: string }>; details?: unknown; request_id?: string }; detail?: unknown } | null = null;
      try {
        payload = await response.json();
      } catch {
        /* 非 JSON 错误 */
      }
      const detail = payload?.error ?? (typeof payload?.detail === 'string' ? { message: payload.detail } : null);
      throw new ApiError(detail?.code ?? `HTTP_${response.status}`, detail?.message ?? `请求失败（HTTP ${response.status}）`, {
        status: response.status,
        fieldErrors: detail?.field_errors,
        requestId: detail?.request_id ?? requestId,
        details: detail?.details,
      });
    }
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  health(): Promise<HealthInfo> {
    return this.request('/health');
  }

  async getCatalog(): Promise<{ entries: CatalogEntry[]; references: ReferenceComposition[]; pending_confirmations: number }> {
    const raw = await this.request<{ catalog_items: Array<Record<string, unknown>>; references: Array<Record<string, unknown>>; registered_versions?: Array<Record<string, unknown>>; pending_confirmations: number }>('/catalog/builtin');
    // 逐字段对齐 CatalogEntry 契约（record_baseline/sheet/note 等缺失曾致导入页与项目页白屏）
    const registered = new Map<string, Record<string, unknown>>();
    for (const rv of raw.registered_versions ?? []) {
      registered.set(String(rv.data_id ?? ''), rv);
    }
    return {
      entries: (raw.catalog_items ?? []).map((item) => {
        const dataId = String(item.data_id ?? item.id ?? '');
        const rv = registered.get(dataId);
        return {
          data_id: dataId,
          label: String(item.display_name ?? item.label ?? item.name ?? dataId),
          sheet: String(item.source_sheet ?? item.sheet ?? ''),
          record_baseline: Number(item.physical_rows ?? item.record_baseline ?? 0),
          role: (String(item.role ?? 'samples') as CatalogEntry['role']),
          default_visible: item.default_visible == null ? true : Boolean(item.default_visible),
          attached: Boolean(item.attached ?? rv ?? false),
          dataset_id: (item.dataset_id as string | null) ?? (rv ? String(rv.dataset_id ?? '') : null),
          version: (item.version as string | null) ?? (rv ? String(rv.version ?? '1.0') : null),
          unit_confirmation_pending: Number(item.unit_confirmation_pending ?? 0),
          note: String(item.notes ?? item.note ?? ''),
        };
      }),
      references: (raw.references ?? []).map((r) => this.toReference(r)),
      pending_confirmations: Number(raw.pending_confirmations ?? 0),
    };
  }

  private toReference(raw: Record<string, unknown>): ReferenceComposition {
    const elements = (raw.elements ?? {}) as Record<string, number>;
    return {
      ref_id: String(raw.ref_id),
      version: String(raw.version ?? '1'),
      label: String(raw.label ?? raw.ref_id),
      elements: Object.keys(elements),
      values: elements,
      units: (raw.units ?? {}) as Record<string, string>,
      citation: String(raw.citation ?? ''),
      verification_status: String(raw.verification_status ?? 'verified'),
      hash: String(raw.hash ?? raw.sha256 ?? ''),
      is_custom: Boolean(raw.is_custom),
      note: (raw.note as string | null) ?? null,
    };
  }

  async attachCatalog(dataId: string, projectId: string): Promise<{ dataset_id: string; version: string; attached: boolean }> {
    const raw = await this.request<{ attached: boolean; data_id: string; project_id: string }>('/catalog/attach', {
      method: 'POST',
      body: { project_id: projectId, data_id: dataId },
    });
    return { dataset_id: raw.data_id, version: '1.0', attached: raw.attached };
  }

  async listDatasets(): Promise<Dataset[]> {
    const raw = await this.request<{ datasets: Array<Record<string, unknown>>; total: number }>('/datasets');
    return (raw.datasets ?? []).map((d) => ({
      dataset_id: String(d.dataset_id),
      version: String(d.version ?? '1.0'),
      label: String(d.label ?? ''),
      role: (d.role as Dataset['role']) ?? 'own',
      file_id: String(d.file_id ?? ''),
      sheets: [],
      counts: {
        physical_rows: 0,
        accepted_analyses: Number(d.analysis_count ?? 0),
        quarantined_rows: 0,
        skipped_rows: 0,
        linked_derived_rows: 0,
      },
      mapping_version: String(d.mapping_version ?? '1.0'),
      created_at: String(d.created_at ?? ''),
    }));
  }

  async queryAnalyses(req: AnalysisQueryRequest): Promise<AnalysisQueryResponse> {
    const raw = await this.request<{ analyses: Array<Record<string, unknown>>; total: number; offset: number; limit: number }>('/datasets/query', {
      method: 'POST',
      body: {
        dataset_versions: versionStrings(req.dataset_versions),
        filter: req.filter ?? {},
        offset: req.offset ?? 0,
        limit: req.limit ?? 100,
      },
    });
    const rows = (raw.analyses ?? []).map((a) => ({
      analysis_id: String(a.analysis_id),
      sample_id: String(a.sample_id ?? ''),
      raw_name: String(a.raw_name ?? ''),
      parent_sample: (a.parent_sample as string | null) ?? null,
      subsample: null,
      mission: String(a.mission ?? 'unknown') as AnalysisQueryResponse['rows'][number]['mission'],
      sample_group: String(a.sample_group ?? 'unknown'),
      batch: null,
      material_type: String(a.material_type ?? 'unknown') as AnalysisQueryResponse['rows'][number]['material_type'],
      mineral_group: String(a.mineral_group ?? 'unknown') as AnalysisQueryResponse['rows'][number]['mineral_group'],
      phase: (a.phase as string | null) ?? null,
      rock_type: (a.rock_type as string | null) ?? null,
      citation: (a.citation as string | null) ?? null,
      source: { file_id: String(a.file_id ?? ''), sheet: String(a.sheet_name ?? ''), row: Number(a.row_number ?? 0) },
      quality_flags: [],
    }));
    const mat = (r: (typeof rows)[number]) => r.material_type.toLowerCase();
    return {
      rows,
      total: raw.total ?? rows.length,
      counts: {
        total: raw.total ?? rows.length,
        whole_rock: rows.filter((r) => /全岩|whole|rock/.test(mat(r))).length,
        mineral: rows.filter((r) => /矿物|mineral|pyroxene|olivine|plagioclase|clast/.test(mat(r))).length,
        glass: rows.filter((r) => /glass|玻璃|bead/.test(mat(r))).length,
        unknown_material: rows.filter((r) => mat(r) === 'unknown').length,
      },
      query_hash: `q_${(raw.total ?? 0)}_${req.offset ?? 0}_${JSON.stringify(req.filter ?? {}).length}`,
      dataset_versions: req.dataset_versions,
    };
  }

  async getFacets(req: { dataset_versions: AnalysisQueryRequest['dataset_versions']; filter: QueryFilter }): Promise<Facets> {
    const raw = await this.request<{ missions: Array<{ value: string; count: number }>; sample_groups: Array<{ value: string; count: number }>; material_types: Array<{ value: string; count: number }>; mineral_groups: Array<{ value: string; count: number }>; total_count: number }>('/datasets/facets', {
      method: 'POST',
      body: { dataset_versions: versionStrings(req.dataset_versions), filter: req.filter ?? {} },
    });
    const bucket = (list: Array<{ value: string; count: number }>) =>
      (list ?? []).map((b) => ({ value: b.value, label: b.value, count: b.count }));
    return {
      datasets: [],
      missions: bucket(raw.missions),
      sample_groups: bucket(raw.sample_groups),
      material_types: bucket(raw.material_types),
      mineral_groups: bucket(raw.mineral_groups),
      parents: [],
    };
  }

  async getAnalysis(analysisId: string): Promise<AnalysisDetail> {
    const raw = await this.request<Record<string, unknown>>(`/analyses/${encodeURIComponent(analysisId)}`);
    // 后端响应补齐前端契约字段（与 queryAnalyses 同语义），避免渲染端读 undefined
    return {
      analysis_id: String(raw.analysis_id),
      sample_id: String(raw.sample_id ?? ''),
      raw_name: String(raw.raw_name ?? ''),
      parent_sample: (raw.parent_sample as string | null) ?? null,
      subsample: null,
      mission: String(raw.mission ?? 'unknown') as AnalysisDetail['mission'],
      sample_group: String(raw.sample_group ?? 'unknown'),
      batch: null,
      material_type: String(raw.material_type ?? 'unknown') as AnalysisDetail['material_type'],
      mineral_group: String(raw.mineral_group ?? 'unknown') as AnalysisDetail['mineral_group'],
      phase: (raw.phase as string | null) ?? null,
      rock_type: (raw.rock_type as string | null) ?? null,
      citation: (raw.citation as string | null) ?? null,
      source: {
        file_id: String(raw.file_id ?? ''),
        sheet: String(raw.sheet_name ?? ''),
        row: Number(raw.row_number ?? 0),
      },
      quality_flags: [],
      measurements: ((raw.measurements as Array<Record<string, unknown>>) ?? []).map((m) => ({
        measurement_id: String(m.measurement_id),
        analyte: String(m.analyte),
        chemical_form: (String(m.chemical_form) as AnalysisDetail['measurements'][number]['chemical_form']) ?? 'element',
        channel: (m.channel as string | null) ?? null,
        value: (m.value as number | null) ?? null,
        unit: (m.unit as string | null) ?? null,
        unit_confirmed: true,
        value_state: String(m.value_state ?? 'raw_concentration'),
        quality_flags: [],
        source_cell: (m.source_cell as string | null) ?? null,
        uncertainty: (m.uncertainty as number | null) ?? null,
        uncertainty_label: (m.uncertainty_label as string | null) ?? null,
        detection_limit: (m.detection_limit as number | null) ?? null,
      })),
      classification_evidence: ((raw.classification_evidence as AnalysisDetail['classification_evidence']) ?? []),
    };
  }

  async createSelection(input: SelectionSet): Promise<SelectionSet> {
    const raw = await this.request<{ selection_id: string; name: string; mode: string; resolved_ids: string[]; selection_hash: string; total_count: number }>('/selections', {
      method: 'POST',
      body: {
        name: input.name,
        mode: input.mode ?? 'snapshot',
        dataset_versions: versionStrings(input.dataset_versions),
        // 空列表必须省略：后端把显式 analysis_ids 视作权威快照，
        // 传 [] 会让“整批筛选”永远解析出 0 条。
        ...(input.include_ids && input.include_ids.length > 0 ? { analysis_ids: input.include_ids } : {}),
        filter: input.filter ?? {},
      },
    });
    return {
      ...input,
      selection_id: raw.selection_id,
      resolved_ids: raw.resolved_ids,
      resolved_count: raw.total_count,
      selection_hash: raw.selection_hash,
    };
  }

  async listReferences(): Promise<ReferenceComposition[]> {
    const raw = await this.request<{ references: Array<Record<string, unknown>> }>('/catalog/builtin');
    return (raw.references ?? []).map((r) => this.toReference(r));
  }

  async computePlot(spec: PlotSpec): Promise<PlotScene> {
    const requestId = nextRequestId();
    const payload = await this.request<unknown>('/plots/compute', {
      method: 'POST',
      body: { request_id: requestId, spec },
    });
    return assertSceneContract(payload, requestId);
  }

  async scanImport(file: File): Promise<{ job_id: string }> {
    const form = new FormData();
    form.append('file', file);
    const raw = await this.request<{ scan_id: string; job_id: string }>('/imports/scan', { method: 'POST', raw: form });
    return { job_id: raw.job_id || raw.scan_id };
  }

  async getImportPreview(previewId: string): Promise<ImportPreview> {
    const raw = await this.request<{
      scan_id: string; file_sha256: string;
      sheets: Array<{ name: string; columns: Array<Record<string, unknown>>; head_rows: string[][] }>;
      total_rows: number; total_columns: number;
    }>(`/imports/${encodeURIComponent(previewId)}/preview`);
    const letter = (i: number) => String.fromCharCode(65 + (i % 26));
    return {
      preview_id: raw.scan_id,
      file_name: raw.scan_id,
      file_size: 0,
      sha256: raw.file_sha256,
      sheets: (raw.sheets ?? []).map((s) => ({
        sheet_name: s.name,
        rows: (s.head_rows ?? []).length,
        columns: (s.columns ?? []).length,
        suggested_role: /normalization|reference|参考/i.test(s.name) ? 'reference' : 'samples',
        suggested_dataset_id: null,
        role: /normalization|reference|参考/i.test(s.name) ? 'reference' : 'samples',
        enabled: !/normalization|参考/i.test(s.name),
      })),
      columns: (raw.sheets ?? []).flatMap((s) =>
        (s.columns ?? []).map((c) => ({
          sheet: s.name,
          column_index: Number(c.index ?? 0),
          column_letter: letter(Number(c.index ?? 0)),
          header_raw: String(c.header ?? ''),
          sample_values: (c.sample_values as string[]) ?? [],
          target: Number(c.numeric_count ?? 0) > 0 ? 'measurement' : 'metadata',
          analyte: String(c.header ?? ''),
          chemical_form: null,
          unit: null,
          value_state: 'raw_concentration',
          channel: null,
          duplicate_of: null,
          confirmed: false,
        })),
      ) as ImportPreview['columns'],
      head_rows: raw.sheets?.[0]?.head_rows ?? [],
      issues: [],
      overlaps: [],
    } as ImportPreview;
  }

  async commitImport(previewId: string, payload: CommitImportPayload): Promise<{ job_id: string }> {
    const raw = await this.request<{ job_id: string; message: string; analysis_count: number }>(
      `/imports/${encodeURIComponent(previewId)}/commit`,
      {
        method: 'POST',
        body: {
          scan_id: previewId,
          label: payload.dataset_versions?.length ? 'Imported dataset' : 'Imported dataset',
          column_map: {},
          sheet_config: {},
        },
      },
    );
    return { job_id: raw.job_id };
  }

  async listProjects(): Promise<Project[]> {
    const raw = await this.request<{ projects: Array<Record<string, unknown>>; total: number }>('/projects/');
    return (raw.projects ?? []).map((p) => ({
      project_id: String(p.project_id),
      name: String(p.name ?? p.project_id),
      revision: 0,
      dataset_versions: [],
      figure_count: Number(p.figure_count ?? 0),
      export_root: null,
      created_at: String(p.created_at ?? ''),
      updated_at: String(p.created_at ?? ''),
    }));
  }

  async createProject(name: string): Promise<Project> {
    const raw = await this.request<{ project_id: string; name: string; created_at: string }>('/projects/', {
      method: 'POST',
      body: { name },
    });
    return {
      project_id: raw.project_id,
      name: raw.name,
      revision: 0,
      dataset_versions: [],
      figure_count: 0,
      export_root: null,
      created_at: raw.created_at,
      updated_at: raw.created_at,
    };
  }

  async getProject(projectId: string): Promise<Project> {
    const raw = await this.request<{ project_id: string; name: string; created_at: string }>(`/projects/${encodeURIComponent(projectId)}`);
    // 项目携带数据集版本（工作台查询按此过滤）
    let datasetVersions: Array<{ dataset_id: string; version: string }> = [];
    try {
      const datasets = await this.listDatasets();
      datasetVersions = datasets.map((d) => ({ dataset_id: d.dataset_id, version: d.version }));
    } catch {
      /* 数据集不可用时查询回退 ['1.0'] */
    }
    return {
      project_id: raw.project_id,
      name: raw.name,
      revision: 0,
      dataset_versions: datasetVersions,
      figure_count: 0,
      export_root: null,
      created_at: raw.created_at,
      updated_at: raw.created_at,
    };
  }

  async putProject(projectId: string, _expectedRevision: number, name: string): Promise<Project> {
    await this.request(`/projects/${encodeURIComponent(projectId)}/save`, { method: 'POST', body: { name } });
    return this.getProject(projectId);
  }

  async listFigures(projectId: string, archived = false): Promise<Figure[]> {
    const raw = await this.request<{ figures: Array<Record<string, unknown>>; total: number }>(`/projects/${encodeURIComponent(projectId)}/figures`);
    return (raw.figures ?? [])
      .map((f) => toFigure(f, projectId))
      .filter((f) => Boolean(f.archived) === archived);
  }

  async createFigure(
    projectId: string,
    name: string,
    spec: PlotSpec,
    selectionSnapshots: FigureDraft['selection_snapshots'],
  ): Promise<{ figure: Figure; draft: FigureDraft }> {
    const raw = await this.request<{ figure_id: string; project_id: string; scene_hash: string; created_at: string }>('/figures', {
      method: 'POST',
      body: { project_id: projectId, plot_spec: spec, label: name },
    });
    const figure = toFigure(
      { figure_id: raw.figure_id, project_id: raw.project_id, name, chart_type: spec.chart_type, metadata_revision: 1, archived: false, created_at: raw.created_at, updated_at: raw.created_at },
      projectId,
    );
    return {
      figure,
      draft: { figure_id: raw.figure_id, draft_revision: 1, spec, selection_snapshots: selectionSnapshots ?? [], saved_at: raw.created_at },
    };
  }

  async getFigure(figureId: string): Promise<{ figure: Figure; draft: FigureDraft | null; revisions: FigureRevision[] }> {
    const info = await this.request<Record<string, unknown>>(`/figures/${encodeURIComponent(figureId)}`);
    const versionsRaw = await this.request<{ versions: Array<Record<string, unknown>> }>(`/figures/${encodeURIComponent(figureId)}/versions`);
    const revisions: FigureRevision[] = (versionsRaw.versions ?? []).map((v) => ({
      figure_id: figureId,
      revision_id: String(v.revision_id),
      revision_number: Number(v.revision_number ?? 1),
      spec: (v.spec as PlotSpec) ?? ({} as PlotSpec),
      scene_id: (v.scene_id as string | null) ?? null,
      source_versions: [],
      reference_snapshots: [],
      resolved_analysis_ids: [],
      created_at: String(v.created_at ?? ''),
      content_hash: String(v.scene_hash ?? ''),
    }));
    const latest = revisions[0];
    return {
      figure: toFigure(info),
      draft: latest
        ? { figure_id: figureId, draft_revision: latest.revision_number, spec: latest.spec, selection_snapshots: [], saved_at: latest.created_at }
        : null,
      revisions,
    };
  }

  async saveDraft(
    figureId: string,
    _expectedRevision: number,
    spec: PlotSpec,
    selectionSnapshots: FigureDraft['selection_snapshots'],
    _operation: string,
  ): Promise<FigureDraft> {
    const raw = await this.request<{ figure_id: string; scene_hash: string; revision: number; revised_at: string }>(
      `/figures/${encodeURIComponent(figureId)}/revise`,
      { method: 'POST', body: { plot_spec: spec, label: '' } },
    );
    return { figure_id: figureId, draft_revision: raw.revision ?? 1, spec, selection_snapshots: selectionSnapshots ?? [], saved_at: raw.revised_at };
  }

  async patchFigure(figureId: string, _expectedRevision: number, patch: { name?: string; archived?: boolean }): Promise<Figure> {
    const raw = await this.request<Record<string, unknown>>(`/figures/${encodeURIComponent(figureId)}`, {
      method: 'PATCH',
      body: patch,
    });
    return toFigure(raw);
  }

  async createRevision(figureId: string, _draftRevision: number, sceneId: string): Promise<FigureRevision> {
    const raw = await this.request<{ figure_id: string; status: string; scene_hash: string }>(
      `/figures/${encodeURIComponent(figureId)}/publish`,
      { method: 'POST' },
    );
    return {
      figure_id: figureId,
      revision_id: `${figureId}_published`,
      revision_number: 1,
      spec: {} as PlotSpec,
      scene_id: sceneId || null,
      source_versions: [],
      reference_snapshots: [],
      resolved_analysis_ids: [],
      created_at: new Date().toISOString(),
      content_hash: raw.scene_hash,
    };
  }

  async listRevisions(figureId: string): Promise<FigureRevision[]> {
    const raw = await this.request<{ versions: Array<Record<string, unknown>> }>(`/figures/${encodeURIComponent(figureId)}/versions`);
    return (raw.versions ?? []).map((v) => ({
      figure_id: figureId,
      revision_id: String(v.revision_id),
      revision_number: Number(v.revision_number ?? 1),
      spec: (v.spec as PlotSpec) ?? ({} as PlotSpec),
      scene_id: (v.scene_id as string | null) ?? null,
      source_versions: [],
      reference_snapshots: [],
      resolved_analysis_ids: [],
      created_at: String(v.created_at ?? ''),
      content_hash: String(v.scene_hash ?? ''),
    }));
  }

  async restoreRevision(figureId: string, revisionId: string): Promise<{ figure: Figure; draft: FigureDraft }> {
    await this.request(`/figures/${encodeURIComponent(figureId)}/restore?revision_id=${encodeURIComponent(revisionId)}`, {
      method: 'POST',
    });
    const detail = await this.getFigure(figureId);
    return {
      figure: detail.figure,
      draft: detail.draft ?? { figure_id: figureId, draft_revision: 1, spec: {} as PlotSpec, selection_snapshots: [], saved_at: '' },
    };
  }

  async listOperations(figureId: string): Promise<OperationRecord[]> {
    const raw = await this.request<{ versions: Array<Record<string, unknown>> }>(`/figures/${encodeURIComponent(figureId)}/versions`);
    return (raw.versions ?? []).map((v) => ({
      operation_id: String(v.revision_id),
      figure_id: figureId,
      draft_or_revision: 'revision',
      timestamp: String(v.created_at ?? ''),
      action: 'save_revision',
      changed_fields: [],
      before_summary: '',
      after_summary: `版本 ${String(v.revision_number ?? 1)}（scene ${String(v.scene_hash ?? '').slice(0, 12)}）`,
      request_id: '',
    }));
  }

  async chooseExportRoot(projectId: string): Promise<Job<ExportRootChoice>> {
    const raw = await this.request<{ job_id: string; status: string; result: { status: string; export_root: Record<string, unknown> | null } }>(
      '/export-roots/choose',
      { method: 'POST', body: { project_id: projectId } },
    );
    return {
      job_id: raw.job_id,
      status: raw.status as Job['status'],
      phase: 'choose',
      processed: 1,
      total: 1,
      result: {
        status: (raw.result?.status as ExportRootChoice['status']) ?? 'succeeded',
        export_root: raw.result?.export_root
          ? {
              export_root_id: String(raw.result.export_root.export_root_id),
              project_id: projectId,
              absolute_path: String(raw.result.export_root.absolute_path),
              display_name: String(raw.result.export_root.display_name ?? ''),
              selected_by_user_at: String(raw.result.export_root.selected_by_user_at ?? ''),
              writable_check: 'ok',
              is_default: true,
            }
          : null,
      },
      error: null,
    };
  }

  async registerExportRoot(projectId: string, absolutePath: string): Promise<ExportRoot> {
    const raw = await this.request<Record<string, unknown>>('/export-roots', {
      method: 'POST',
      body: { project_id: projectId, absolute_path: absolutePath, display_name: '' },
    });
    return {
      export_root_id: String(raw.export_root_id),
      project_id: projectId,
      absolute_path: String(raw.absolute_path),
      display_name: String(raw.display_name ?? ''),
      selected_by_user_at: String(raw.selected_by_user_at ?? ''),
      writable_check: (raw.writable_check as ExportRoot['writable_check']) ?? 'ok',
      is_default: Boolean(raw.is_default),
    };
  }

  async listExportRoots(projectId: string): Promise<ExportRoot[]> {
    const raw = await this.request<Array<Record<string, unknown>>>(`/export-roots?project_id=${encodeURIComponent(projectId)}`);
    return (raw ?? []).map((r) => ({
      export_root_id: String(r.export_root_id),
      project_id: projectId,
      absolute_path: String(r.absolute_path),
      display_name: String(r.display_name ?? ''),
      selected_by_user_at: String(r.selected_by_user_at ?? ''),
      writable_check: (r.writable_check as ExportRoot['writable_check']) ?? 'ok',
      is_default: Boolean(r.is_default),
    }));
  }

  startExport(req: ExportRequest): Promise<{ job_id: string; export_id: string }> {
    return this.request('/exports', {
      method: 'POST',
      body: {
        figure_id: req.figure_id,
        revision_id: req.revision_id,
        scene_id: req.scene_id,
        formats: req.formats,
        dpi: req.dpi,
        background: req.background,
        size_mm: req.size_mm,
        export_root_id: req.export_root_id,
        include_bundle: req.include_bundle,
      },
    });
  }

  async listExports(projectId: string): Promise<ExportRecord[]> {
    const raw = await this.request<Array<Record<string, unknown>>>(`/exports?project_id=${encodeURIComponent(projectId)}`);
    return (raw ?? []).map(toExportRecord);
  }

  async getExport(exportId: string): Promise<ExportRecord> {
    const raw = await this.request<Record<string, unknown>>(`/exports/${encodeURIComponent(exportId)}`);
    return toExportRecord(raw);
  }

  openExportFolder(exportId: string): Promise<{ opened: boolean; path: string; error?: string }> {
    return this.request(`/exports/${encodeURIComponent(exportId)}/open-folder`, { method: 'POST' });
  }

  reexport(exportId: string, exportRootId?: string): Promise<{ job_id: string; export_id: string }> {
    return this.request(`/exports/${encodeURIComponent(exportId)}/reexport`, {
      method: 'POST',
      body: exportRootId ? { export_root_id: exportRootId } : {},
    });
  }

  getJob<T = unknown>(jobId: string): Promise<Job<T>> {
    return this.request(`/jobs/${encodeURIComponent(jobId)}`);
  }

  cancelJob(jobId: string): Promise<Job> {
    return this.request(`/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' });
  }

  runtimeStatus(): Promise<RuntimeStatus> {
    return this.request('/runtime/status');
  }

  artifactUrl(artifactId: string): string {
    return `${API}/artifacts/${encodeURIComponent(artifactId)}`;
  }
}

/**
 * 前端必需端点（对应后端实际路由；probe 门禁用）。
 * 这是工作台可用的最小集合，全部已在 HANDOFF 45 端点中提供。
 */
export const REQUIRED_ENDPOINTS = [
  'GET /api/v1/datasets',
  'POST /api/v1/datasets/query',
  'POST /api/v1/datasets/facets',
  'GET /api/v1/catalog/builtin',
  'POST /api/v1/catalog/attach',
  'POST /api/v1/plots/compute',
  'GET /api/v1/projects',
  'GET /api/v1/projects/{project_id}',
  'GET /api/v1/projects/{project_id}/figures',
  'POST /api/v1/figures',
  'GET /api/v1/figures/{figure_id}',
  'POST /api/v1/figures/{figure_id}/revise',
  'GET /api/v1/figures/{figure_id}/versions',
  'POST /api/v1/figures/{figure_id}/restore',
  'POST /api/v1/exports',
  'GET /api/v1/exports/{export_id}',
  'POST /api/v1/exports/{export_id}/open-folder',
  'POST /api/v1/exports/{export_id}/reexport',
  'GET /api/v1/jobs/{job_id}',
  'POST /api/v1/jobs/{job_id}/cancel',
] as const;

export interface BackendProbe {
  reachable: boolean;
  schemaOk: boolean;
  schemaVersion: string | null;
  missing: string[];
}

function normalizePath(path: string): string {
  return path.replace(/\{[^}]+\}/g, '{}').replace(/\/+$/, '');
}

/** 把 OpenAPI paths 转成 "METHOD /path" 集合。 */
export function collectEndpoints(paths: Record<string, Record<string, unknown>>): Set<string> {
  const found = new Set<string>();
  for (const [path, operations] of Object.entries(paths)) {
    for (const method of Object.keys(operations)) {
      found.add(`${method.toUpperCase()} ${normalizePath(path)}`);
    }
  }
  return found;
}

export function diffEndpoints(found: Set<string>, required: readonly string[] = REQUIRED_ENDPOINTS): string[] {
  return required.filter((item) => {
    const [method, path] = item.split(' ');
    return !found.has(`${method} ${normalizePath(path)}`);
  });
}

/**
 * 探测本地服务：先看健康接口，再对照 OpenAPI 计算缺失的必需端点。
 * 12 秒超时，避免浏览器卡死；任何异常都按“不可达”返回。
 */
export async function probeBackend(): Promise<BackendProbe> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const health = await fetch(`${API}/health`, { signal: controller.signal });
    if (!health.ok) return { reachable: false, schemaOk: false, schemaVersion: null, missing: [...REQUIRED_ENDPOINTS] };
    const payload = (await health.json()) as { status?: string; schema_version?: string };
    const schemaVersion = payload.schema_version ?? null;
    const schemaOk = payload.status === 'ok' && schemaVersion === EXPECTED_SCENE_VERSION;
    if (!schemaOk) return { reachable: true, schemaOk: false, schemaVersion, missing: [...REQUIRED_ENDPOINTS] };
    const specResponse = await fetch('/api/openapi.json', { signal: controller.signal });
    if (!specResponse.ok) return { reachable: true, schemaOk: true, schemaVersion, missing: [...REQUIRED_ENDPOINTS] };
    const spec = (await specResponse.json()) as { paths?: Record<string, Record<string, unknown>> };
    return {
      reachable: true,
      schemaOk: true,
      schemaVersion,
      missing: diffEndpoints(collectEndpoints(spec.paths ?? {})),
    };
  } catch {
    return { reachable: false, schemaOk: false, schemaVersion: null, missing: [...REQUIRED_ENDPOINTS] };
  } finally {
    clearTimeout(timer);
  }
}
