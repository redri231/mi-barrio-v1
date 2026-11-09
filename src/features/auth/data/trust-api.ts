import { getApiUrl } from './auth-api';

export type TrustStatus = { vouches_received: number; residency_verification: { status: string; submitted_at: string } | null };

async function request<T>(path: string, token: string, method = 'GET', body?: object): Promise<T> {
  const response = await fetch(`${getApiUrl()}${path}`, { method, headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json().catch(() => ({})) as { message?: string } & T;
  if (!response.ok) throw new Error(result.message ?? 'No pudimos completar la verificación.');
  return result;
}

export const trustApi = {
  status(token: string) { return request<TrustStatus>('/api/v1/profile/me/trust-status', token); },
  requestResidency(token: string, coordinates: { latitude: number; longitude: number; accuracy_m: number; mocked: boolean }) {
    return request<{ message: string; verification: NonNullable<TrustStatus['residency_verification']> }>('/api/v1/profile/me/residency-verifications/gps', token, 'POST', coordinates);
  },
  vouch(token: string, userId: string) { return request<{ vouched: boolean; vouches_received: number }>(`/api/v1/users/${userId}/vouches`, token, 'POST', {}); },
};
