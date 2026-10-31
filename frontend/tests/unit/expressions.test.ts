import { describe, expect, it } from 'vitest';
import type { Expression } from '../../src/lib/generated/types';
import {
  MARKER_SHAPES,
  alphaToUiTransparency,
  describeExpression,
  expressionKey,
  measurement,
  normalize,
  ratio,
  uiTransparencyToAlpha,
  validateExpression,
} from '../../src/lib/expressions';

describe('表达式构造与展示', () => {
  it('元素比值可读且 key 稳定', () => {
    const expr = ratio(measurement('Rb', 'ppm'), measurement('Sr', 'ppm'));
    expect(describeExpression(expr)).toBe('Rb (ppm)/Sr (ppm)');
    expect(expressionKey(expr)).toBe('r(m:Rb:ppm:element:/m:Sr:ppm:element:)');
  });

  it('标准化比值带上参考标签', () => {
    const expr = ratio(
      normalize(measurement('La', 'ppm'), 'Chondrite_MS95', '1'),
      normalize(measurement('Yb', 'ppm'), 'Chondrite_MS95', '1'),
    );
    expect(describeExpression(expr, 'Chondrite_MS95@1')).toBe('(La/Yb)ₙ (Chondrite_MS95@1)');
  });
});

describe('表达式校验', () => {
  it('缺少参考版本时拒绝', () => {
    const bad = { kind: 'normalize', value: measurement('La', 'ppm'), reference_id: '', reference_version: '' } as const;
    const result = validateExpression(bad);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('参考组成版本');
  });

  it('单操作数加法被拒绝', () => {
    const bad: Expression = { kind: 'add', operands: [measurement('La', 'ppm')] };
    expect(validateExpression(bad).ok).toBe(false);
  });

  it('缺元素或单位的测量被拒绝', () => {
    const bad = { kind: 'measurement', analyte: '', chemical_form: 'element', unit: '', channel: null } as const;
    expect(validateExpression(bad).ok).toBe(false);
  });

  it('正常二元比值通过并统计节点', () => {
    const ok = ratio(measurement('Rb', 'ppm'), measurement('Sr', 'ppm'));
    const result = validateExpression(ok);
    expect(result.ok).toBe(true);
    expect(result.nodes).toBe(3);
    expect(result.error).toBeNull();
  });
});

describe('透明度语义（UI 0%=不透明，100%=完全透明）', () => {
  it('UI 透明度反转为内部 alpha，且往返一致', () => {
    expect(uiTransparencyToAlpha(0)).toBe(1);
    expect(uiTransparencyToAlpha(100)).toBe(0);
    expect(uiTransparencyToAlpha(35)).toBeCloseTo(0.65, 3);
    expect(alphaToUiTransparency(1)).toBe(0);
    expect(alphaToUiTransparency(0)).toBe(100);
    expect(alphaToUiTransparency(0.65)).toBe(35);
  });
});

describe('9 种标记形状', () => {
  it('形状数量为 9 且取值唯一', () => {
    expect(MARKER_SHAPES).toHaveLength(9);
    expect(new Set(MARKER_SHAPES.map((s) => s.value)).size).toBe(9);
  });
});
