import { afterEach, describe, expect, it, vi } from 'vitest';
import { isDemoRequested, resolveClient } from '../../src/lib/api/index';
import { MockApiClient } from '../../src/lib/mock/mockApi';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('客户端解析：禁止自动降级 mock（TR01）', () => {
  it('只有显式 ?demo=1 才进入演示模式', async () => {
    expect(isDemoRequested('?demo=1')).toBe(true);
    expect(isDemoRequested('?demo=0')).toBe(false);
    expect(isDemoRequested('')).toBe(false);

    const resolution = await resolveClient('?demo=1');
    expect(resolution.mode).toBe('mock');
    expect(resolution.client).toBeInstanceOf(MockApiClient);
    expect(resolution.reason).toContain('显式');
  });

  it('服务不可达时保持 live，不使用演示数据', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));
    const resolution = await resolveClient('');
    expect(resolution.mode).toBe('live');
    expect(resolution.client).not.toBeInstanceOf(MockApiClient);
    expect(resolution.reason).toContain('不使用演示数据');
  });

  it('服务通告 1.1 时保持 live 并说明合同未就绪', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/health')) {
        return new Response(JSON.stringify({ status: 'ok', schema_version: '1.1' }), { status: 200 });
      }
      return new Response(JSON.stringify({ paths: {} }), { status: 200 });
    }));
    const resolution = await resolveClient('');
    expect(resolution.mode).toBe('live');
    expect(resolution.reason).toContain('1.1');
    expect(resolution.reason).toContain('1.2');
    expect(resolution.client).not.toBeInstanceOf(MockApiClient);
  });

  it('缺端点时保持 live 并列出缺项，不换 mock', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/health')) {
        return new Response(JSON.stringify({ status: 'ok', schema_version: '1.2' }), { status: 200 });
      }
      return new Response(JSON.stringify({ paths: { '/api/v1/plots/compute': { post: {} } } }), { status: 200 });
    }));
    const resolution = await resolveClient('');
    expect(resolution.mode).toBe('live');
    expect(resolution.reason).toMatch(/缺少/);
    expect(resolution.client).not.toBeInstanceOf(MockApiClient);
  });
});
