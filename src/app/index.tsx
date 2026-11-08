import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { AuthButton } from '@/features/auth/components/auth-button';
import { AuthInput } from '@/features/auth/components/auth-input';
import { AuthShell } from '@/features/auth/components/auth-shell';
import { authApi, AuthApiError } from '@/features/auth/data/auth-api';
import { authStorage } from '@/features/auth/data/auth-storage';

type Mode = 'register' | 'login';

function formatPhone(value: string) {
  return value.replace(/\D/g, '').slice(0, 9).replace(/(\d{3})(?=\d)/g, '$1 ').trim();
}

export default function AuthScreen() {
  const [checkingSession, setCheckingSession] = useState(true);
  const [mode, setMode] = useState<Mode>('register');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [nameError, setNameError] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [requestError, setRequestError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    authStorage
      .getSession()
      .then((session) => {
        if (session) router.replace('/home');
        else if (mounted) setCheckingSession(false);
      })
      .catch(() => {
        if (mounted) setCheckingSession(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const handleSubmit = async () => {
    const cleanName = fullName.trim().replace(/\s+/g, ' ');
    const digits = phone.replace(/\D/g, '');
    const validName = mode === 'login' || cleanName.length >= 2;
    const validPhone = /^9\d{8}$/.test(digits);

    setNameError(validName ? '' : 'Escribe tu nombre para crear la cuenta.');
    setPhoneError(validPhone ? '' : 'Ingresa un celular peruano de 9 números que empiece con 9.');
    setRequestError('');
    if (!validName || !validPhone) return;

    const phoneNumber = `+51${digits}`;
    setLoading(true);
    try {
      await authApi.requestOtp(phoneNumber, mode === 'register' ? cleanName : undefined);
      await authStorage.savePendingRegistration({
        phoneNumber,
        ...(mode === 'register' ? { fullName: cleanName } : {}),
      });
      router.push('/verify');
    } catch (error) {
      setRequestError(
        error instanceof AuthApiError
          ? error.message
          : 'No pudimos iniciar la verificación. Inténtalo de nuevo.',
      );
    } finally {
      setLoading(false);
    }
  };

  if (checkingSession) {
    return (
      <AuthShell>
        <View className="items-center gap-3 py-5">
          <ActivityIndicator color="#1F7A5C" />
          <Text className="text-base text-barrio-muted">Preparando tu acceso…</Text>
        </View>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <Text className="text-2xl font-bold text-barrio-ink">
        {mode === 'register' ? 'Únete a tu barrio' : 'Qué bueno verte'}
      </Text>
      <Text className="mb-6 mt-2 text-base leading-6 text-barrio-muted">
        {mode === 'register'
          ? 'Confirma tu celular para empezar a conectar con tus vecinos.'
          : 'Ingresa tu celular y te enviaremos un código para entrar.'}
      </Text>

      <View className="gap-5">
        {mode === 'register' ? (
          <AuthInput
            autoCapitalize="words"
            autoComplete="name"
            error={nameError}
            label="¿Cómo te llamas?"
            maxLength={120}
            onChangeText={setFullName}
            placeholder="Tu nombre y apellido"
            returnKeyType="next"
            textContentType="name"
            value={fullName}
          />
        ) : null}

        <AuthInput
          autoComplete="tel"
          error={phoneError}
          keyboardType="number-pad"
          label="Tu celular"
          leading="+51"
          maxLength={11}
          onChangeText={(value) => setPhone(value.replace(/\D/g, '').slice(0, 9))}
          placeholder="999 999 999"
          returnKeyType="done"
          textContentType="telephoneNumber"
          value={formatPhone(phone)}
        />

        {requestError ? (
          <Text accessibilityLiveRegion="polite" className="rounded-xl bg-red-50 px-4 py-3 text-sm leading-5 text-red-800">
            {requestError}
          </Text>
        ) : null}

        <AuthButton label="Enviarme el código" loading={loading} onPress={handleSubmit} />
      </View>

      <View className="mt-6 flex-row flex-wrap items-center justify-center gap-1">
        <Text className="text-base text-barrio-muted">
          {mode === 'register' ? '¿Ya tienes cuenta?' : '¿Eres nuevo en el barrio?'}
        </Text>
        <Pressable
          accessibilityRole="button"
          className="min-h-11 justify-center px-1"
          disabled={loading}
          onPress={() => {
            setMode(mode === 'register' ? 'login' : 'register');
            setNameError('');
            setPhoneError('');
            setRequestError('');
          }}>
          <Text className="text-base font-bold text-barrio-green">
            {mode === 'register' ? 'Inicia sesión' : 'Crea tu cuenta'}
          </Text>
        </Pressable>
      </View>
    </AuthShell>
  );
}
