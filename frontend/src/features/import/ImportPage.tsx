import { useMemo, useRef, useState } from 'react';
import { useWorkspace } from '../../state/workspaceStore';
import { ApiError, pollJob, type CommitImportPayload } from '../../lib/api/client';
import type { ImportColumn, ImportPreview, ImportReport, ImportSheet } from '../../lib/generated/types';
import { REE_ELEMENTS } from '../../lib/elements';
import { formatAnalyte } from '../../lib/expressions';

type Stage = 'scan' | 'sheets' | 'map' | 'issues' | 'result';

const STEPS: Array<{ key: Stage; label: string }> = [
  { key: 'sheets', label: '1 选表' },
  { key: 'map', label: '2 映射' },
  { key: 'issues', label: '3 问题检查' },
  { key: 'result', label: '4 导入结果' },
];

const ROLE_LABEL: Record<ImportSheet['role'], string> = {
  samples: '样品数据表',
  reference: '参考组成',
  derived_view: '派生视图',
  ignored: '忽略',
};

const SEVERITY_LABEL: Record<string, string> = {
  blocker: '阻断',
  warning: '警告',
  info: '提示',
};

const TARGET_LABEL: Record<ImportColumn['target'], string> = {
  metadata: '元数据',
  measurement: '测量值',
  uncertainty: '不确定度',
  detection_limit: '检出限',
  ignored: '忽略',
};

