import { router } from 'expo-router';
import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';

import { AppText as Text } from '@/components/app-text';
import { AppShell } from '@/components/app-shell';
import { useAppState } from '@/components/app-state';
import { authApi, AuthApiError, type UserProfile } from '@/features/auth/data/auth-api';
import { authStorage } from '@/features/auth/data/auth-storage';
import { trustApi, type TrustStatus } from '@/features/auth/data/trust-api';
import { getNeighbors, type Neighbor } from '@/features/neighbors/data/neighbors-api';

const TRUST_LEVELS = [
  { tier: 'level_1_basic', title: 'Básico', detail: 'Puedes mirar y consultar servicios cercanos.' },
  { tier: 'level_2_verified', title: 'Vecino validado', detail: 'Puedes publicar, pedir ayuda y dar Visto Bueno.' },
  { tier: 'level_3_provider_brigade', title: 'Prestador / Brigada', detail: 'Apareces como oficio verificado o brigadista.' },
] as const;

function tierNumber(tier: UserProfile['tier']) {
  return TRUST_LEVELS.findIndex((item) => item.tier === tier) + 1;
}

function formatJoinedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Fecha no disponible';
  return new Intl.DateTimeFormat('es-PE', { month: 'long', year: 'numeric' }).format(date);
}

export default function ProfileScreen() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [profileNotice, setProfileNotice] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [trustStatus, setTrustStatus] = useState<TrustStatus | null>(null);
  const [neighbors, setNeighbors] = useState<Neighbor[]>([]);
  const [givenVouches, setGivenVouches] = useState<string[]>([]);
  const [trustBusy, setTrustBusy] = useState(false);
  const { largeText, setLargeText } = useAppState();

  const loadProfile = useCallback(async () => {
    try {
      const session = await authStorage.getSession();
      if (!session) {
        router.replace('/');
        return;
      }
      setAccessToken(session.accessToken);
      const userProfile = await authApi.getMyProfile(session.accessToken);
      setProfile(userProfile);
      const trust = await trustApi.status(session.accessToken);
      setTrustStatus(trust);
      try { setNeighbors((await getNeighbors(session.accessToken)).data); } catch { setNeighbors([]); }
    } catch (loadError) {
      setError(loadError instanceof AuthApiError ? loadError.message : 'No pudimos cargar tu perfil. Inténtalo nuevamente.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // The loader updates state only after the async session and API reads finish.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadProfile();
  }, [loadProfile]);

  const signOut = async () => {
    await authStorage.clearSession();
    router.replace('/');
  };

  if (loading) {
    return (
      <AppShell activeTab="profile">
        <View className="flex-1 items-center justify-center"><ActivityIndicator accessibilityLabel="Cargando perfil" color="#1F7A5C" size="large" /></View>
      </AppShell>
    );
  }

  if (!profile) {
    return (
      <AppShell activeTab="profile">
        <View className="mx-auto w-full max-w-xl flex-1 justify-center px-5">
          <Text className="text-2xl font-bold text-barrio-ink">No pudimos abrir tu perfil</Text>
          <Text accessibilityLiveRegion="polite" className="mt-2 text-base leading-6 text-barrio-muted">
            {error || 'Inténtalo nuevamente.'}
          </Text>
          <Pressable
            accessibilityRole="button"
            className="mt-6 min-h-14 items-center justify-center rounded-2xl bg-barrio-green px-5"
            onPress={() => {
              setLoading(true);
              setError('');
              void loadProfile();
            }}>
            <Text className="text-base font-bold text-white">Volver a intentar</Text>
          </Pressable>
          <Pressable accessibilityRole="button" className="mt-3 min-h-12 items-center justify-center" onPress={() => router.replace('/home')}>
            <Text className="font-semibold text-barrio-muted">Volver al inicio</Text>
          </Pressable>
        </View>
      </AppShell>
    );
  }

  const serverLevel = tierNumber(profile.tier);
  const currentLevel = serverLevel;
  const neighborhood = [profile.district_name, profile.quadrant_code].filter(Boolean).join(' · ');

  const requestGpsVerification = async () => {
    if (!accessToken || trustBusy) return;
    setTrustBusy(true); setProfileNotice('');
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') throw new Error('Permite la ubicación mientras usas la app para enviar la solicitud.');
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      if (position.mocked === true) throw new Error('No podemos verificar con una ubicación simulada.');
      if (position.coords.accuracy === null || position.coords.accuracy > 100) throw new Error('La ubicación no es suficientemente precisa.');
      const result = await trustApi.requestResidency(accessToken, { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy_m: position.coords.accuracy, mocked: false });
      setTrustStatus((current) => ({ vouches_received: current?.vouches_received ?? 0, residency_verification: result.verification }));
      setProfileNotice(result.message);
    } catch (requestError) { setProfileNotice(requestError instanceof Error ? requestError.message : 'No pudimos enviar la solicitud.'); }
    finally { setTrustBusy(false); }
  };

  const endorseNeighbor = async (neighbor: Neighbor) => {
    if (!accessToken || trustBusy) return;
    setTrustBusy(true);
    try {
      await trustApi.vouch(accessToken, neighbor.id);
      setGivenVouches((current) => [...current, neighbor.id]);
      setProfileNotice(`Aval registrado para ${neighbor.full_name}.`);
    } catch (requestError) { setProfileNotice(requestError instanceof Error ? requestError.message : 'No pudimos registrar el aval.'); }
    finally { setTrustBusy(false); }
  };

  return (
    <AppShell activeTab="profile">
      <View className="mx-auto w-full max-w-2xl flex-1">
        <ScrollView contentContainerClassName="gap-3 px-4 py-4 pb-8" showsVerticalScrollIndicator={false}>
          <View className="items-center rounded-3xl border border-barrio-border bg-white px-5 py-6">
            <View className="h-20 w-20 items-center justify-center rounded-full bg-barrio-green">
              <Text accessibilityLabel={`Inicial de ${profile.full_name}`} className="text-3xl font-bold text-white">
                {profile.full_name.trim().charAt(0).toLocaleUpperCase('es-PE')}
              </Text>
            </View>
            <Text className="mt-3 text-center text-2xl font-bold text-barrio-ink">{profile.full_name}</Text>
            <Text className="mt-1 text-center text-base text-barrio-muted">
              {neighborhood || 'Aún sin cuadrante asignado'}
            </Text>
            <View className="mt-3 flex-row items-center gap-2 rounded-full bg-barrio-green-soft px-4 py-2">
              <Text className="text-sm font-bold text-barrio-green">Nivel {currentLevel} · {TRUST_LEVELS[currentLevel - 1]?.title ?? 'Básico'}</Text>
            </View>
          </View>

          <View className="gap-3 rounded-3xl border border-barrio-border bg-white p-5">
            <Text accessibilityRole="header" className="text-lg font-bold text-barrio-ink">Mi historial en el barrio</Text>
            <View className="flex-row flex-wrap gap-2">
              <View className="rounded-full bg-barrio-canvas px-3 py-2">
                <Text className="text-sm font-semibold text-barrio-ink">Vecino desde {formatJoinedAt(profile.joined_at)}</Text>
              </View>
              <View className="rounded-full bg-barrio-canvas px-3 py-2">
                <Text className="text-sm font-semibold text-barrio-ink">👍 {profile.recommendations_received} Visto Bueno</Text>
              </View>
              <View className="rounded-full bg-barrio-canvas px-3 py-2">
                <Text className="text-sm font-semibold text-barrio-ink">Nivel {currentLevel}</Text>
              </View>
            </View>
            <View className="flex-row gap-3 rounded-2xl bg-barrio-green-soft px-4 py-3">
              <Text accessibilityElementsHidden className="text-lg text-barrio-green">🔒</Text>
              <Text className="flex-1 text-sm leading-5 text-barrio-ink">
                Tu ubicación exacta es privada. Otros vecinos solo ven tu cuadrante aproximado.
              </Text>
            </View>
          </View>

          <View className="gap-3">
            <Text accessibilityRole="header" className="px-1 text-xl font-bold text-barrio-ink">Mi nivel de confianza</Text>
            {TRUST_LEVELS.map((level, index) => {
              const achieved = currentLevel >= index + 1;
              return (
                <View
                  key={level.tier}
                  className={`flex-row items-center gap-3 rounded-3xl border bg-white p-4 ${achieved ? 'border-2 border-barrio-green' : 'border-barrio-border'}`}>
                  <View className={`h-11 w-11 items-center justify-center rounded-full ${achieved ? 'bg-barrio-green' : 'bg-barrio-canvas'}`}>
                    <Text accessibilityElementsHidden className={`text-lg font-bold ${achieved ? 'text-white' : 'text-barrio-muted'}`}>
                      {achieved ? '✓' : '◇'}
                    </Text>
                  </View>
                  <View className="flex-1">
                    <Text className="text-base font-bold text-barrio-ink">Nivel {index + 1} · {level.title}</Text>
                    <Text className="mt-1 text-sm leading-5 text-barrio-muted">{level.detail}</Text>
                  </View>
                </View>
              );
            })}
          </View>

          {currentLevel === 1 ? (
            <View className="gap-2 rounded-3xl border border-amber-300 bg-amber-50 p-5">
              <Text accessibilityRole="header" className="text-lg font-bold text-barrio-ink">Paso siguiente: confirma tu barrio</Text>
              <Text className="text-sm leading-5 text-barrio-muted">
                Envía una solicitud con ubicación dentro de tu cuadrante. Un responsable debe revisarla antes de cambiar tu nivel.
              </Text>
              <Pressable accessibilityRole="button" disabled={trustBusy || trustStatus?.residency_verification?.status === 'pending'} className="min-h-12 items-center justify-center rounded-2xl bg-barrio-green px-4" onPress={() => void requestGpsVerification()}>
                <Text className="font-bold text-white">{trustBusy ? 'Enviando solicitud…' : trustStatus?.residency_verification?.status === 'pending' ? 'Verificación pendiente de revisión' : 'Solicitar verificación por ubicación'}</Text>
              </Pressable>
              <Text className="text-xs leading-4 text-barrio-muted">La carga de recibos se habilitará al configurar almacenamiento cifrado; el archivo no se guarda en el dispositivo ni se envía aún.</Text>
            </View>
          ) : null}

          {currentLevel === 2 ? (
            <View className="gap-2 rounded-3xl border border-amber-300 bg-amber-50 p-5">
              <Text accessibilityRole="header" className="text-lg font-bold text-barrio-ink">Para ser Prestador o Brigadista</Text>
              <Text className="text-sm leading-5 text-barrio-muted">Avales vecinales recibidos: {trustStatus?.vouches_received ?? 0} de 3. El sistema no sube tu nivel automáticamente; también hace falta revisar tu identidad.</Text>
              <Text className="text-sm font-bold text-barrio-ink">Puedes avalar a un vecino de tu cuadrante:</Text>
              {neighbors.filter((neighbor) => neighbor.tier !== 'level_1_basic').map((neighbor) => <View key={neighbor.id} className="flex-row items-center gap-2 rounded-2xl bg-white p-3"><Text className="flex-1 text-sm font-semibold text-barrio-ink">{neighbor.full_name}</Text><Pressable accessibilityRole="button" disabled={trustBusy || givenVouches.includes(neighbor.id)} className="min-h-10 rounded-xl bg-barrio-green px-3" onPress={() => void endorseNeighbor(neighbor)}><Text className="text-xs font-bold text-white">{givenVouches.includes(neighbor.id) ? 'Avalado' : 'Dar aval'}</Text></Pressable></View>)}
              {!neighbors.some((neighbor) => neighbor.tier !== 'level_1_basic') ? <Text className="text-xs text-barrio-muted">No hay otros vecinos validados disponibles para avalar todavía.</Text> : null}
            </View>
          ) : null}

          {profileNotice ? (
            <View className="flex-row items-start gap-3 rounded-2xl bg-amber-50 px-4 py-3">
              <Text accessibilityLiveRegion="polite" className="flex-1 text-sm leading-5 text-amber-950">{profileNotice}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Cerrar aviso" className="min-h-8 min-w-8 items-center justify-center" onPress={() => setProfileNotice('')}>
                <Text className="text-lg font-bold text-amber-900">×</Text>
              </Pressable>
            </View>
          ) : null}

          <Text accessibilityRole="header" className="mt-1 text-xl font-bold text-barrio-ink">Ajustes</Text>
          <View className="flex-row items-center gap-3 rounded-3xl border border-barrio-border bg-white p-4">
            <View className="flex-1">
              <Text className="text-base font-bold text-barrio-ink">Letra más grande</Text>
              <Text className="mt-1 text-sm text-barrio-muted">Ajuste de lectura para toda la app</Text>
            </View>
            <Pressable
              accessibilityRole="switch"
              accessibilityLabel="Letra más grande"
              accessibilityState={{ checked: largeText }}
              className={`h-8 w-14 justify-center rounded-full px-1 ${largeText ? 'items-end bg-barrio-green' : 'items-start bg-[#9AA39E]'}`}
              onPress={() => setLargeText(!largeText)}>
              <View className="h-6 w-6 rounded-full bg-white" />
            </Pressable>
          </View>
          {largeText ? (
            <Text className="rounded-2xl bg-barrio-green-soft px-4 py-3 text-base leading-6 text-barrio-ink">
              La vista ampliada está activada para las secciones principales de tu perfil.
            </Text>
          ) : null}

          <Pressable
            accessibilityRole="button"
            className="min-h-14 items-center justify-center rounded-2xl border border-barrio-border bg-white px-5"
            onPress={signOut}>
            <Text className="text-base font-bold text-barrio-muted">Cerrar sesión</Text>
          </Pressable>
        </ScrollView>
      </View>
    </AppShell>
  );
}
