import { authStorage, type StoredSession } from './auth-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

type ApiErrorBody = { message?: string; error?: string };
type OtpResponse = { message?: string; demo_code?: string; demo_only?: boolean };
type VerifyResponse = {
  access_token: string;
  refresh_token?: string;
  user: { id?: string; user_id?: string; full_name?: string; phone_number?: string };
};
export type UserProfile = {
  id: string;
  full_name: string;
  tier: 'level_1_basic' | 'level_2_verified' | 'level_3_provider_brigade';
  joined_at: string;
  district_name: string | null;
  quadrant_code: string | null;
  recommendations_received: number;
};
export type NotificationPreferences = {
  notify_offers: boolean;
  notify_swaps: boolean;
  notify_tutorials: boolean;
  notify_emergency_sos: true;
};

export class AuthApiError extends Error {}
class RequestTimeoutError extends Error {}

const REQUEST_TIMEOUT_MS = 12_000;

export function getApiUrl() {
  let apiUrl = (process.env.EXPO_PUBLIC_API_URL?.trim() || 'https://mi-barrio-v1.onrender.com').replace(/\/$/, '');
  if (!apiUrl) {
    throw new AuthApiError('La conexión de Mi Barrio aún no está configurada. Inténtalo más tarde.');
  }
  // A phone running Expo Go must reach the computer hosting Metro, not its own localhost.
  if (__DEV__ && /^https?:\/\/(localhost|127\.0\.0\.1)(?=:\d+|\/|$)/.test(apiUrl)) {
    if (Platform.OS === 'android' && !Device.isDevice) {
      apiUrl = apiUrl.replace(/^(https?:\/\/)(localhost|127\.0\.0\.1)/, (_match, scheme: string) => `${scheme}10.0.2.2`);
    } else if (Platform.OS !== 'web' && Constants.expoConfig?.hostUri) {
      const hostUri = Constants.expoConfig.hostUri;
      const host = hostUri.startsWith('[') ? hostUri.slice(1, hostUri.indexOf(']')) : hostUri.split(':')[0];
      apiUrl = apiUrl.replace(/^(https?:\/\/)(localhost|127\.0\.0\.1)/, (_match, scheme: string) => `${scheme}${host}`);
    }
  }
  return apiUrl;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fetch(url, init),
      new Promise<Response>((_resolve, reject) => {
        timeoutId = setTimeout(() => reject(new RequestTimeoutError()), REQUEST_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function post<T>(path: string, body: object): Promise<T> {
  const apiUrl = getApiUrl();
  let response: Response;
  try {
    response = await fetchWithTimeout(`${apiUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    if (error instanceof RequestTimeoutError) {
      throw new AuthApiError(`La API ${apiUrl} no respondio en 12 segundos. Revisa la red local y que el puerto 10000 sea accesible desde el telefono.`);
    }
    throw new AuthApiError(
      __DEV__
        ? `No pudimos conectar con la API en ${apiUrl}. Inicia el backend ejecutando npm run dev dentro de server/.`
        : 'No pudimos conectar. Revisa tu conexion e intentalo de nuevo.',
    );
  }

  const data = (await response.json().catch(() => ({}))) as ApiErrorBody & T;
  if (!response.ok) {
    if (response.status === 429) {
      throw new AuthApiError('Hiciste varios intentos. Espera un momento antes de volver a probar.');
    }
    if (response.status === 400 || response.status === 401) {
      throw new AuthApiError(data.message ?? 'El código no es correcto o ya venció. Revisa los datos.');
    }
    throw new AuthApiError(data.message ?? 'Ocurrió un problema. Inténtalo de nuevo más tarde.');
  }
  return data;
}

async function get<T>(path: string, accessToken: string): Promise<T> {
  const apiUrl = getApiUrl();
  let response: Response;
  try {
    response = await fetchWithTimeout(`${apiUrl}${path}`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
    });
  } catch (error) {
    if (error instanceof RequestTimeoutError) {
      throw new AuthApiError('El servidor no respondio en 12 segundos. Intentalo nuevamente.');
    }
    throw new AuthApiError('No pudimos conectar con el servidor. Revisa tu conexion e intentalo de nuevo.');
  }
  const data = (await response.json().catch(() => ({}))) as ApiErrorBody & T;
  if (!response.ok) {
    if (response.status === 401) throw new AuthApiError(data.message ?? 'Tu sesión venció. Inicia sesión nuevamente.');
    throw new AuthApiError(data.message ?? 'No pudimos cargar tu perfil. Inténtalo nuevamente.');
  }
  return data;
}

async function put<T>(path: string, accessToken: string, body: object): Promise<T> {
  const apiUrl = getApiUrl();
  let response: Response;
  try {
    response = await fetchWithTimeout(`${apiUrl}${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AuthApiError('No pudimos guardar tus preferencias. Revisa tu conexión e inténtalo de nuevo.');
  }
  const data = (await response.json().catch(() => ({}))) as ApiErrorBody & T;
  if (!response.ok) throw new AuthApiError(data.message ?? 'No pudimos guardar tus preferencias. Inténtalo nuevamente.');
  return data;
}

export const authApi = {
  getMyProfile(accessToken: string) {
    return get<UserProfile>('/api/v1/profile/me', accessToken);
  },

  getNotificationPreferences(accessToken: string) {
    return get<NotificationPreferences>('/api/v1/profile/me/notification-preferences', accessToken);
  },

  updateNotificationPreferences(accessToken: string, preferences: Pick<NotificationPreferences, 'notify_offers' | 'notify_swaps' | 'notify_tutorials'>) {
    return put<NotificationPreferences>('/api/v1/profile/me/notification-preferences', accessToken, preferences);
  },

  async requestOtp(phoneNumber: string, fullName?: string) {
    const installationId = await authStorage.getInstallationId();
    return post<OtpResponse>('/auth/otp/request', {
      phone_number: phoneNumber,
      installation_id: installationId,
      ...(fullName ? { full_name: fullName } : {}),
    });
  },

  async verifyOtp(phoneNumber: string, fullName: string, code: string): Promise<StoredSession> {
    const result = await post<VerifyResponse>('/auth/otp/verify', {
      phone_number: phoneNumber,
      code,
    });

    if (!result.access_token || !result.user) {
      throw new AuthApiError('El servidor respondió de forma inesperada. Inténtalo nuevamente.');
    }

    return {
      accessToken: result.access_token,
      refreshToken: result.refresh_token,
      user: {
        id: result.user.id ?? result.user.user_id ?? '',
        fullName: result.user.full_name ?? fullName,
        phoneNumber: result.user.phone_number ?? phoneNumber,
      },
    };
  },
};
