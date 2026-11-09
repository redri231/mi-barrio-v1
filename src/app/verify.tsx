import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { AuthButton } from '@/features/auth/components/auth-button';
import { AuthInput } from '@/features/auth/components/auth-input';
import { AuthShell } from '@/features/auth/components/auth-shell';
import { authApi, AuthApiError } from '@/features/auth/data/auth-api';
import { authStorage, type PendingRegistration } from '@/features/auth/data/auth-storage';

function formatPhone(phoneNumber: string) {
  const localNumber = phoneNumber.replace(/^\+?51/, '');
  return `+51 ${localNumber.replace(/(\d{3})(?=\d)/g, '$1 ').trim()}`;
}

export default function VerifyScreen() {
  const [pending, setPending] = useState<PendingRegistration | null>(null);
  const [loadingPending, setLoadingPending] = useState(true);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [requestError, setRequestError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendIn, setResendIn] = useState(60);

  useEffect(() => {
    let mounted = true;
    authStorage
      .getPendingRegistration()
      .then((value) => {
        if (mounted) {
          setPending(value);
          if (value?.demoCode) setCode(value.demoCode);
        }
      })
      .catch(() => {
        if (mounted) setRequestError('No pudimos recuperar esta verificación. Vuelve a ingresar tu celular.');
      })
      .finally(() => {
        if (mounted) setLoadingPending(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  const verify = async () => {
    if (!pending) return;
    const validCode = /^\d{6}$/.test(code);
    setCodeError(validCode ? '' : 'El código debe tener 6 números.');
    setRequestError('');
    if (!validCode) return;

    setLoading(true);
    try {
      const session = await authApi.verifyOtp(pending.phoneNumber, pending.fullName ?? '', code);
      await authStorage.saveSession(session);
      await authStorage.clearPendingRegistration();
      router.replace('/home');
    } catch (error) {
      setRequestError(
        error instanceof AuthApiError
          ? error.message
          : 'No pudimos completar el acceso seguro. Inténtalo de nuevo.',
      );
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    if (!pending || resendIn > 0 || loading) return;
    setLoading(true);
    setRequestError('');
    try {
      const otpResponse = await authApi.requestOtp(pending.phoneNumber, pending.fullName);
      const updatedPending = {
        ...pending,
        demoCode: otpResponse.demo_only ? otpResponse.demo_code : undefined,
      };
      setPending(updatedPending);
      await authStorage.savePendingRegistration(updatedPending);
      setCode(updatedPending.demoCode ?? '');
      setResendIn(60);
    } catch (error) {
      setRequestError(
        error instanceof AuthApiError ? error.message : 'No pudimos reenviar el código. Inténtalo nuevamente.',
      );
    } finally {
      setLoading(false);
    }
  };

  if (loadingPending) {
    return (
      <AuthShell>
        <Text accessibilityRole="progressbar" className="py-5 text-center text-base text-barrio-muted">
          Preparando la verificación…
        </Text>
      </AuthShell>
    );
  }

  if (!pending) {
    return (
      <AuthShell>
        <Text className="text-2xl font-bold text-barrio-ink">Empecemos de nuevo</Text>
        <Text className="mb-5 mt-2 text-base leading-6 text-barrio-muted">
          {requestError || 'No encontramos una solicitud de código activa.'}
        </Text>
        <AuthButton label="Volver al registro" onPress={() => router.replace('/')} />
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <Text className="text-2xl font-bold text-barrio-ink">Escribe el código</Text>
      <Text className="mb-6 mt-2 text-base leading-6 text-barrio-muted">
        {pending.demoCode ? 'Preparamos un SMS simulado para ' : 'Enviamos un mensaje de texto a '}
        <Text className="font-bold text-barrio-ink">{formatPhone(pending.phoneNumber)}</Text>.
      </Text>

      {pending.demoCode ? (
        <View className="mb-5 gap-1 rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <Text className="text-xs font-bold uppercase tracking-wide text-amber-900">SMS simulado · solo desarrollo</Text>
          <Text accessibilityLabel={`Código de desarrollo ${pending.demoCode}`} className="text-3xl font-extrabold tracking-[8px] text-amber-950">{pending.demoCode}</Text>
          <Text className="text-xs leading-4 text-amber-900">Este código lo generó el backend y vence en 5 minutos. No se envió un SMS real.</Text>
        </View>
      ) : null}

      <View className="gap-5">
        <AuthInput
          autoComplete="sms-otp"
          error={codeError}
          keyboardType="number-pad"
          label="Código de 6 números"
          maxLength={6}
          onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))}
          placeholder="······"
          textContentType="oneTimeCode"
          value={code}
        />
        {requestError ? (
          <Text accessibilityLiveRegion="polite" className="rounded-xl bg-red-50 px-4 py-3 text-sm leading-5 text-red-800">
            {requestError}
          </Text>
        ) : null}
        <AuthButton label="Verificar y entrar" loading={loading} onPress={verify} />
      </View>

      <View className="mt-5 items-center gap-1">
        <Text className="text-sm text-barrio-muted">¿No te llegó el mensaje?</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: resendIn > 0 || loading }}
          className="min-h-11 justify-center px-2"
          disabled={resendIn > 0 || loading}
          onPress={resend}>
          <Text className={`text-base font-bold ${resendIn > 0 ? 'text-barrio-muted' : 'text-barrio-green'}`}>
            {resendIn > 0 ? `Reenviar código en 0:${String(resendIn).padStart(2, '0')}` : 'Reenviar código'}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          className="min-h-11 justify-center px-2"
          disabled={loading}
          onPress={async () => {
            await authStorage.clearPendingRegistration();
            router.replace('/');
          }}>
          <Text className="text-base font-semibold text-barrio-muted">Cambiar mi celular</Text>
        </Pressable>
      </View>
    </AuthShell>
  );
}
