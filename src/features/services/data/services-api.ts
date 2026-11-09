import { getApiUrl } from '@/features/auth/data/auth-api';

export type ServiceCategory = 'gasfiteria' | 'electricidad' | 'cerrajeria' | 'mascotas' | 'clases' | 'tiendas' | 'otros';
export type ServiceItem = {
  id: string;
  provider_name: string;
  provider_tier: 'level_1_basic' | 'level_2_verified' | 'level_3_provider_brigade';
  title: string;
  category: ServiceCategory;
  recommendations: number;
  created_at: string;
  distance_m: number;
};
export type ServiceDetails = Omit<ServiceItem, 'distance_m'> & { description: string | null; contact_phone: string };
export type ManagedService = Omit<ServiceItem, 'distance_m' | 'provider_name' | 'provider_tier' | 'created_at'> & { description: string | null; status: 'active' | 'resolved' | 'hidden_in_review' | 'blocked' };
export type Coordinates = { latitude: number; longitude: number; accuracy_m: number; mocked: boolean };

export class ServicesApiError extends Error {}

async function request<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    response = await fetch(`${getApiUrl()}${path}`, {
      ...init,
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
      signal: controller.signal,
    });
  } catch {
    throw new ServicesApiError('No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.');
  } finally {
    clearTimeout(timeout);
  }
  const payload = await response.json().catch(() => ({})) as { message?: string; error?: string } & T;
  if (!response.ok) throw new ServicesApiError(payload.message ?? 'No pudimos completar la operación. Inténtalo nuevamente.');
  return payload;
}

export const servicesApi = {
  nearby(token: string, location: Coordinates, category: ServiceCategory | null, query: string, walkingOnly: boolean) {
    const params = new URLSearchParams({ latitude: String(location.latitude), longitude: String(location.longitude), accuracy_m: String(location.accuracy_m), mocked: String(location.mocked), walking_only: String(walkingOnly) });
    if (category) params.set('category', category);
    if (query.trim()) params.set('q', query.trim());
    return request<{ data: ServiceItem[]; radius_m: number }>(`/api/v1/services/nearby?${params}`, token);
  },
  details(id: string, token: string) { return request<ServiceDetails>(`/api/v1/services/${encodeURIComponent(id)}`, token); },
  mine(token: string) { return request<{ data: ManagedService[] }>('/api/v1/services/mine', token); },
  update(token: string, item: ManagedService, status: 'active' | 'resolved') {
    return request<{ service: ManagedService }>(`/api/v1/services/${encodeURIComponent(item.id)}`, token, { method: 'PATCH', body: JSON.stringify({ title: item.title, category: item.category, description: item.description ?? '', status }) });
  },
  create(token: string, location: Coordinates, title: string, category: ServiceCategory, description: string) {
    return request<{ service: { id: string } }>('/api/v1/services', token, { method: 'POST', body: JSON.stringify({ ...location, title, category, description }) });
  },
  vouch(id: string, token: string) { return request<{ recommendations: number }>(`/api/v1/services/${encodeURIComponent(id)}/vouches`, token, { method: 'POST', body: '{}' }); },
  report(id: string, token: string) { return request<{ reported: boolean; status: string }>(`/api/v1/services/${encodeURIComponent(id)}/reports`, token, { method: 'POST', body: '{}' }); },
};
