/**
 * 客户端解析：显式演示模式或真实服务，绝不自动降级。
 *
 * - URL 带 ?demo=1：用户显式进入演示模式（E2E 与离线展示使用）。
 * - 其他情况一律使用真实客户端：服务不可达、schema 未到 1.2、缺端点时
 *   由界面显示错误并保留草稿，不偷偷换成 mock 数据（18 §5 TR01）。
 */

import { EXPECTED_SCENE_VERSION, HttpApiClient, probeBackend } from './http';
import { MockApiClient } from '../mock/mockApi';
import type { ApiClient } from './client';

export type ClientMode = 'mock' | 'live';

export interface ClientResolution {
  client: ApiClient;
  mode: ClientMode;
  reason: string;
}

export function isDemoRequested(search: string = window.location.search): boolean {
  return new URLSearchParams(search).get('demo') === '1';
}

export async function resolveClient(search: string = window.location.search): Promise<ClientResolution> {
  if (isDemoRequested(search)) {
    return {
      client: new MockApiClient(),
      mode: 'mock',
      reason: 'URL 显式 demo=1：使用合同 fixture 合成数据，不写盘、不调用后端；导出文件名带 DEMO 标记。',
    };
  }
  const probe = await probeBackend();
  if (!probe.reachable) {
    return {
      client: new HttpApiClient(),
      mode: 'live',
      reason: '未检测到本地 GeoPlot 服务。已保持真实模式，不使用演示数据；请启动服务后刷新。',
    };
  }
  if (!probe.schemaOk) {
    return {
      client: new HttpApiClient(),
      mode: 'live',
      reason: `本地服务在线，但通告 schema_version=${probe.schemaVersion ?? '未知'}，合同要求 ${EXPECTED_SCENE_VERSION}。请等 Qoder 重签合同；页面不会改用演示数据。`,
    };
  }
  if (probe.missing.length > 0) {
    const examples = probe.missing.slice(0, 3).join('、');
    return {
      client: new HttpApiClient(),
      mode: 'live',
      reason: `本地服务在线，但缺少 ${probe.missing.length} 个前端必需端点（如 ${examples}）。清单见 TRAE_CONTRACT_REQUESTS.md R4；不会改用演示数据。`,
    };
  }
  return {
    client: new HttpApiClient(),
    mode: 'live',
    reason: '已连接本地 GeoPlot 服务（/api/v1），全部必需端点可用。',
  };
}
