/**
 * 演示模式 ApiClient。
 *
 * 与真实 HTTP 客户端实现同一 ApiClient 接口；组件不感知差异。
 * T08 联调时由 CONTRACT_READY/真实 /health 切换到 src/lib/api/http.ts，演示实现不再启用。
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
  ImportReport,
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
import { ApiError, type ApiClient, type CommitImportPayload, type ExportRequest, type ExportRootChoice, type HealthInfo } from '../api/client';
import { ANALYSES, CATALOG, DATASETS, DATA_IDS, REFERENCES, type MockAnalysis } from './fixtures';
import { buildScene, hashString, stableStringify } from './scene';
import {
  buildImportReport,
  buildPreview,
  loadDb,
  makeExportFiles,
  resetDb,
  saveDb,
  type MockDb,
} from './mockDb';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const SOFTWARE_VERSION = '0.1.0-demo';

interface StoredScene {
  scene: PlotScene;
  spec_hash: string;
}

/** 与后端 services.classification 同规则（sample_prefix_v1）：样品名前段标号 */
function deriveSampleGroup(sampleId: string | null | undefined): string {
  const m = /^([A-Za-z0-9]+)/.exec((sampleId ?? '').trim());
  return m ? m[1] : 'unknown';
}

function resolveFilter(filter: QueryFilter, datasetIds: string[]): MockAnalysis[] {
  const search = filter.sample_search;
  return ANALYSES.filter((a) => {
    if (!datasetIds.includes(a.dataset_id)) return false;
    if (filter.mission?.length && !filter.mission.includes(a.mission)) return false;
    if (filter.sample_group?.length && !filter.sample_group.includes(deriveSampleGroup(a.sample_id))) return false;
    if (filter.material_type?.length && !filter.material_type.includes(a.material_type)) return false;
    if (filter.mineral_group?.length && !filter.mineral_group.includes(a.mineral_group)) return false;
    if (filter.parent_sample && a.parent_sample !== filter.parent_sample) return false;
    if (search?.text) {
      const text = search.text.trim();
      if (search.mode === 'exact' && a.raw_name !== text) return false;
      if (search.mode === 'parent' && a.parent_sample !== text) return false;
      if (search.mode === 'contains') {
        const hay = `${a.raw_name} ${a.parent_sample ?? ''} ${a.citation ?? ''}`;
        if (!hay.includes(text)) return false;
      }
    }
    return true;
  });
}

function datasetIdsOf(versions: Array<{ dataset_id: string; version: string }>): string[] {
  return [...new Set(versions.map((v) => v.dataset_id))];
}

function facetBuckets(items: MockAnalysis[], key: keyof MockAnalysis): Array<{ value: string; label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const value = String(item[key] ?? 'unknown');
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, label: value, count }))
    .sort((a, b) => b.count - a.count);
}

const MATERIAL_LABEL: Record<string, string> = {
  whole_rock: '全岩', mineral: '矿物', glass: '玻璃', soil: '月壤', clast: '岩屑',
  separate: '分选', leachate: '淋滤', residue: '残余', matrix: '基质', groundmass: '基质',
  vein: '脉体', mesostasis: '间隙', melt_inclusion: '熔体包裹体', unknown: '待确认',
};

const MINERAL_LABEL: Record<string, string> = {
  pyroxene: '辉石', plagioclase: '斜长石', olivine: '橄榄石', oxide: '氧化物',
  phosphate: '磷酸盐', other: '其他', unknown: '待确认',
};

const slug = (text: string) => text.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '').slice(0, 40) || 'figure';

export class MockApiClient implements ApiClient {
  readonly mode = 'mock' as const;
  private db: MockDb;
  private jobs = new Map<string, Job<unknown>>();
  private scenes = new Map<string, StoredScene>();
  private previews = new Map<string, ImportPreview>();

  constructor() {
    this.db = loadDb();
  }

  private persist() {
    saveDb(this.db);
  }

  async health(): Promise<HealthInfo> {
    return { status: 'ok', app_version: SOFTWARE_VERSION, schema_version: '1.1' };
  }

  async getCatalog() {
    return {
      entries: CATALOG.map((c) => ({ ...c })),
      references: REFERENCES,
      pending_confirmations: CATALOG.reduce((sum, c) => sum + (c.unit_confirmation_pending > 0 ? 1 : 0), 0),
    };
  }

