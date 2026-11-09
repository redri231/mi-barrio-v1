import { getApiUrl } from '@/features/auth/data/auth-api';

export type EmergencyAlert = { id: string; status: string; created_at: string; sender: string; channel: string; latitude?: number; longitude?: number };
export type OwnEmergencyAlert = { id: string; status: string; created_at: string };
export type Brigade = { id: string; specialty: string; full_name: string; tier: string };
export type EmergencyCoordinates = { latitude: number; longitude: number; accuracy_m: number; mocked: boolean };
export class EmergencyApiError extends Error {}

async function request<T>(path: string, token: string, method = 'GET', body?: object): Promise<T> {
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 12_000);
  let response: Response;
  try {
    response = await fetch(`${getApiUrl()}${path}`, { method, headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: controller.signal });
  } catch { clearTimeout(timeout); throw new EmergencyApiError('No pudimos conectar con el servidor. Usa los teléfonos de emergencia si necesitas ayuda inmediata.'); }
  clearTimeout(timeout);
  const payload = await response.json().catch(() => ({})) as { message?: string } & T;
  if (!response.ok) throw new EmergencyApiError(payload.message ?? 'No pudimos completar la solicitud de emergencia.');
  return payload;
}

export const emergencyApi = {
  nearby(token: string) { return request<{ alerts: EmergencyAlert[]; brigades: Brigade[] }>('/api/v1/emergency/nearby', token); },
  own(token: string) { return request<{ alert: OwnEmergencyAlert | null }>('/api/v1/emergency/me', token); },
  send(token: string, coordinates: EmergencyCoordinates) { return request<{ alert: EmergencyAlert; delivery: string; message: string }>('/api/v1/emergency/sos', token, 'POST', coordinates); },
  report(token: string, id: string) { return request<{ reported: boolean; reports: number; needs_review: boolean }>(`/api/v1/emergency/sos/${id}/reports`, token, 'POST', {}); },
  finish(token: string, id: string, action: 'resolve' | 'cancel') { return request<{ alert: EmergencyAlert }>(`/api/v1/emergency/sos/${id}/${action}`, token, 'POST', {}); },
};
