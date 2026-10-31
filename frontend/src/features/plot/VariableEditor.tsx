import { useMemo } from 'react';
import { useWorkspace } from '../../state/workspaceStore';
import type { Expression } from '../../lib/generated/types';
import { REE_ELEMENTS, SPIDER_ELEMENTS, TAS_OXIDES } from '../../lib/elements';
import {
  describeExpression,
  formatAnalyte,
  measurement,
  normalize,
  ratio,
  validateExpression,
  expressionKey,
} from '../../lib/expressions';

type BuilderMode = 'measurement' | 'normalize' | 'ratio' | 'ratio_norm' | 'add';

const EXTRA_ELEMENTS = ['Rb', 'Sr', 'Ba', 'Nb', 'Ta', 'Zr', 'Hf', 'Th', 'U', 'Y', 'Pb', 'Ni', 'Co', 'Cr', 'V', 'Sc'];

const ALL_ANALYTES = Array.from(new Set([...TAS_OXIDES, ...REE_ELEMENTS, ...SPIDER_ELEMENTS, ...EXTRA_ELEMENTS]));

function unitOf(analyte: string): string {
  return TAS_OXIDES.includes(analyte) ? 'wt%' : 'ppm';
}

function analyteOf(expr: Expression | null, index: 'numerator' | 'denominator' | 'value'): string {
  if (!expr) return '';
  if (expr.kind === 'measurement') return expr.analyte;
  if (expr.kind === 'normalize') return analyteOf(expr.value, 'value');
  if (expr.kind === 'ratio') return analyteOf(index === 'denominator' ? expr.denominator : expr.numerator, index === 'denominator' ? 'value' : 'numerator');
  if (expr.kind === 'add') return analyteOf(expr.operands[0] ?? null, 'value');
  return '';
}

function modeOf(expr: Expression | null): BuilderMode {
  if (!expr) return 'measurement';
  if (expr.kind === 'ratio') {
    return expr.numerator.kind === 'normalize' && expr.denominator.kind === 'normalize' ? 'ratio_norm' : 'ratio';
  }
  if (expr.kind === 'normalize') return 'normalize';
  if (expr.kind === 'add') return 'add';
  return 'measurement';
}

function buildExpression(mode: BuilderMode, a: string, b: string, refId: string | null, refVersion: string | null): Expression {
  const ma = measurement(a, unitOf(a));
  const mb = measurement(b, unitOf(b));
  switch (mode) {
    case 'ratio':
      return ratio(ma, mb);
    case 'normalize':
      return refId && refVersion ? normalize(ma, refId, refVersion) : ma;
    case 'ratio_norm':
      return refId && refVersion ? ratio(normalize(ma, refId, refVersion), normalize(mb, refId, refVersion)) : ratio(ma, mb);
    case 'add':
      return { kind: 'add', operands: [ma, mb] };
    default:
      return ma;
  }
}

function AnalyteSelect({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  return (
    <label style={{ flex: 1 }}>
      <span className="small muted">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} style={{ width: '100%' }}>
        {ALL_ANALYTES.map((analyte) => (
          <option key={analyte} value={analyte}>
            {formatAnalyte(analyte)}（{unitOf(analyte)}）
          </option>
        ))}
      </select>
    </label>
  );
}

