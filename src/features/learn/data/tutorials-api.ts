import { getApiUrl } from '@/features/auth/data/auth-api';

export type RemoteTutorial = { id: string; title: string; duration: string; author: string; is_official_protocol: boolean; steps: unknown[]; saved: boolean };

async function request<T>(path: string, token: string, method = 'GET', body?: object): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  let response: Response;
  try {
    response = await fetch(`${getApiUrl()}${path}`, { method, headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: controller.signal });
  } catch {
    throw new Error('No pudimos conectar con el servidor de guías.');
  } finally { clearTimeout(timeout); }
  const result = await response.json().catch(() => ({})) as { message?: string } & T;
  if (!response.ok) throw new Error(result.message ?? 'No pudimos actualizar las guías.');
  return result;
}

export const tutorialsApi = {
  list(token: string) { return request<{ data: RemoteTutorial[] }>('/api/v1/tutorials', token); },
  create(token: string, data: { title: string; duration_minutes: number; steps: string[] }) { return request<{ tutorial: RemoteTutorial }>('/api/v1/tutorials', token, 'POST', data); },
  save(token: string, id: string, saved: boolean) { return request<{ saved: boolean }>(`/api/v1/tutorials/${id}/saved`, token, 'PUT', { saved }); },
};
