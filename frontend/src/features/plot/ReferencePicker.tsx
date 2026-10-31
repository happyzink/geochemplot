import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { useWorkspace } from '../../state/workspaceStore';

/** 选择标准化参考组成；只写入 reference_id/version，数值由后端快照。 */
export function ReferencePicker() {
  const open = useWorkspace((s) => s.referencePickerOpen);
  const setReferencePicker = useWorkspace((s) => s.setReferencePicker);
  const references = useWorkspace((s) => s.references);
  const spec = useWorkspace((s) => s.spec);
  const setReference = useWorkspace((s) => s.setReference);
  const toast = useWorkspace((s) => s.toast);

  const [refId, setRefId] = useState(spec.variables.reference_id ?? references[0]?.ref_id ?? '');
  const [version, setVersion] = useState(spec.variables.reference_version ?? references[0]?.version ?? '1');

  if (!open) return null;

  const close = () => setReferencePicker(false);
  const current = references.find((ref) => ref.ref_id === refId && ref.version === version);
  const selectedElements = spec.variables.elements ?? [];

  const apply = () => {
    if (!current) {
      toast('error', '请选择一个参考组成版本');
      return;
    }
    setReference(current.ref_id, current.version);
    close();
    toast('success', `已使用参考组成 ${current.label}；后端将记录数值快照`);
  };

  return (
    <Modal
      title="参考组成"
      subtitle="标准化值与参考数值都由后端计算并写入 Scene 快照；前端不复制参考值"
      width="wide"
      onClose={close}
      footer={
        <>
          <span className="small muted">当前覆盖 {selectedElements.length} 个元素</span>
          <span className="spacer" />
          <button className="btn" onClick={close}>
            取消
          </button>
          <button className="btn primary" onClick={apply} disabled={!current}>
            使用该参考组成
          </button>
        </>
      }
    >
      <div className="reference-table-scroll">
        <table className="table-simple">
          <thead>
            <tr>
              <th>选择</th>
              <th>参考组成</th>
              <th>版本</th>
              <th>元素</th>
              <th>核实状态</th>
              <th>引用</th>
            </tr>
          </thead>
          <tbody>
            {references.map((ref) => {
              const checked = ref.ref_id === refId && ref.version === version;
              const covered = selectedElements.filter((element) => ref.elements.includes(element)).length;
              return (
                <tr key={`${ref.ref_id}@${ref.version}`} onClick={() => { setRefId(ref.ref_id); setVersion(ref.version); }}>
                  <td>
                    <input type="radio" checked={checked} onChange={() => { setRefId(ref.ref_id); setVersion(ref.version); }} />
                  </td>
                  <td>
                    <div>
                      <strong>{ref.label}</strong> {ref.is_custom && <span className="chip warn">自定义</span>}
                    </div>
                    <div className="small muted mono">{ref.ref_id}</div>
                  </td>
                  <td className="mono">{ref.version}</td>
                  <td className="small">
                    覆盖 {covered}/{selectedElements.length}
                    {ref.elements.length > 0 && <div className="muted">{ref.elements.join('、')}</div>}
                  </td>
                  <td className="small">{ref.verification_status}</td>
                  <td className="small muted">{ref.citation}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {current && (
        <div style={{ marginTop: 10 }}>
          <div className="small muted">参考组成说明</div>
          <p className="small">{current.note}</p>
          <div className="small muted">
            快照哈希 <span className="mono">{current.hash}</span> · 使用单位{' '}
            {typeof current.units === 'string' ? current.units : '按元素 ppm'}
          </div>
        </div>
      )}
    </Modal>
  );
}
