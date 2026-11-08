import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { authStorage } from '@/features/auth/data/auth-storage';

export default function VerifiedScreen() {
  const [name, setName] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    authStorage
      .getSession()
      .then((session) => {
        if (!mounted) return;
        if (!session) {
          router.replace('/');
          return;
        }
        setName(session.user.fullName.split(' ')[0]);
        setReady(true);
      })
      .catch(() => {
        if (mounted) router.replace('/');
      });
    return () => {
      mounted = false;
    };
  }, []);

  const signOut = async () => {
    await authStorage.clearSession();
    router.replace('/');
  };

  return (
    <SafeAreaView className="flex-1 items-center justify-center bg-barrio-canvas px-6" edges={['top', 'bottom']}>
      {!ready ? (
        <ActivityIndicator color="#1F7A5C" size="large" />
      ) : (
        <View className="w-full max-w-md items-center rounded-3xl border border-barrio-border bg-white p-8">
          <View className="mb-5 h-16 w-16 items-center justify-center rounded-full bg-barrio-green-soft">
            <Text accessibilityElementsHidden className="text-3xl text-barrio-green">✓</Text>
          </View>
          <Text className="text-center text-2xl font-bold text-barrio-ink">¡Listo, {name}!</Text>
          <Text className="mt-3 text-center text-base leading-6 text-barrio-muted">
            Tu celular fue verificado. Ya podemos continuar con tu experiencia en Mi Barrio.
          </Text>
          <Pressable
            accessibilityRole="button"
            className="mt-8 min-h-12 items-center justify-center rounded-2xl border border-barrio-border px-6"
            onPress={signOut}>
            <Text className="text-base font-semibold text-barrio-muted">Cerrar sesión</Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}