function ExpressionBuilder({
  label,
  expr,
  onChange,
}: {
  label: string;
  expr: Expression | null;
  onChange: (expr: Expression) => void;
}) {
  const references = useWorkspace((s) => s.references);
  const referenceId = useWorkspace((s) => s.spec.variables.reference_id);
  const referenceVersion = useWorkspace((s) => s.spec.variables.reference_version);
  const setReferencePicker = useWorkspace((s) => s.setReferencePicker);
  const mode = modeOf(expr);
  const a = analyteOf(expr, 'numerator') || 'Rb';
  const b = analyteOf(expr, 'denominator') || 'Sr';
  const validation = validateExpression(expr);
  const ref = references.find((r) => r.ref_id === referenceId && r.version === referenceVersion) ?? null;
  const needsRef = mode === 'normalize' || mode === 'ratio_norm';
  const refMissing = needsRef && (!ref || !referenceId);

  return (
    <div className="card" style={{ padding: 10, marginBottom: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
        <strong className="t-12">{label}</strong>
        <button
          className="linklike"
          onClick={() => {
            const nextA = b;
            const nextB = a;
            onChange(buildExpression(mode, nextA, nextB, referenceId, referenceVersion));
          }}
          title="交换分子与分母"
        >
          对调
        </button>
      </div>
      <div className="field">
        <label>表达式类型</label>
        <select value={mode} onChange={(event) => onChange(buildExpression(event.target.value as BuilderMode, a, b, referenceId, referenceVersion))}>
          <option value="measurement">单元素测量</option>
          <option value="ratio">元素比值 A/B</option>
          <option value="normalize">标准化单元素 Eₙ</option>
          <option value="ratio_norm">标准化比值 (A/B)ₙ</option>
          <option value="add">同单位加法 A+B</option>
        </select>
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
        <AnalyteSelect label="A / 分子" value={a} onChange={(value) => onChange(buildExpression(mode, value, b, referenceId, referenceVersion))} />
        {mode !== 'measurement' && mode !== 'normalize' && (
          <AnalyteSelect label="B / 分母" value={b} onChange={(value) => onChange(buildExpression(mode, a, value, referenceId, referenceVersion))} />
        )}
      </div>
      {needsRef && (
        <div className="row" style={{ marginTop: 6, justifyContent: 'space-between' }}>
          <span className="small muted">参考：{ref ? `${ref.label} @${ref.version}` : '未选择'}</span>
          <button className="btn sm" onClick={() => setReferencePicker(true)}>选择参考组成…</button>
        </div>
      )}
      {refMissing && <div className="banner warn" style={{ marginTop: 6 }}>标准化模式的参考组成或版本缺失，Scene 将返回排除原因，而不是猜一个标准。</div>}
      {ref && needsRef && (
        <div className="small muted" style={{ marginTop: 4 }}>
          {[a, b].filter((element) => needsRef && !ref.values[element]).length > 0
            ? `参考未覆盖：${[a, b].filter((element) => !ref.values[element]).join('、')}`
            : '参考覆盖所选元素'}
        </div>
      )}
      <div className="mono small" style={{ marginTop: 6, color: 'var(--muted)' }}>
        {expr ? `${describeExpression(expr, ref?.label)} · ${expressionKey(expr).slice(0, 72)}` : '未选择变量'}
      </div>
      {!validation.ok && <div className="small" style={{ color: 'var(--err)', marginTop: 4 }}>{validation.error}</div>}
      <div className="small muted" style={{ marginTop: 4 }}>
        单位、比值、标准化与坐标全部由后端计算；前端只构造表达式 AST。
      </div>
    </div>
  );
}

function ReferenceRow() {
  const references = useWorkspace((s) => s.references);
  const referenceId = useWorkspace((s) => s.spec.variables.reference_id);
  const referenceVersion = useWorkspace((s) => s.spec.variables.reference_version);
  const setReferencePicker = useWorkspace((s) => s.setReferencePicker);
  const ref = references.find((r) => r.ref_id === referenceId && r.version === referenceVersion);
  return (
    <div className="field">
      <label>参考组成</label>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="small">{ref ? `${ref.label} @${ref.version}` : '未选择'}</span>
        <button className="btn sm" onClick={() => setReferencePicker(true)}>选择…</button>
      </div>
      {ref && (
        <div className="small muted">
          {ref.elements.length} 个元素 · {ref.is_custom ? '工作簿自定义' : ref.verification_status === 'verified' ? '已核实' : '待核实'}
        </div>
      )}
    </div>
  );
}

function ElementListEditor({ fixedOrder }: { fixedOrder: boolean }) {
  const elements = useWorkspace((s) => s.spec.variables.elements) ?? [];
  const setElements = useWorkspace((s) => s.setElements);
  const referenceId = useWorkspace((s) => s.spec.variables.reference_id);
  const referenceVersion = useWorkspace((s) => s.spec.variables.reference_version);
  const references = useWorkspace((s) => s.references);
  const ref = references.find((r) => r.ref_id === referenceId && r.version === referenceVersion);

  const move = (index: number, direction: -1 | 1) => {
    const next = [...elements];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setElements(next);
  };

  return (
    <div className="field">
      <label>元素序列（{elements.length}）</label>
      <div className="chip-list">
        {elements.map((element, index) => {
          const covered = !ref || Boolean(ref.values[element]);
          return (
            <span key={`${element}-${index}`} className={`chip ${covered ? '' : 'warn'}`} title={covered ? undefined : '参考组成未覆盖此元素，曲线将断开'}>
              {index + 1}. {formatAnalyte(element)}
              {!fixedOrder && (
                <>
                  <button className="chip-x" onClick={() => move(index, -1)} title="上移">↑</button>
                  <button className="chip-x" onClick={() => move(index, 1)} title="下移">↓</button>
                </>
              )}
              <button className="chip-x" onClick={() => setElements(elements.filter((_, i) => i !== index))} title="移除">×</button>
            </span>
          );
        })}
      </div>
      {ref && [ ...new Set(elements.filter((element) => !ref.values[element])) ].length > 0 && (
        <div className="small hint-warn" style={{ marginTop: 4 }}>
          标准不覆盖：{[...new Set(elements.filter((element) => !ref.values[element]))].join('、')}。曲线在该处断线，不插补。
        </div>
      )}
    </div>
  );
}

export function VariableEditor() {
  const chartType = useWorkspace((s) => s.chartType);
  const spec = useWorkspace((s) => s.spec);
  const setVariableX = useWorkspace((s) => s.setVariableX);
  const setVariableY = useWorkspace((s) => s.setVariableY);
  const setValueMode = useWorkspace((s) => s.setValueMode);
  const setQualityPolicy = useWorkspace((s) => s.setQualityPolicy);
  const setTasDiagram = useWorkspace((s) => s.setTasDiagram);
  const scene = useWorkspace((s) => s.scene);
  const setAxisPanel = useWorkspace((s) => s.setAxisPanel);

  const currentElements = useMemo(() => spec.variables.elements ?? [], [spec.variables.elements]);

  if (chartType === 'scatter') {
    return (
      <div>
        <ExpressionBuilder label="X 轴变量" expr={spec.variables.x} onChange={setVariableX} />
        <ExpressionBuilder label="Y 轴变量" expr={spec.variables.y} onChange={setVariableY} />
        <div className="row">
          <button className="btn sm" onClick={() => setAxisPanel({ axis: 'x' })}>X 轴格式…</button>
          <button className="btn sm" onClick={() => setAxisPanel({ axis: 'y' })}>Y 轴格式…</button>
        </div>
        <QualitySection policy={spec.quality_policy} onChange={setQualityPolicy} />
      </div>
    );
  }

  if (chartType === 'ree' || chartType === 'spider') {
    return (
      <div>
        <div className="field">
          <label>数值模式</label>
          <div className="segmented">
            <button className={spec.variables.value_mode === 'raw' ? 'active' : ''} onClick={() => setValueMode('raw')}>原始值</button>
            <button className={spec.variables.value_mode === 'normalized' ? 'active' : ''} onClick={() => setValueMode('normalized')}>标准化值</button>
          </div>
        </div>
        <ReferenceRow />
        <ElementListEditor fixedOrder={chartType === 'ree'} />
        <div className="row">
          <button
            className="btn sm"
            onClick={() => {
              const next = chartType === 'ree' ? [...REE_ELEMENTS] : [...SPIDER_ELEMENTS];
              useWorkspace.getState().setElements(next);
            }}
          >
            恢复默认序列
          </button>
          <button className="btn sm" onClick={() => setAxisPanel({ axis: 'y' })}>Y 轴格式…</button>
        </div>
        {chartType === 'ree' && currentElements.join(',') !== REE_ELEMENTS.join(',') && (
          <div className="banner warn" style={{ marginTop: 8 }}>
            REE 图使用固定 14 元素顺序；“恢复默认序列”可还原 La→Lu。
          </div>
        )}
        <div className="small muted" style={{ margin: 0, marginTop: 8 }}>
          当前 Scene：{scene ? `${scene.counts.plotted_points} 个点 / ${scene.series.length} 条曲线` : '尚未计算'}
        </div>
        <QualitySection policy={spec.quality_policy} onChange={setQualityPolicy} />
      </div>
    );
  }

  const diagram = spec.diagram;
  return (
    <div>
      <div className="banner info">
        TAS 仅作参考比较：x = SiO₂ (wt%)，y = Na₂O + K₂O (wt%)。矿物不进入 TAS，不自动宣布地球火山岩定名。
      </div>
      {!diagram ? (
        <div className="small muted">后端尚未提供 TAS 几何模型（diagram = null）。请在导入或模型配置完成后启用。</div>
      ) : (
        <>
          <div className="kv" style={{ marginBottom: 10 }}>
            <dt>模型</dt>
            <dd className="mono">{diagram.model_id} @{diagram.model_version}</dd>
            <dt>模式</dt>
            <dd>参考比较（reference）</dd>
            <dt>氧化物集合</dt>
            <dd>{diagram.oxide_set.join('、')}</dd>
          </div>
          <div className="field">
            <label>主量基准</label>
            <select
              value={diagram.oxide_basis}
              onChange={(event) => setTasDiagram({ ...diagram, oxide_basis: event.target.value as 'raw' | 'anhydrous_100' })}
            >
              <option value="raw">原始氧化物 wt%（不重算）</option>
              <option value="anhydrous_100">100% 无挥发分重算（需明确完整性与铁的处理）</option>
            </select>
          </div>
          <div className="field">
            <label>铁处理策略（后端模型参数名）</label>
            <input
              value={diagram.iron_policy ?? ''}
              placeholder="例如 all_fe_as_feot；留空表示不重算铁"
              onChange={(event) => setTasDiagram({ ...diagram, iron_policy: event.target.value.trim() || null })}
            />
            <div className="small muted">FeO/FeOT/Fe₂O₃ 不互换；重算须保留原子量版本与假设。</div>
          </div>
          {diagram.oxide_basis === 'anhydrous_100' && !diagram.iron_policy && (
            <div className="banner warn">100% 重算需要完整十项主量与明确的铁处理；当前未设置 iron_policy。</div>
          )}
        </>
      )}
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn sm" onClick={() => setAxisPanel({ axis: 'x' })}>X 轴格式…</button>
        <button className="btn sm" onClick={() => setAxisPanel({ axis: 'y' })}>Y 轴格式…</button>
      </div>
      <QualitySection policy={spec.quality_policy} onChange={setQualityPolicy} />
    </div>
  );
}

function QualitySection(props: {
  policy: { censored: 'exclude' | 'include'; nonpositive_log: 'exclude' | 'include'; missing_spider: 'gap' | 'drop'; unconfirmed_unit: 'exclude' | 'include' };
  onChange: (patch: Partial<{ censored: 'exclude' | 'include'; nonpositive_log: 'exclude' | 'include'; missing_spider: 'gap' | 'drop'; unconfirmed_unit: 'exclude' | 'include' }>) => void;
}) {
  const options = <T extends string>(values: T[], current: T, onChange: (value: T) => void) => (
    <div className="segmented">
      {values.map((value) => (
        <button key={value} className={current === value ? 'active' : ''} onClick={() => onChange(value)}>
          {zhOption(value)}
        </button>
      ))}
    </div>
  );
  return (
    <>
      <div className="divider" style={{ marginTop: 14 }} />
      <h4 className="t-12" style={{ margin: '0 0 8px' }}>质量策略</h4>
    <div className="field">
      <label>低于检出限 / 负值</label>
      {options(['exclude', 'include'] as const, props.policy.censored, (value) => props.onChange({ censored: value }))}
    </div>
    <div className="field">
      <label>对数轴非正值</label>
      {options(['exclude', 'include'] as const, props.policy.nonpositive_log, (value) => props.onChange({ nonpositive_log: value }))}
    </div>
    <div className="field">
      <label>蛛网缺元素</label>
      {options(['gap', 'drop'] as const, props.policy.missing_spider, (value) => props.onChange({ missing_spider: value }))}
    </div>
    <div className="field">
      <label>单位未确认</label>
      {options(['exclude', 'include'] as const, props.policy.unconfirmed_unit, (value) => props.onChange({ unconfirmed_unit: value }))}
    </div>
      <p className="small muted">默认排除删失值与非正值参与比值/标准化/对数；排除原因由 Scene 返回并显示。</p>
    </>
  );
}

function zhOption(value: string): string {
  switch (value) {
    case 'exclude': return '排除';
    case 'include': return '保留';
    case 'gap': return '断线';
    case 'drop': return '整条去除';
    default: return value;
  }
}