  async attachCatalog(dataId: string, _projectId: string) {
    const entry = CATALOG.find((c) => c.data_id === dataId);
    if (!entry?.dataset_id) throw new ApiError('UNSUPPORTED_FILE', '该目录项不是样品数据集');
    if (this.db.attached[dataId]) {
      return { dataset_id: this.db.attached[dataId], version: '1', attached: true };
    }
    this.db.attached[dataId] = entry.dataset_id;
    this.persist();
    return { dataset_id: entry.dataset_id, version: '1', attached: true };
  }

  async listDatasets(): Promise<Dataset[]> {
    return DATASETS;
  }

  async queryAnalyses(req: AnalysisQueryRequest): Promise<AnalysisQueryResponse> {
    await delay(30);
    const ids = datasetIdsOf(req.dataset_versions);
    const rows = resolveFilter(req.filter, ids);
    const sorted = [...rows];
    if (req.sort) {
      const { field, direction } = req.sort;
      sorted.sort((a, b) => {
        const av = String((a as unknown as Record<string, unknown>)[field] ?? '');
        const bv = String((b as unknown as Record<string, unknown>)[field] ?? '');
        return direction === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }
    const page = sorted.slice(req.offset, req.offset + req.limit);
    return {
      rows: page.map((a) => ({ ...a, sample_group: deriveSampleGroup(a.sample_id) })),
      total: sorted.length,
      counts: {
        total: sorted.length,
        whole_rock: sorted.filter((a) => a.material_type === 'whole_rock').length,
        mineral: sorted.filter((a) => a.material_type === 'mineral').length,
        glass: sorted.filter((a) => a.material_type === 'glass').length,
        unknown_material: sorted.filter((a) => a.material_type === 'unknown').length,
      },
      query_hash: hashString(stableStringify({ filter: req.filter, ids, offset: req.offset, limit: req.limit })),
      dataset_versions: req.dataset_versions,
    };
  }

  async getFacets(req: { dataset_versions: AnalysisQueryRequest['dataset_versions']; filter: QueryFilter }): Promise<Facets> {
    const ids = datasetIdsOf(req.dataset_versions);
    const base = resolveFilter(req.filter, ids);
    const without = (key: 'mission' | 'material_type' | 'mineral_group') => {
      const filter: QueryFilter = { ...req.filter, [key]: undefined };
      return resolveFilter(filter, ids);
    };
    const parents = new Map<string, number>();
    for (const item of base) {
      if (item.parent_sample) parents.set(item.parent_sample, (parents.get(item.parent_sample) ?? 0) + 1);
    }
    const groupCounts = new Map<string, number>();
    for (const item of resolveFilter({ ...req.filter, sample_group: undefined }, ids)) {
      const g = deriveSampleGroup(item.sample_id);
      groupCounts.set(g, (groupCounts.get(g) ?? 0) + 1);
    }
    return {
      datasets: DATASETS.filter((d) => ids.includes(d.dataset_id)).map((d) => ({
        value: d.dataset_id, label: d.label, count: ANALYSES.filter((a) => a.dataset_id === d.dataset_id).length,
      })),
      missions: facetBuckets(without('mission'), 'mission').map((b) => ({
        ...b, label: b.value === 'unknown' ? '待确认' : b.value,
      })),
      sample_groups: [...groupCounts.entries()]
        .map(([value, count]) => ({ value, label: value, count }))
        .sort((a, b) => b.count - a.count),
      material_types: facetBuckets(without('material_type'), 'material_type').map((b) => ({
        ...b, label: MATERIAL_LABEL[b.value] ?? b.value,
      })),
      mineral_groups: facetBuckets(without('mineral_group'), 'mineral_group').map((b) => ({
        ...b, label: MINERAL_LABEL[b.value] ?? b.value,
      })),
      parents: [...parents.entries()].map(([value, count]) => ({ value, label: value, count })).sort((a, b) => b.count - a.count),
    };
  }

  async getAnalysis(analysisId: string): Promise<AnalysisDetail> {
    const record = ANALYSES.find((a) => a.analysis_id === analysisId);
    if (!record) throw new ApiError('NOT_FOUND', '未找到该分析记录', { status: 404 });
    const measurements = Object.entries(record.values).map(([analyte, value], index) => ({
      measurement_id: `${record.analysis_id}_m${index}`,
      analyte,
      chemical_form: ['SiO2', 'TiO2', 'Al2O3', 'FeOT', 'MnO', 'MgO', 'CaO', 'Na2O', 'K2O', 'P2O5'].includes(analyte)
        ? ('oxide' as const)
        : ('element' as const),
      channel: analyte,
      value,
      unit: record.units[analyte] ?? null,
      unit_confirmed: !record.unconfirmed_units.includes(analyte),
      value_state: 'raw_concentration',
      quality_flags: record.unconfirmed_units.includes(analyte) ? ['unit_unconfirmed'] : [],
      source_cell: `${record.source.sheet}!${analyte}${record.source.row}`,
      uncertainty: null,
      uncertainty_label: null,
      detection_limit: null,
    }));
    return {
      ...record,
      sample_group: deriveSampleGroup(record.sample_id),
      measurements,
      classification_evidence: [
        {
          field: 'material_type',
          raw_value: record.material_type,
          normalized_value: record.material_type,
          rule_id: record.dataset_id === 'ds_apollo' ? 'analyzed_material' : 'phase_and_name_rule',
          evidence_cells: [`${record.source.sheet}!G${record.source.row}`],
          confidence: record.material_type === 'unknown' ? 0.2 : 0.9,
          confirmed: record.material_type !== 'unknown',
        },
        ...(record.batch
          ? [{
              field: 'batch',
              raw_value: record.batch,
              normalized_value: record.batch,
              rule_id: 'task_batch_rule',
              evidence_cells: [`${record.source.sheet}!A${record.source.row}`],
              confidence: 0.8,
              confirmed: true,
            }]
          : []),
      ],
    };
  }

  async createSelection(input: SelectionSet): Promise<SelectionSet> {
    const versions = input.dataset_versions ?? [];
    const ids = datasetIdsOf(versions);
    const matched = resolveFilter(input.filter, ids);
    const resolved = [...new Set([...matched.map((a) => a.analysis_id), ...input.include_ids])]
      .filter((id) => !input.exclude_ids.includes(id));
    const analysesOfIds = resolved.map((id) => ANALYSES.find((a) => a.analysis_id === id)).filter(Boolean) as MockAnalysis[];
    const selection: SelectionSet = {
      ...input,
      selection_id: input.selection_id ?? `sel_${Date.now().toString(36)}`,
      resolved_ids: resolved,
      resolved_count: resolved.length,
      distinct_samples: new Set(analysesOfIds.map((a) => a.parent_sample ?? a.sample_id)).size,
      selection_hash: hashString(stableStringify({ filter: input.filter, ids: resolved })),
    };
    const index = this.db.selections.findIndex((s) => s.selection_id === selection.selection_id);
    if (index >= 0) {
      this.db.selections[index] = { ...this.db.selections[index], ...selection };
    } else {
      this.db.selections.push(selection);
    }
    this.persist();
    return selection;
  }

  async listReferences(): Promise<ReferenceComposition[]> {
    return REFERENCES;
  }

  private resolveSelectionsForSpec(spec: PlotSpec) {
    return spec.layers.map((layer) => {
      const stored = this.db.selections.find((s) => s.selection_id === layer.selection_id);
      let ids = stored?.resolved_ids ?? [];
      const versions = stored?.dataset_versions ?? [];
      if (stored && !ids.length) {
        const datasetIds = datasetIdsOf(stored.dataset_versions);
        ids = resolveFilter(stored.filter, datasetIds).map((a) => a.analysis_id);
      }
      return {
        selection_id: layer.selection_id,
        selection_hash: stored?.selection_hash ?? hashString(stableStringify(ids)),
        analysis_ids: ids,
        dataset_versions: versions,
      };
    });
  }

  private computeSceneSync(spec: PlotSpec, requestId: string) {
    const selections = this.resolveSelectionsForSpec(spec);
    const scene = buildScene({
      spec,
      requestId,
      analyses: ANALYSES,
      selections,
      references: REFERENCES,
      softwareVersion: SOFTWARE_VERSION,
    });
    this.scenes.set(scene.scene_id, { scene, spec_hash: scene.spec_hash });
    return scene;
  }

  async computePlot(spec: PlotSpec): Promise<PlotScene> {
    await delay(60);
    return this.computeSceneSync(spec, `req_compute_${Date.now().toString(36)}`);
  }

  /* -------------------------- 导入 -------------------------- */

  async scanImport(file: File): Promise<{ job_id: string }> {
    const name = file.name.toLowerCase();
    if (!name.endsWith('.xlsx') && !name.endsWith('.csv')) {
      throw new ApiError('UNSUPPORTED_FILE', '仅支持 .xlsx 与已定义的 CSV 文件', { status: 422 });
    }
    if (name.startsWith('~$')) {
      throw new ApiError('UNSUPPORTED_FILE', '这是 Excel 临时锁文件，请选择正式工作簿', { status: 422 });
    }
    if (file.size > 100 * 1024 * 1024) {
      throw new ApiError('UNSUPPORTED_FILE', '文件超过 100 MB 限制', { status: 422 });
    }
    const preview = buildPreview(file);
    this.previews.set(preview.preview_id, preview);
    const job: Job<{ preview_id: string }> = {
      job_id: `job_scan_${Date.now().toString(36)}`, status: 'running', phase: 'scanning',
      processed: 0, total: 45209, result: null, error: null,
    };
    this.jobs.set(job.job_id, job);
    const steps = [12000, 26000, 40100, 45209];
    steps.forEach((processed, index) => {
      setTimeout(() => {
        job.processed = processed;
        job.phase = processed === 45209 ? 'done' : 'scanning';
        job.status = processed === 45209 ? 'succeeded' : 'running';
        if (processed === 45209) job.result = { preview_id: preview.preview_id };
      }, 180 * (index + 1));
    });
    return { job_id: job.job_id };
  }

  async getImportPreview(previewId: string): Promise<ImportPreview> {
    const preview = this.previews.get(previewId);
    if (!preview) throw new ApiError('NOT_FOUND', '导入预览已过期，请重新选择文件', { status: 404 });
    return preview;
  }

  async commitImport(previewId: string, payload: CommitImportPayload): Promise<{ job_id: string }> {
    const preview = this.previews.get(previewId);
    if (!preview) throw new ApiError('NOT_FOUND', '导入预览已过期', { status: 404 });
    preview.sheets = preview.sheets.map((sheet) => {
      const change = payload.sheets.find((s) => s.sheet_name === sheet.sheet_name);
      return change ? { ...sheet, role: change.role } : sheet;
    });
    const report = buildImportReport(preview);
    const job: Job<ImportReport> = {
      job_id: `job_commit_${Date.now().toString(36)}`, status: 'running', phase: 'committing',
      processed: 0, total: 100, result: null, error: null,
    };
    this.jobs.set(job.job_id, job);
    setTimeout(() => {
      job.processed = 100;
      job.status = 'succeeded';
      job.phase = 'done';
      job.result = report;
    }, 700);
    return { job_id: job.job_id };
  }

  async getJob<T>(jobId: string): Promise<Job<T>> {
    const job = this.jobs.get(jobId);
    if (!job) throw new ApiError('NOT_FOUND', '任务不存在或已过期', { status: 404 });
    return job as Job<T>;
  }

  async cancelJob(jobId: string): Promise<Job> {
    const job = this.jobs.get(jobId);
    if (!job) throw new ApiError('NOT_FOUND', '任务不存在', { status: 404 });
    if (job.status === 'running' || job.status === 'queued') {
      job.status = 'cancelled';
      job.phase = 'cancelled';
    }
    return job;
  }

  /* -------------------------- 项目 -------------------------- */

  async listProjects(): Promise<Project[]> {
    return this.db.projects;
  }

  async createProject(name: string): Promise<Project> {
    const now = new Date().toISOString();
    const project: Project = {
      project_id: `proj_${Date.now().toString(36)}`,
      name,
      revision: 1,
      dataset_versions: DATASETS.map((d) => ({ dataset_id: d.dataset_id, version: d.version })),
      figure_count: 0,
      export_root: this.db.roots[0] ?? null,
      created_at: now,
      updated_at: now,
    };
    this.db.projects.push(project);
    this.persist();
    return project;
  }

  async getProject(projectId: string): Promise<Project> {
    const project = this.db.projects.find((p) => p.project_id === projectId);
    if (!project) throw new ApiError('NOT_FOUND', '项目不存在', { status: 404 });
    return {
      ...project,
      figure_count: this.db.figures.filter((f) => f.project_id === projectId && !f.archived).length,
      export_root: this.db.roots.find((r) => r.project_id === projectId) ?? project.export_root,
    };
  }

  async putProject(projectId: string, expectedRevision: number, name: string): Promise<Project> {
    const project = this.db.projects.find((p) => p.project_id === projectId);
    if (!project) throw new ApiError('NOT_FOUND', '项目不存在', { status: 404 });
    if (project.revision !== expectedRevision) {
      throw new ApiError('STALE_REVISION', '项目已被其他窗口修改，请重新载入或另存副本', { status: 409 });
    }
    project.name = name;
    project.revision += 1;
    project.updated_at = new Date().toISOString();
    this.persist();
    return project;
  }

  /* -------------------------- 图件 -------------------------- */

  async listFigures(projectId: string, archived = false): Promise<Figure[]> {
    return this.db.figures.filter((f) => f.project_id === projectId && f.archived === archived);
  }

  async createFigure(projectId: string, name: string, spec: PlotSpec, selectionSnapshots: FigureDraft['selection_snapshots']) {
    const now = new Date().toISOString();
    const figure: Figure = {
      figure_id: `fig_${Date.now().toString(36)}`,
      project_id: projectId,
      name,
      chart_type: spec.chart_type,
      thumbnail_artifact_id: null,
      current_revision_id: null,
      metadata_revision: 1,
      draft_revision: 1,
      archived: false,
      created_at: now,
      updated_at: now,
    };
    const draft: FigureDraft = {
      figure_id: figure.figure_id,
      draft_revision: 1,
      spec: { ...spec, plot_id: `plot_${figure.figure_id}` },
      selection_snapshots: selectionSnapshots,
      saved_at: now,
    };
    this.db.figures.push(figure);
    this.db.drafts.push(draft);
    this.db.last_opened_figure_id = figure.figure_id;
    this.persist();
    return { figure, draft };
  }

  async getFigure(figureId: string) {
    const figure = this.db.figures.find((f) => f.figure_id === figureId);
    if (!figure) throw new ApiError('NOT_FOUND', '图件不存在', { status: 404 });
    const draft = this.db.drafts.find((d) => d.figure_id === figureId) ?? null;
    const revisions = this.db.revisions.filter((r) => r.figure_id === figureId);
    return { figure, draft, revisions };
  }

  async saveDraft(figureId: string, expectedRevision: number, spec: PlotSpec, selectionSnapshots: FigureDraft['selection_snapshots'], operation: string): Promise<FigureDraft> {
    const figure = this.db.figures.find((f) => f.figure_id === figureId);
    if (!figure) throw new ApiError('NOT_FOUND', '图件不存在', { status: 404 });
    if (figure.draft_revision !== expectedRevision) {
      throw new ApiError('STALE_REVISION', '草稿已在其他地方更新，请重新载入或另存副本', { status: 409 });
    }
    const now = new Date().toISOString();
    figure.draft_revision += 1;
    figure.updated_at = now;
    let draft = this.db.drafts.find((d) => d.figure_id === figureId);
    if (!draft) {
      draft = { figure_id: figureId, draft_revision: figure.draft_revision, spec, selection_snapshots: selectionSnapshots, saved_at: now };
      this.db.drafts.push(draft);
    } else {
      draft.spec = spec;
      draft.selection_snapshots = selectionSnapshots;
      draft.draft_revision = figure.draft_revision;
      draft.saved_at = now;
    }
    this.db.operations.push({
      operation_id: `op_${Date.now().toString(36)}`,
      figure_id: figureId,
      draft_or_revision: `draft:${figure.draft_revision}`,
      timestamp: now,
      action: operation || '保存草稿',
      changed_fields: ['spec'],
      before_summary: `draft ${expectedRevision}`,
      after_summary: `draft ${figure.draft_revision}`,
      request_id: `req_${Date.now().toString(36)}`,
    });
    this.persist();
    return draft;
  }

  async patchFigure(figureId: string, expectedRevision: number, patch: { name?: string; archived?: boolean }): Promise<Figure> {
    const figure = this.db.figures.find((f) => f.figure_id === figureId);
    if (!figure) throw new ApiError('NOT_FOUND', '图件不存在', { status: 404 });
    if (figure.metadata_revision !== expectedRevision) {
      throw new ApiError('STALE_REVISION', '图件元数据已更新，请刷新后重试', { status: 409 });
    }
    if (patch.name) figure.name = patch.name;
    if (patch.archived !== undefined) figure.archived = patch.archived;
    figure.metadata_revision += 1;
    figure.updated_at = new Date().toISOString();
    this.persist();
    return figure;
  }

  private requireFigureScene(figureId: string, draftRevision: number, sceneId: string) {
    const figure = this.db.figures.find((f) => f.figure_id === figureId);
    if (!figure) throw new ApiError('NOT_FOUND', '图件不存在', { status: 404 });
    if (figure.draft_revision !== draftRevision) {
      throw new ApiError('STALE_REVISION', '草稿版本不一致，请重新计算后再保存', { status: 409 });
    }
    const draft = this.db.drafts.find((d) => d.figure_id === figureId);
    if (!draft) throw new ApiError('NOT_FOUND', '草稿不存在', { status: 404 });
    const stored = this.scenes.get(sceneId);
    if (!stored) {
      throw new ApiError('STALE_REVISION', '当前 Scene 已过期，请重新计算后再保存版本', { status: 409 });
    }
    if (stored.spec_hash !== hashString(stableStringify(draft.spec))) {
      throw new ApiError('STALE_REVISION', 'Spec 与 Scene 不一致，请重新计算', { status: 409 });
    }
    return { figure, draft, scene: stored.scene };
  }

  async createRevision(figureId: string, draftRevision: number, sceneId: string): Promise<FigureRevision> {
    const { figure, draft, scene } = this.requireFigureScene(figureId, draftRevision, sceneId);
    const existing = this.db.revisions
      .filter((r) => r.figure_id === figureId)
      .find((r) => r.content_hash === hashString(stableStringify(draft.spec)));
    if (existing) {
      figure.current_revision_id = existing.revision_id;
      this.persist();
      return existing;
    }
    const revision: FigureRevision = {
      figure_id: figureId,
      revision_id: `rev_${Date.now().toString(36)}`,
      revision_number: Math.max(0, ...this.db.revisions.filter((r) => r.figure_id === figureId).map((r) => r.revision_number)) + 1,
      spec: draft.spec,
      scene_id: scene.scene_id,
      source_versions: draft.spec.layers.flatMap((layer) => {
        const selection = this.db.selections.find((s) => s.selection_id === layer.selection_id);
        return selection?.dataset_versions ?? [];
      }).filter((v, i, arr) => arr.findIndex((x) => x.dataset_id === v.dataset_id) === i),
      reference_snapshots: scene.reference_snapshots,
      resolved_analysis_ids: [...new Set(scene.series.flatMap((s) => s.analysis_ids))],
      created_at: new Date().toISOString(),
      content_hash: hashString(stableStringify(draft.spec)),
    };
    this.db.revisions.push(revision);
    figure.current_revision_id = revision.revision_id;
    figure.updated_at = revision.created_at;
    this.persist();
    return revision;
  }

  async listRevisions(figureId: string): Promise<FigureRevision[]> {
    return this.db.revisions.filter((r) => r.figure_id === figureId).sort((a, b) => b.revision_number - a.revision_number);
  }

  async restoreRevision(figureId: string, revisionId: string) {
    const revision = this.db.revisions.find((r) => r.figure_id === figureId && r.revision_id === revisionId);
    if (!revision) throw new ApiError('NOT_FOUND', '版本不存在', { status: 404 });
    const figure = this.db.figures.find((f) => f.figure_id === figureId)!;
    const scene = this.computeSceneSync(revision.spec, `req_restore_${Date.now().toString(36)}`);
    const restored: FigureRevision = {
      ...revision,
      revision_id: `rev_${Date.now().toString(36)}`,
      revision_number: Math.max(...this.db.revisions.filter((r) => r.figure_id === figureId).map((r) => r.revision_number)) + 1,
      scene_id: scene.scene_id,
      created_at: new Date().toISOString(),
      content_hash: hashString(stableStringify({ restoredFrom: revision.revision_id, spec: revision.spec })),
    };
    this.db.revisions.push(restored);
    figure.current_revision_id = restored.revision_id;
    figure.draft_revision += 1;
    let draft = this.db.drafts.find((d) => d.figure_id === figureId);
    const now = new Date().toISOString();
    if (!draft) {
      draft = { figure_id: figureId, draft_revision: figure.draft_revision, spec: revision.spec, selection_snapshots: [], saved_at: now };
      this.db.drafts.push(draft);
    } else {
      draft.spec = { ...revision.spec, revision: revision.spec.revision + 1 };
      draft.draft_revision = figure.draft_revision;
      draft.saved_at = now;
    }
    this.persist();
    return { figure, draft };
  }

  async listOperations(figureId: string): Promise<OperationRecord[]> {
    return this.db.operations.filter((o) => o.figure_id === figureId).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  /* -------------------------- 导出 -------------------------- */

  async chooseExportRoot(projectId: string): Promise<Job<ExportRootChoice>> {
    const root = this.db.roots.find((r) => r.project_id === projectId) ?? this.db.roots[0];
    const job: Job<ExportRootChoice> = {
      job_id: `job_root_${Date.now().toString(36)}`, status: 'running', phase: 'waiting_native_dialog',
      processed: 0, total: 1, result: null, error: null,
    };
    this.jobs.set(job.job_id, job);
    setTimeout(() => {
      job.status = 'succeeded';
      job.phase = 'done';
      job.processed = 1;
      job.result = { status: 'succeeded', export_root: root ?? null };
    }, 400);
    return job;
  }

  async registerExportRoot(projectId: string, absolutePath: string): Promise<ExportRoot> {
    if (!/^[A-Za-z]:\\/.test(absolutePath) && !absolutePath.startsWith('\\\\')) {
      throw new ApiError('EXPORT_FAILED', '请输入本机绝对路径，例如 D:\\科研数据\\GeoPlot', {
        status: 422,
        fieldErrors: [{ path: 'absolute_path', message: '必须是本机绝对路径' }],
      });
    }
    const existing = this.db.roots.find((r) => r.absolute_path === absolutePath && r.project_id === projectId);
    if (existing) return existing;
    const root: ExportRoot = {
      export_root_id: `root_${Date.now().toString(36)}`,
      project_id: projectId,
      absolute_path: absolutePath.replace(/[\\]+$/, ''),
      display_name: absolutePath,
      selected_by_user_at: new Date().toISOString(),
      writable_check: 'ok',
      is_default: false,
    };
    this.db.roots.push(root);
    const project = this.db.projects.find((p) => p.project_id === projectId);
    if (project) project.export_root = root;
    this.persist();
    return root;
  }

  async listExportRoots(projectId: string): Promise<ExportRoot[]> {
    return this.db.roots.filter((r) => r.project_id === projectId);
  }

  async startExport(req: ExportRequest): Promise<{ job_id: string; export_id: string }> {
    const figure = this.db.figures.find((f) => f.figure_id === req.figure_id);
    const revision = this.db.revisions.find((r) => r.figure_id === req.figure_id && r.revision_id === req.revision_id);
    const root = this.db.roots.find((r) => r.export_root_id === req.export_root_id);
    if (!figure || !revision) throw new ApiError('EXPORT_FAILED', '图件或版本不存在，请先保存图件版本', { status: 422 });
    if (!root) throw new ApiError('EXPORT_FAILED', '导出目录未登记', { status: 422 });
    if (!this.scenes.has(req.scene_id)) {
      throw new ApiError('EXPORT_FAILED', '当前 Scene 已过期，请重新计算后再导出', { status: 409 });
    }
    if (!req.formats.length) throw new ApiError('EXPORT_FAILED', '至少选择一种输出格式', { status: 422 });
    const project = this.db.projects.find((p) => p.project_id === figure.project_id);
    const seq = this.db.exports.filter((e) => e.figure_id === figure.figure_id).length + 1;
    const exportId = `exp_${Date.now().toString(36)}_${seq}`;
    // 演示导出必须显式标 DEMO，不能与真实写盘文件混淆（TR01）。
    const relativeDir = `DEMO_${slug(project?.name ?? '项目')}\\${slug(figure.name)}\\v${String(seq).padStart(4, '0')}`;
    const scene = this.scenes.get(req.scene_id)!.scene;
    const record: ExportRecord = {
      export_id: exportId,
      figure_id: figure.figure_id,
      revision_id: revision.revision_id,
      scene_id: req.scene_id,
      scene_hash: scene.scene_hash,
      export_seq: seq,
      formats: req.formats,
      size_mm: req.size_mm,
      dpi: req.dpi,
      background: req.background,
      export_root_id: root.export_root_id,
      relative_dir: relativeDir,
      state: 'queued',
      files: [],
      error: null,
      counts: scene.counts,
      created_at: new Date().toISOString(),
      finished_at: null,
    };
    this.db.exports.push(record);
    this.persist();
    const job: Job<{ export_id: string }> = {
      job_id: `job_export_${exportId}`, status: 'running', phase: 'rendering', processed: 0, total: 4, result: null, error: null,
    };
    this.jobs.set(job.job_id, job);
    const rootPath = root.absolute_path;
    const phases: Array<[ExportRecord['state'], string, number]> = [
      ['rendering', 'rendering', 320],
      ['verifying', 'verifying', 620],
      ['committing', 'committing', 900],
      ['succeeded', 'done', 1250],
    ];
    for (const [state, phase, at] of phases) {
      setTimeout(() => {
        record.state = state;
        job.phase = phase;
        job.processed = Math.min(4, ['queued', 'rendering', 'verifying', 'committing', 'succeeded'].indexOf(state));
        if (state === 'succeeded') {
          record.files = makeExportFiles(exportId, req.formats, relativeDir, rootPath, true, 'DEMO_');
          record.finished_at = new Date().toISOString();
          job.status = 'succeeded';
          job.result = { export_id: exportId };
        }
        this.persist();
      }, at);
    }
    return { job_id: job.job_id, export_id: exportId };
  }

  async listExports(projectId: string): Promise<ExportRecord[]> {
    const figureIds = new Set(this.db.figures.filter((f) => f.project_id === projectId).map((f) => f.figure_id));
    return this.db.exports.filter((e) => figureIds.has(e.figure_id)).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async getExport(exportId: string): Promise<ExportRecord> {
    const record = this.db.exports.find((e) => e.export_id === exportId);
    if (!record) throw new ApiError('NOT_FOUND', '导出记录不存在', { status: 404 });
    return record;
  }

  async openExportFolder(exportId: string): Promise<{ opened: boolean; path: string; error?: string }> {
    const record = this.db.exports.find((e) => e.export_id === exportId);
    if (!record) throw new ApiError('NOT_FOUND', '导出记录不存在', { status: 404 });
    const root = this.db.roots.find((r) => r.export_root_id === record.export_root_id);
    return {
      opened: false,
      path: `${root?.absolute_path ?? ''}\\${record.relative_dir}`,
      error: '演示模式无法打开系统资源管理器；真实便携包由本地启动器打开保存目录。',
    };
  }

  async reexport(exportId: string, exportRootId?: string): Promise<{ job_id: string; export_id: string }> {
    const old = this.db.exports.find((e) => e.export_id === exportId);
    if (!old) throw new ApiError('NOT_FOUND', '导出记录不存在', { status: 404 });
    const revision = this.db.revisions.find((r) => r.figure_id === old.figure_id && r.revision_id === old.revision_id);
    if (!revision) throw new ApiError('EXPORT_FAILED', '原图件版本已不可用，请从图件库重新保存', { status: 422 });
    const scene = this.computeSceneSync(revision.spec, `req_reexport_${Date.now().toString(36)}`);
    return this.startExport({
      figure_id: old.figure_id,
      revision_id: revision.revision_id,
      scene_id: scene.scene_id,
      formats: old.formats as ExportRequest['formats'],
      dpi: old.dpi,
      background: old.background,
      size_mm: old.size_mm,
      export_root_id: exportRootId ?? old.export_root_id,
      include_bundle: true,
    });
  }

  async demoRemoveExportFile(exportId: string, filename: string): Promise<ExportRecord> {
    const record = this.db.exports.find((e) => e.export_id === exportId);
    if (!record) throw new ApiError('NOT_FOUND', '导出记录不存在', { status: 404 });
    const file = record.files.find((f) => f.filename === filename);
    if (file) file.exists = false;
    this.persist();
    return record;
  }

  async runtimeStatus(): Promise<RuntimeStatus> {
    return {
      app_id: 'GeoPlot',
      app_version: SOFTWARE_VERSION,
      profile_id: 'demo-profile',
      instance_id: 'demo-instance',
      pid: 0,
      process_started_at: new Date().toISOString(),
      state: 'running',
      base_url: 'http://127.0.0.1:5173',
      active_jobs: 0,
    };
  }

  artifactUrl(artifactId: string): string {
    return `#mock-artifact/${artifactId}`;
  }

  /** 演示控制：重置本地演示库（仅开发工具使用）。 */
  demoReset() {
    this.db = resetDb();
  }
}

export const MOCK_DATA_IDS = DATA_IDS;
