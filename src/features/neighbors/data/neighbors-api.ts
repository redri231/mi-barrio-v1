import { getApiUrl } from '@/features/auth/data/auth-api';

export type Neighbor = {
  id: string;
  full_name: string;
  tier: 'level_1_basic' | 'level_2_verified' | 'level_3_provider_brigade';
  joined_at: string;
};

export type NeighborsResponse = {
  neighborhood: { district_name: string | null; quadrant_code: string | null } | null;
  data: Neighbor[];
};

const REQUEST_TIMEOUT_MS = 12_000;

export async function getNeighbors(accessToken: string): Promise<NeighborsResponse> {
  const apiUrl = getApiUrl();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${apiUrl}/api/v1/neighbors`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({})) as Partial<NeighborsResponse> & { message?: string };
    if (!response.ok) {
      if (response.status === 401) throw new Error('Tu sesión venció. Inicia sesión nuevamente.');
      throw new Error(body.message ?? 'No pudimos cargar el directorio vecinal. Inténtalo nuevamente.');
    }
    if (!Array.isArray(body.data)) throw new Error('El servidor respondió de forma inesperada.');
    return { neighborhood: body.neighborhood ?? null, data: body.data as Neighbor[] };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('El servidor no respondió en 12 segundos. Inténtalo nuevamente.');
    }
    throw error instanceof Error ? error : new Error('No pudimos conectar con el servidor.');
  } finally {
    clearTimeout(timeoutId);
  }
}

