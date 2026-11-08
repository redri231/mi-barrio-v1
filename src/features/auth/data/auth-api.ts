import type { StoredSession } from './auth-storage';

type ApiErrorBody = { message?: string; error?: string };
type OtpResponse = { message?: string };
type VerifyResponse = {
  access_token: string;
  refresh_token?: string;
  user: { id?: string; user_id?: string; full_name?: string; phone_number?: string };
};

export class AuthApiError extends Error {}

function getApiUrl() {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/$/, '');
  if (!apiUrl) {
    throw new AuthApiError('La conexión de Mi Barrio aún no está configurada. Inténtalo más tarde.');
  }
  return apiUrl;
}

async function post<T>(path: string, body: object): Promise<T> {
  const apiUrl = getApiUrl();
  let response: Response;
  try {
    response = await fetch(`${apiUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AuthApiError('No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.');
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

export const authApi = {
  requestOtp(phoneNumber: string, fullName?: string) {
    return post<OtpResponse>('/auth/otp/request', {
      phone_number: phoneNumber,
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
