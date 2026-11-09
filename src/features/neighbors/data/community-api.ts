import { getApiUrl } from '@/features/auth/data/auth-api';

export type CommunityCoordinates = { latitude: number; longitude: number; accuracy_m: number; mocked: boolean };
export type SwapRecord = { id: string; kind: 'need' | 'offer'; title: string; details: string | null; urgent: boolean; author: string; distance_m: number; status?: string };
export type ToolRecord = { id: string; name: string; owner: string; owner_id: string; available: boolean };
export type ToolRequestRecord = { id: string; status: 'pending' | 'accepted' | 'returned'; borrower: string; requested_at: string };
export type PurchaseRecord = { id: string; organizer_id?: string; title: string; provider: string; savings: string; current: number; target: number; deadline: string; joined: boolean };

export class CommunityApiError extends Error {}

async function request<T>(path: string, token: string, method = 'GET', body?: object): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  let response: Response;
  try {
    response = await fetch(`${getApiUrl()}${path}`, {
      method,
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: controller.signal,
    });
  } catch {
    clearTimeout(timeout);
    throw new CommunityApiError('No pudimos conectar con el servidor. Revisa tu conexión.');
  }
  clearTimeout(timeout);
  const payload = await response.json().catch(() => ({})) as { message?: string } & T;
  if (!response.ok) throw new CommunityApiError(payload.message ?? 'No pudimos completar esta acción.');
  return payload;
}

export const communityApi = {
  swaps(token: string, coordinates: CommunityCoordinates, walkingOnly: boolean) {
    const query = new URLSearchParams({ ...Object.fromEntries(Object.entries(coordinates).map(([key, value]) => [key, String(value)])), walking_only: String(walkingOnly) });
    return request<{ data: SwapRecord[] }>(`/api/v1/community/swaps?${query}`, token);
  },
  createSwap(token: string, coordinates: CommunityCoordinates, data: { kind: 'need' | 'offer'; title: string; details: string; is_urgent: boolean }) {
    return request<{ swap: SwapRecord; warning?: string }>('/api/v1/community/swaps', token, 'POST', { ...coordinates, ...data });
  },
  interest(token: string, id: string) { return request<{ interested: boolean; contact_phone: string }>(`/api/v1/community/swaps/${id}/interest`, token, 'POST', {}); },
  reportSwap(token: string, id: string) { return request<{ reported: boolean }>(`/api/v1/community/swaps/${id}/reports`, token, 'POST', {}); },
  tools(token: string) { return request<{ data: ToolRecord[] }>('/api/v1/community/tools', token); },
  myToolRequests(token: string) { return request<{ data: { id: string; tool_id: string; status: string; name: string }[] }>('/api/v1/community/my-tool-requests', token); },
  createTool(token: string, coordinates: CommunityCoordinates, tool_name: string) { return request<{ tool: ToolRecord }>('/api/v1/community/tools', token, 'POST', { ...coordinates, tool_name }); },
  requestTool(token: string, id: string) { return request<{ request: { id: string } }>(`/api/v1/community/tools/${id}/requests`, token, 'POST', {}); },
  toolRequests(token: string, id: string) { return request<{ data: ToolRequestRecord[] }>(`/api/v1/community/tools/${id}/requests`, token); },
  updateToolRequest(token: string, id: string, status: 'accepted' | 'returned') { return request<{ id: string; status: string; available: boolean }>(`/api/v1/community/tool-requests/${id}`, token, 'PATCH', { status }); },
  purchases(token: string) { return request<{ data: PurchaseRecord[] }>('/api/v1/community/purchases', token); },
  createPurchase(token: string, data: { title: string; provider_name: string; savings_description: string; target_participants: number; deadline: string }) { return request<{ purchase: PurchaseRecord }>('/api/v1/community/purchases', token, 'POST', data); },
  membership(token: string, id: string, join: boolean) { return request<{ joined: boolean; current: number }>(`/api/v1/community/purchases/${id}/membership`, token, 'POST', { join }); },
};
