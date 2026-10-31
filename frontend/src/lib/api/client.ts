/**
 * 前端与本地服务之间的最小客户端契约。
 *
 * 真实实现见 ./http.ts，演示实现见 ../mock/mockApi.ts；
 * 组件只依赖本文件的 ApiClient 与 ApiError，不直接拼 URL。
 */

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
  ImportSheet,
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

export interface HealthInfo {
  status: string;
  app_version: string;
  schema_version: string;
}

/** 导入预览提交时的映射，字段与 /imports/{id}/commit 请求体一致。 */
export interface CommitImportPayload {
  sheets: Array<{ sheet_name: string; role: ImportSheet['role'] }>;
  mappings: Array<{
    sheet: string;
    column_index: number;
    target: string;
    analyte: string | null;
    chemical_form: string | null;
    unit: string | null;
    value_state: string | null;
    channel: string | null;
    confirmed: boolean;
  }>;
  reference_maps: Array<{
    sheet: string;
    element: string;
    column_index: number;
    value_column_index: number;
  }>;
  duplicate_decisions: Array<{ sheet: string; decision: string }>;
  dataset_versions: Array<{ dataset_id: string; version: string }>;
}

/** 导出请求（05 §7）：写入用户选择的目录，而不是浏览器下载。 */
export interface ExportRequest {
  figure_id: string;
  revision_id: string;
  scene_id: string;
  formats: Array<'png' | 'pdf' | 'svg'>;
  dpi: number | null;
  background: 'white' | 'transparent';
  size_mm: { width: number; height: number };
  export_root_id: string;
  include_bundle: boolean;
}

export interface ExportRootChoice {
  status: 'succeeded' | 'cancelled';
  export_root: ExportRoot | null;
}

export interface ApiErrorOptions {
  status?: number;
  fieldErrors?: Array<{ path: string; message: string }>;
  requestId?: string;
  details?: unknown;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly fieldErrors?: Array<{ path: string; message: string }>;
  readonly requestId?: string;
  readonly details?: unknown;

  constructor(code: string, message: string, options: ApiErrorOptions = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = options.status;
    this.fieldErrors = options.fieldErrors;
    this.requestId = options.requestId;
    this.details = options.details;
  }
}

let requestSeq = 0;

export function nextRequestId(): string {
  requestSeq += 1;
  return `req_${Date.now().toString(36)}_${requestSeq.toString(36)}`;
}

export interface PollOptions {
  timeoutMs?: number;
  intervalMs?: number;
  onUpdate?: (job: Job) => void;
}

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'interrupted']);

/** 轮询后台任务直到终态；超时抛 ApiError，不静默成功。 */
export async function pollJob<T>(api: ApiClient, jobId: string, options: PollOptions = {}): Promise<Job<T>> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const intervalMs = options.intervalMs ?? 300;
  const started = Date.now();
  for (;;) {
    const job = await api.getJob<T>(jobId);
    options.onUpdate?.(job);
    if (TERMINAL.has(job.status)) return job;
    if (Date.now() - started > timeoutMs) {
      throw new ApiError('POLL_TIMEOUT', `后台任务等待超时（阶段：${job.phase}）`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export interface ApiClient {
  readonly mode: 'mock' | 'live';

  health(): Promise<HealthInfo>;
  getCatalog(): Promise<{ entries: CatalogEntry[]; references: ReferenceComposition[]; pending_confirmations: number }>;
  attachCatalog(dataId: string, projectId: string): Promise<{ dataset_id: string; version: string; attached: boolean }>;
  listDatasets(): Promise<Dataset[]>;
  queryAnalyses(req: AnalysisQueryRequest): Promise<AnalysisQueryResponse>;
  getFacets(req: { dataset_versions: AnalysisQueryRequest['dataset_versions']; filter: QueryFilter }): Promise<Facets>;
  getAnalysis(analysisId: string): Promise<AnalysisDetail>;
  createSelection(input: SelectionSet): Promise<SelectionSet>;
  listReferences(): Promise<ReferenceComposition[]>;
  computePlot(spec: PlotSpec): Promise<PlotScene>;

  scanImport(file: File): Promise<{ job_id: string }>;
  getImportPreview(previewId: string): Promise<ImportPreview>;
  commitImport(previewId: string, payload: CommitImportPayload): Promise<{ job_id: string }>;

  listProjects(): Promise<Project[]>;
  createProject(name: string): Promise<Project>;
  getProject(projectId: string): Promise<Project>;
  putProject(projectId: string, expectedRevision: number, name: string): Promise<Project>;

  listFigures(projectId: string, archived?: boolean): Promise<Figure[]>;
  createFigure(
    projectId: string,
    name: string,
    spec: PlotSpec,
    selectionSnapshots: FigureDraft['selection_snapshots'],
  ): Promise<{ figure: Figure; draft: FigureDraft }>;
  getFigure(figureId: string): Promise<{ figure: Figure; draft: FigureDraft | null; revisions: FigureRevision[] }>;
  saveDraft(
    figureId: string,
    expectedRevision: number,
    spec: PlotSpec,
    selectionSnapshots: FigureDraft['selection_snapshots'],
    operation: string,
  ): Promise<FigureDraft>;
  patchFigure(figureId: string, expectedRevision: number, patch: { name?: string; archived?: boolean }): Promise<Figure>;
  createRevision(figureId: string, draftRevision: number, sceneId: string): Promise<FigureRevision>;
  listRevisions(figureId: string): Promise<FigureRevision[]>;
  restoreRevision(figureId: string, revisionId: string): Promise<{ figure: Figure; draft: FigureDraft }>;
  listOperations(figureId: string): Promise<OperationRecord[]>;

  chooseExportRoot(projectId: string): Promise<Job<ExportRootChoice>>;
  registerExportRoot(projectId: string, absolutePath: string): Promise<ExportRoot>;
  listExportRoots(projectId: string): Promise<ExportRoot[]>;
  startExport(req: ExportRequest): Promise<{ job_id: string; export_id: string }>;
  listExports(projectId: string): Promise<ExportRecord[]>;
  getExport(exportId: string): Promise<ExportRecord>;
  openExportFolder(exportId: string): Promise<{ opened: boolean; path: string; error?: string }>;
  reexport(exportId: string, exportRootId?: string): Promise<{ job_id: string; export_id: string }>;

  getJob<T = unknown>(jobId: string): Promise<Job<T>>;
  cancelJob(jobId: string): Promise<Job>;
  runtimeStatus(): Promise<RuntimeStatus>;
  artifactUrl(artifactId: string): string;

  /** 仅演示模式：模拟外部删文件，用于验证“文件缺失可发现”。 */
  demoRemoveExportFile?(exportId: string, filename: string): Promise<ExportRecord>;
}