export function ImportPage() {
  const client = useWorkspace((s) => s.client);
  const project = useWorkspace((s) => s.project);
  const catalog = useWorkspace((s) => s.catalog);
  const reload = useWorkspace((s) => s.reload);
  const toast = useWorkspace((s) => s.toast);
  const setPage = useWorkspace((s) => s.setPage);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const [stage, setStage] = useState<Stage>('scan');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [sheets, setSheets] = useState<ImportSheet[]>([]);
  const [columns, setColumns] = useState<ImportColumn[]>([]);
  const [decisions, setDecisions] = useState<Record<string, 'main' | 'derived_view' | 'independent'>>({});
  const [refColumns, setRefColumns] = useState<Record<string, { element: number; value: number }>>({});
  const [activeSheet, setActiveSheet] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ phase: string; processed: number; total: number } | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enabledSheets = sheets.filter((sheet) => sheet.enabled);
  const sheetColumns = useMemo(() => columns.filter((column) => column.sheet === activeSheet), [columns, activeSheet]);
  const issues = preview?.issues ?? [];
  const issueCounts = {
    blocker: issues.filter((issue) => issue.severity === 'blocker').length,
    warning: issues.filter((issue) => issue.severity === 'warning').length,
    info: issues.filter((issue) => issue.severity === 'info').length,
  };

  const reset = () => {
    setStage('scan');
    setFile(null);
    setPreview(null);
    setPreviewId(null);
    setSheets([]);
    setColumns([]);
    setDecisions({});
    setRefColumns({});
    setReport(null);
    setError(null);
    setProgress(null);
    setJobId(null);
  };

  const handleFile = async (picked: File) => {
    if (!client || !project) return;
    setError(null);
    setBusy(true);
    setFile(picked);
    try {
      const { job_id } = await client.scanImport(picked);
      setJobId(job_id);
      const done = await pollJob<{ preview_id: string }>(client, job_id, {
        timeoutMs: 180_000,
        onUpdate: (job) => setProgress({ phase: job.phase ?? '', processed: job.processed ?? 0, total: job.total ?? 0 }),
      });
      if (done.status !== 'succeeded' || !done.result?.preview_id) {
        throw new ApiError('SCAN_FAILED', done.error?.message ?? '扫描未产生预览');
      }
      const data = await client.getImportPreview(done.result.preview_id);
      setPreview(data);
      setPreviewId(data.preview_id);
      setSheets(data.sheets.map((sheet) => ({ ...sheet })));
      setColumns(data.columns.map((column) => ({ ...column })));
      setActiveSheet(data.sheets.find((sheet) => sheet.role === 'samples')?.sheet_name ?? data.sheets[0]?.sheet_name ?? '');
      const nextDecisions: Record<string, 'main' | 'derived_view' | 'independent'> = {};
      data.overlaps.forEach((overlap) => {
        nextDecisions[overlap.derived_sheet] = overlap.default_plot_source === 'derived' ? 'derived_view' : 'main';
      });
      setDecisions(nextDecisions);
      const nextRefs: Record<string, { element: number; value: number }> = {};
      data.sheets.filter((sheet) => sheet.role === 'reference').forEach((sheet) => {
        nextRefs[sheet.sheet_name] = { element: 0, value: 3 };
      });
      setRefColumns(nextRefs);
      setStage('sheets');
      if (data.overlaps.length > 0) {
        toast('info', `检测到 ${data.overlaps.length} 个重叠表，默认不重复增加独立点`);
      }
    } catch (err) {
      setError(err instanceof ApiError ? `${err.message}（${err.code}）` : (err as Error).message);
      setStage('scan');
    } finally {
      setBusy(false);
    }
  };

  const updateSheet = (name: string, patch: Partial<ImportSheet>) => {
    setSheets((prev) => prev.map((sheet) => (sheet.sheet_name === name ? { ...sheet, ...patch } : sheet)));
  };

  const updateColumn = (index: number, patch: Partial<ImportColumn>) => {
    setColumns((prev) => prev.map((column, i) => (i === index ? { ...column, ...patch } : column)));
  };

  const bulkConfirm = (sheetName: string) => {
    setColumns((prev) =>
      prev.map((column) => {
        if (column.sheet !== sheetName || column.target !== 'measurement') return column;
        const isOxide = column.analyte ? ['SiO2', 'TiO2', 'Al2O3', 'FeOT', 'MnO', 'MgO', 'CaO', 'Na2O', 'K2O', 'P2O5'].includes(column.analyte.toUpperCase()) : false;
        return { ...column, unit: column.unit ?? (isOxide ? 'wt%' : 'ppm'), confirmed: true, value_state: column.value_state === 'normalized' ? 'normalized' : 'raw_concentration' };
      }),
    );
    toast('info', `已批量确认 ${sheetName} 的测量列单位；未识别为氧化物的列按 ppm 建议`);
  };

  const goMap = () => {
    if (enabledSheets.length === 0) {
      setError('至少启用一个数据表。');
      return;
    }
    setError(null);
    setStage('map');
  };

  const goIssues = () => {
    const enabled = new Set(enabledSheets.map((sheet) => sheet.sheet_name));
    const missingUnit = columns.filter((column) => enabled.has(column.sheet) && column.target === 'measurement' && !column.unit);
    if (missingUnit.length > 0) {
      setError(`还有 ${missingUnit.length} 个测量列未设置单位。可以继续导入，但这些量不会参与涉及单位的计算。`);
    } else {
      setError(null);
    }
    setStage('issues');
  };

  const commit = async () => {
    if (!client || !previewId) return;
    setBusy(true);
    setError(null);
    const enabled = sheets.filter((sheet) => sheet.enabled);
    const payload: CommitImportPayload = {
      sheets: sheets.map((sheet) => ({ sheet_name: sheet.sheet_name, role: sheet.enabled ? sheet.role : 'ignored' })),
      mappings: columns
        .filter((column) => enabled.some((sheet) => sheet.sheet_name === column.sheet) && column.target !== 'ignored')
        .map((column) => ({
          sheet: column.sheet,
          column_index: column.column_index,
          target: column.target,
          analyte: column.analyte,
          chemical_form: column.chemical_form,
          unit: column.unit,
          value_state: column.value_state,
          channel: column.channel,
          confirmed: column.confirmed,
        })),
      reference_maps: enabled
        .filter((sheet) => sheet.role === 'reference')
        .flatMap((sheet) =>
          REE_ELEMENTS.map((element) => ({
            sheet: sheet.sheet_name,
            element,
            column_index: refColumns[sheet.sheet_name]?.element ?? 0,
            value_column_index: refColumns[sheet.sheet_name]?.value ?? 3,
          })),
        ),
      duplicate_decisions: (preview?.overlaps ?? []).map((overlap) => ({
        sheet: overlap.derived_sheet,
        decision: decisions[overlap.derived_sheet] ?? 'main',
      })),
      dataset_versions: enabled
        .filter((sheet) => sheet.suggested_dataset_id)
        .map((sheet) => ({ dataset_id: sheet.suggested_dataset_id as string, version: '1' })),
    };
    try {
      const { job_id } = await client.commitImport(previewId, payload);
      setJobId(job_id);
      const done = await pollJob<ImportReport>(client, job_id, {
        timeoutMs: 300_000,
        onUpdate: (job) => setProgress({ phase: job.phase ?? '', processed: job.processed ?? 0, total: job.total ?? 0 }),
      });
      if (done.status !== 'succeeded' || !done.result) {
        throw new ApiError('IMPORT_FAILED', done.error?.message ?? '导入任务未成功');
      }
      setReport(done.result);
      setStage('result');
      await reload();
      toast('success', `导入完成：${done.result.datasets.length} 个数据集`);
    } catch (err) {
      setError(err instanceof ApiError ? `${err.message}（${err.code}）` : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const cancelJob = async () => {
    if (!client || !jobId) return;
    try {
      await client.cancelJob(jobId);
      toast('info', '已取消后台任务；不会产生半完成数据集');
      reset();
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };

  const attach = async (dataId: string) => {
    if (!client || !project) return;
    try {
      await client.attachCatalog(dataId, project.project_id);
      await reload();
      toast('success', '内置数据已挂载；无需重复上传');
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };

  return (
    <>
      <div className="toolbar">
        <button className="btn" onClick={() => setPage('workspace')}>返回工作台</button>
        <span className="divider" />
        <div className="stepper">
          {STEPS.map((step) => (
            <span key={step.key} className={`step ${stage === step.key ? 'active' : ''}`}>
              {step.label}
            </span>
          ))}
        </div>
        <div className="grow" />
        {file && <span className="small muted">{file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB</span>}
        {preview && <span className="chip mono">SHA-256 {preview.sha256.slice(0, 12)}…</span>}
      </div>

      <div className="page-scroll">
        {error && (
          <div className="banner err" style={{ marginBottom: 12 }}>
            {error}
            <button className="linklike" style={{ marginLeft: 8 }} onClick={() => setError(null)}>关闭</button>
          </div>
        )}

        {stage === 'scan' && (
          <div className="split-2">
            <div>
              <h2 style={{ marginTop: 0 }}>上传工作簿</h2>
              <p className="muted">
                支持 .xlsx 多表工作簿与已定义 CSV；拒绝 <span className="mono">~$</span> 锁文件与超过 100 MB 的文件。
                解析在后台任务中执行，可取消且不产生半完成数据集。
              </p>
              <div
                className="dropzone"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const dropped = event.dataTransfer.files?.[0];
                  if (dropped) void handleFile(dropped);
                }}
                onClick={() => inputRef.current?.click()}
              >
                <div className="big">{busy ? '正在扫描…' : '点击选择，或拖拽 .xlsx 文件到这里'}</div>
                <div className="small muted">原始文件只读；清洗结果另存运行时数据</div>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".xlsx,.csv"
                  style={{ display: 'none' }}
                  onChange={(event) => {
                    const picked = event.target.files?.[0];
                    if (picked) void handleFile(picked);
                  }}
                />
              </div>
              {progress && (
                <div className="progress" style={{ marginTop: 10 }}>
                  <div className="progress-track">
                    <div className="bar" style={{ transform: `scaleX(${(progress.total ? Math.min(100, (progress.processed / progress.total) * 100) : 5) / 100})` }} />
                  </div>
                  <span className="small muted">
                    {progress.phase} · {progress.processed.toLocaleString()} / {progress.total.toLocaleString()}
                  </span>
                  <button className="btn sm" onClick={() => void cancelJob()} disabled={!jobId}>取消任务</button>
                </div>
              )}
            </div>

            <div>
              <h3 style={{ marginTop: 0 }}>内置数据库</h3>
              <p className="small muted">六个内置目录一次登记，已有数据无需重复上传。挂载后可跨页筛选与勾选。</p>
              {catalog.map((entry) => (
                <div key={entry.data_id} className="card" style={{ padding: 9, marginBottom: 6 }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <strong className="t-12">{entry.label}</strong>
                    <span className={`chip ${entry.role === 'derived_view' ? 'warn' : entry.role === 'literature' ? '' : 'ok'}`}>
                      {ROLE_LABEL[entry.role === 'derived_view' ? 'derived_view' : entry.role === 'literature' ? 'samples' : 'samples']}
                    </span>
                  </div>
                  <div className="small muted">
                    {entry.sheet} · 基线 {entry.record_baseline.toLocaleString()} 条 · {entry.note}
                  </div>
                  <div className="row" style={{ marginTop: 4, justifyContent: 'space-between' }}>
                    <span className="small muted">
                      {entry.attached ? `已挂载 ${entry.version ?? ''}` : '未挂载'}
                      {entry.unit_confirmation_pending > 0 && ` · ${entry.unit_confirmation_pending} 个单位待确认`}
                    </span>
                    {!entry.attached && (
                      <button className="btn sm" onClick={() => void attach(entry.data_id)}>挂载</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {stage === 'sheets' && preview && (
          <>
            <h2 style={{ marginTop: 0 }}>选表与角色</h2>
            <p className="muted">
              多表可同时导入。Normalization value 建议为参考组成；trace 表建议为派生视图，避免与主表重复计为独立点。
            </p>
            <table className="table-simple">
              <thead>
                <tr>
                  <th>启用</th>
                  <th>工作表</th>
                  <th className="num">行</th>
                  <th className="num">列</th>
                  <th>建议角色</th>
                  <th>导入角色</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                {sheets.map((sheet) => (
                  <tr key={sheet.sheet_name}>
                    <td>
                      <input type="checkbox" checked={sheet.enabled} onChange={(event) => updateSheet(sheet.sheet_name, { enabled: event.target.checked })} />
                    </td>
                    <td className="mono">{sheet.sheet_name}</td>
                    <td className="num">{sheet.rows.toLocaleString()}</td>
                    <td className="num">{sheet.columns}</td>
                    <td>{ROLE_LABEL[sheet.suggested_role]}</td>
                    <td>
                      <select value={sheet.role} disabled={!sheet.enabled} onChange={(event) => updateSheet(sheet.sheet_name, { role: event.target.value as ImportSheet['role'] })}>
                        {Object.entries(ROLE_LABEL).map(([key, label]) => (
                          <option key={key} value={key}>{label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="small muted">
                      {sheet.role === 'derived_view' && '与主表重叠的部分不额外增加独立点'}
                      {sheet.role === 'reference' && '只作参考值，不作为样品投图'}
                      {sheet.suggested_dataset_id && <span className="mono"> · {sheet.suggested_dataset_id}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn" onClick={reset}>重新选择文件</button>
              <div className="grow" />
              <button className="btn primary" onClick={goMap}>下一步：字段映射</button>
            </div>
          </>
        )}

        {stage === 'map' && preview && (
          <>
            <h2 style={{ marginTop: 0 }}>字段与单位映射</h2>
            <div className="banner info">
              元素、氧化物、同位素通道与误差列是不同量。未知单位只阻止相关量参与计算，不阻止其他明确字段入库。
            </div>
            <div className="row" style={{ margin: '8px 0' }}>
              {enabledSheets.map((sheet) => (
                <button key={sheet.sheet_name} className={`tab-pill ${activeSheet === sheet.sheet_name ? 'active' : ''}`} onClick={() => setActiveSheet(sheet.sheet_name)}>
                  {sheet.sheet_name}（{columns.filter((c) => c.sheet === sheet.sheet_name).length} 列）
                </button>
              ))}
              <div className="grow" />
              <button className="btn sm" onClick={() => bulkConfirm(activeSheet)}>批量确认本表测量列为 ppm</button>
            </div>

            <div className="reference-table-scroll" style={{ maxHeight: 330 }}>
              <table className="table-simple">
                <thead>
                  <tr>
                    <th>列</th>
                    <th>原表头</th>
                    <th>导入目标</th>
                    <th>元素/量</th>
                    <th>化学形式</th>
                    <th>单位</th>
                    <th>数值状态</th>
                    <th>通道</th>
                    <th>已确认</th>
                    <th>重复列</th>
                  </tr>
                </thead>
                <tbody>
                  {sheetColumns.map((column) => {
                    const index = columns.indexOf(column);
                    const isMeasurement = column.target === 'measurement';
                    return (
                      <tr key={`${column.sheet}-${column.column_index}`}>
                        <td className="mono">{column.column_letter}</td>
                        <td className="mono small" title={column.header_raw}>{column.header_raw || '（空表头）'}</td>
                        <td>
                          <select value={column.target} onChange={(event) => updateColumn(index, { target: event.target.value as ImportColumn['target'] })}>
                            {Object.entries(TARGET_LABEL).map(([key, label]) => (
                              <option key={key} value={key}>{label}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            value={column.analyte ?? ''}
                            disabled={!isMeasurement}
                            onChange={(event) => updateColumn(index, { analyte: event.target.value || null })}
                            style={{ width: 78 }}
                          />
                        </td>
                        <td>
                          <select
                            value={column.chemical_form ?? ''}
                            disabled={!isMeasurement}
                            onChange={(event) => updateColumn(index, { chemical_form: (event.target.value || null) as ImportColumn['chemical_form'] })}
                          >
                            <option value="">—</option>
                            <option value="element">元素</option>
                            <option value="oxide">氧化物</option>
                            <option value="isotope_ratio">同位素比值</option>
                            <option value="index">指数</option>
                          </select>
                        </td>
                        <td>
                          <input
                            value={column.unit ?? ''}
                            disabled={!isMeasurement}
                            onChange={(event) => updateColumn(index, { unit: event.target.value || null })}
                            style={{ width: 58 }}
                          />
                        </td>
                        <td>
                          <select value={column.value_state} onChange={(event) => updateColumn(index, { value_state: event.target.value })}>
                            <option value="raw_concentration">原始浓度</option>
                            <option value="normalized">已标准化</option>
                            <option value="derived_ratio">来源比值</option>
                            <option value="source_index">来源指数</option>
                            <option value="uncertainty">不确定度</option>
                            <option value="detection_limit">检出限</option>
                            <option value="metadata">元数据</option>
                          </select>
                        </td>
                        <td>
                          <input
                            value={column.channel ?? ''}
                            disabled={!isMeasurement}
                            onChange={(event) => updateColumn(index, { channel: event.target.value || null })}
                            style={{ width: 92 }}
                          />
                        </td>
                        <td>
                          <input type="checkbox" checked={column.confirmed} disabled={!isMeasurement} onChange={(event) => updateColumn(index, { confirmed: event.target.checked })} />
                        </td>
                        <td className="small">
                          {column.duplicate_of != null ? <span className="chip warn">与 {column.duplicate_of} 列重复</span> : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <h3 style={{ marginTop: 14 }}>前几行预览</h3>
            <div className="reference-table-scroll" style={{ maxHeight: 200 }}>
              <table className="table-simple">
                <thead>
                  <tr>
                    {preview.head_rows[0]?.map((header, index) => (
                      <th key={index} className="mono small">{header || `列${index + 1}`}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.head_rows.slice(1, 8).map((row, r) => (
                    <tr key={r}>
                      {row.map((cell, c) => (
                        <td key={c} className="small">{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn" onClick={() => setStage('sheets')}>上一步</button>
              <div className="grow" />
              <button className="btn primary" onClick={goIssues}>下一步：问题检查</button>
            </div>
          </>
        )}

        {stage === 'issues' && preview && (
          <>
            <h2 style={{ marginTop: 0 }}>问题检查</h2>
            <div className="row" style={{ marginBottom: 10 }}>
              <span className="chip err">阻断 {issueCounts.blocker}</span>
              <span className="chip warn">警告 {issueCounts.warning}</span>
              <span className="chip">提示 {issueCounts.info}</span>
              <div className="grow" />
              <span className="small muted">空白、Excel 错误、缺名与重叠都保留来源；不静默丢弃或填充。</span>
            </div>

            <div className="reference-table-scroll" style={{ maxHeight: 260, marginBottom: 12 }}>
              <table className="table-simple">
                <thead>
                  <tr>
                    <th>级别</th>
                    <th>类型</th>
                    <th>位置</th>
                    <th>说明</th>
                    <th className="num">数量</th>
                  </tr>
                </thead>
                <tbody>
                  {issues.map((issue) => (
                    <tr key={issue.issue_id}>
                      <td><span className={`chip ${issue.severity === 'blocker' ? 'err' : issue.severity === 'warning' ? 'warn' : ''}`}>{SEVERITY_LABEL[issue.severity]}</span></td>
                      <td className="small">{issue.kind}</td>
                      <td className="mono small">
                        {issue.sheet}
                        {issue.row != null && `!${issue.row}`}
                        {issue.column_letter && `:${issue.column_letter}`}
                      </td>
                      <td className="small">{issue.message}</td>
                      <td className="num">{issue.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {(preview.overlaps ?? []).length > 0 && (
              <>
                <h3 style={{ marginTop: 0 }}>重叠表处理</h3>
                {(preview.overlaps ?? []).map((overlap) => (
                  <div key={overlap.derived_sheet} className="card" style={{ padding: 10, marginBottom: 8 }}>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <strong className="t-12">{overlap.derived_sheet} ↔ {overlap.main_sheet}</strong>
                      <span className="chip">{overlap.matched_rows} 行匹配 · {overlap.multi_candidate_rows} 行多候选</span>
                    </div>
                    <div className="small muted" style={{ margin: '4px 0' }}>{overlap.note}</div>
                    <select
                      value={decisions[overlap.derived_sheet] ?? 'main'}
                      onChange={(event) => setDecisions({ ...decisions, [overlap.derived_sheet]: event.target.value as 'main' | 'derived_view' | 'independent' })}
                    >
                      <option value="main">作为主表记录（派生表不额外加点）</option>
                      <option value="derived_view">作为派生视图（提供标准化/筛选，不独立计 n）</option>
                      <option value="independent">作为独立分析（需确认身份不重复）</option>
                    </select>
                    {decisions[overlap.derived_sheet] === 'independent' && (
                      <div className="banner warn" style={{ marginTop: 6 }}>选择独立分析会增加 n；请确认这些行不是同一测点的重复来源。</div>
                    )}
                  </div>
                ))}
              </>
            )}

            {enabledSheets.filter((sheet) => sheet.role === 'reference').map((sheet) => (
              <div key={sheet.sheet_name} className="card" style={{ padding: 10, marginBottom: 8 }}>
                <strong className="t-12">参考值列映射：{sheet.sheet_name}</strong>
                <div className="row" style={{ marginTop: 6 }}>
                  <label>
                    <span className="small muted">元素名所在列（0=A）</span>
                    <input
                      type="number"
                      min={0}
                      value={refColumns[sheet.sheet_name]?.element ?? 0}
                      onChange={(event) => setRefColumns({ ...refColumns, [sheet.sheet_name]: { element: Number(event.target.value), value: refColumns[sheet.sheet_name]?.value ?? 3 } })}
                    />
                  </label>
                  <label>
                    <span className="small muted">数值所在列（0=A）</span>
                    <input
                      type="number"
                      min={0}
                      value={refColumns[sheet.sheet_name]?.value ?? 3}
                      onChange={(event) => setRefColumns({ ...refColumns, [sheet.sheet_name]: { element: refColumns[sheet.sheet_name]?.element ?? 0, value: Number(event.target.value) } })}
                    />
                  </label>
                </div>
                <div className="small muted">
                  覆盖元素：{REE_ELEMENTS.map(formatAnalyte).join('、')}。工作簿自定义参考只能标为出处待确认，不能自动当成作者 CI 标准。
                </div>
              </div>
            ))}

            {progress && (
              <div className="progress">
                <div className="progress-track">
                  <div className="bar" style={{ transform: `scaleX(${(progress.total ? Math.min(100, (progress.processed / progress.total) * 100) : 5) / 100})` }} />
                </div>
                <span className="small muted">{progress.phase} · {progress.processed} / {progress.total}</span>
              </div>
            )}

            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn" onClick={() => setStage('map')}>上一步</button>
              <div className="grow" />
              <button className="btn primary" disabled={busy || enabledSheets.length === 0} onClick={() => void commit()}>
                {busy ? '导入中…' : '确认并导入'}
              </button>
            </div>
          </>
        )}

        {stage === 'result' && report && (
          <>
            <h2 style={{ marginTop: 0 }}>导入结果</h2>
            <div className="banner ok">导入完成。数据已写入运行时数据；原始工作簿未被修改。</div>
            <h3>数据集</h3>
            <table className="table-simple">
              <thead>
                <tr>
                  <th>数据集</th>
                  <th>版本</th>
                  <th>角色</th>
                  <th className="num">物理行</th>
                  <th className="num">接受分析</th>
                  <th className="num">隔离</th>
                  <th className="num">跳过</th>
                  <th className="num">关联派生</th>
                </tr>
              </thead>
              <tbody>
                {report.datasets.map((dataset) => (
                  <tr key={`${dataset.dataset_id}@${dataset.version}`}>
                    <td>{dataset.label}<div className="mono small muted">{dataset.dataset_id}</div></td>
                    <td>{dataset.version}</td>
                    <td>{dataset.role}</td>
                    <td className="num">{dataset.counts.physical_rows}</td>
                    <td className="num">{dataset.counts.accepted_analyses}</td>
                    <td className="num">{dataset.counts.quarantined_rows}</td>
                    <td className="num">{dataset.counts.skipped_rows}</td>
                    <td className="num">{dataset.counts.linked_derived_rows}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3>逐表报告</h3>
            <table className="table-simple">
              <thead>
                <tr>
                  <th>工作表</th>
                  <th className="num">物理行</th>
                  <th className="num">接受</th>
                  <th className="num">隔离</th>
                  <th className="num">跳过</th>
                  <th className="num">关联派生</th>
                  <th>单位建议</th>
                </tr>
              </thead>
              <tbody>
                {report.report.map((row) => (
                  <tr key={row.sheet}>
                    <td className="mono">{row.sheet}</td>
                    <td className="num">{row.physical_rows}</td>
                    <td className="num">{row.accepted}</td>
                    <td className="num">{row.quarantined}</td>
                    <td className="num">{row.skipped}</td>
                    <td className="num">{row.linked_derived}</td>
                    <td className="small">
                      {row.unit_proposals.map((proposal) => `${proposal.group}=${proposal.unit}(${proposal.state === 'confirmed' ? '已确认' : '建议'})`).join('；') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn" onClick={reset}>继续导入其他文件</button>
              <div className="grow" />
              <button className="btn primary" onClick={() => setPage('workspace')}>进入工作台</button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
