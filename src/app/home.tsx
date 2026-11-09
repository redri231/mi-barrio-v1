import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';

import { AppText as Text } from '@/components/app-text';
import { AppShell } from '@/components/app-shell';
import { getApiUrl } from '@/features/auth/data/auth-api';
import { authApi, type UserProfile } from '@/features/auth/data/auth-api';
import { authStorage } from '@/features/auth/data/auth-storage';

const QUICK_ACTIONS = [
  { title: 'Buscar un oficio', detail: 'Encuentra servicios cercanos', symbol: 'wrench.and.screwdriver.fill', androidSymbol: 'handyman', href: '/explore' as const },
  { title: 'Ayuda entre vecinos', detail: 'Comparte o pide una mano', symbol: 'person.2.fill', androidSymbol: 'groups', href: '/neighbors' as const },
  { title: 'Aprender algo nuevo', detail: 'Consejos de la comunidad', symbol: 'play.circle.fill', androidSymbol: 'play_circle', href: '/learn' as const },
  { title: 'Ofrecer mi servicio', detail: 'Publica en tu comunidad', symbol: 'plus.circle.fill', androidSymbol: 'add_circle', href: '/explore' as const },
] as const;

type ActivityItem = { id: string; type: 'swap' | 'tool' | 'purchase' | 'service'; title: string };

export default function HomeScreen() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [firstName, setFirstName] = useState('');
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadHome = useCallback(async () => {
    try {
      const session = await authStorage.getSession();
      if (!session) {
        router.replace('/');
        return;
      }
      setFirstName(session.user.fullName.split(' ')[0]);
      const loadedProfile = await authApi.getMyProfile(session.accessToken);
      setProfile(loadedProfile);
      const activityResponse = await fetch(`${getApiUrl()}/api/v1/home/activity`, { headers: { Accept: 'application/json', Authorization: `Bearer ${session.accessToken}` } });
      if (activityResponse.ok) {
        const result = await activityResponse.json() as { data?: ActivityItem[] };
        setActivity(Array.isArray(result.data) ? result.data : []);
      }
    } catch {
      // Home remains useful even if the optional profile summary is unavailable.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Load the account summary after checking the local session.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadHome();
  }, [loadHome]);

  const neighborhood = [profile?.district_name, profile?.quadrant_code].filter(Boolean).join(' · ');
  const level = profile?.tier === 'level_3_provider_brigade' ? 3 : profile?.tier === 'level_2_verified' ? 2 : 1;
  const levelLabel = ['Básico', 'Vecino validado', 'Prestador / Brigada'][level - 1];

  return (
    <AppShell activeTab="home">
      <ScrollView contentContainerClassName="gap-3 px-4 py-4 pb-8" showsVerticalScrollIndicator={false}>
        {loading ? (
          <View className="items-center py-10"><ActivityIndicator accessibilityLabel="Cargando inicio" color="#1F7A5C" /></View>
        ) : (
          <>
            <View>
              <Text className="text-2xl font-extrabold text-barrio-ink">Hola, {firstName}</Text>
              <View className="mt-1 flex-row items-center gap-1">
                <Text className="text-base text-barrio-green">⌖</Text>
                <Text className="text-sm text-barrio-muted">{neighborhood || 'Tu barrio se asignará al validar tu residencia'}</Text>
              </View>
              <View className="mt-2 self-start rounded-lg bg-barrio-green-soft px-3 py-1.5">
                <Text className="text-sm font-bold text-barrio-green">Nivel {level} · {levelLabel}</Text>
              </View>
            </View>

            {level === 1 ? (
              <View className="gap-2 rounded-2xl border border-amber-300 bg-amber-50 p-4">
                <Text className="font-extrabold text-barrio-ink">Estás en modo “solo mirar”</Text>
                <Text className="text-sm leading-5 text-barrio-muted">Confirma que vives en tu barrio para publicar, pedir ayuda y recomendar a vecinos.</Text>
                <Pressable accessibilityRole="button" className="min-h-11 justify-center rounded-xl bg-amber-100 px-3" onPress={() => router.push('/profile')}>
                  <Text className="text-center text-sm font-bold text-barrio-green">Ver opciones de validación</Text>
                </Pressable>
              </View>
            ) : null}

            <Text accessibilityRole="header" className="text-xl font-extrabold text-barrio-ink">¿Qué necesitas hoy?</Text>
            <View className="flex-row flex-wrap gap-3">
              {QUICK_ACTIONS.map((action) => (
                <Pressable
                  key={action.title}
                  accessibilityRole="button"
                  className="min-h-32 w-[48%] flex-1 items-center justify-center gap-2 rounded-3xl border-2 border-barrio-green bg-white p-3"
                  onPress={() => router.push(action.href)}>
                  <View className="h-11 w-11 items-center justify-center rounded-full bg-barrio-green-soft">
                    <SymbolView name={{ ios: action.symbol, android: action.androidSymbol, web: action.androidSymbol }} tintColor="#155A43" size={25} />
                  </View>
                  <Text className="text-center text-sm font-extrabold text-barrio-ink">{action.title}</Text>
                  <Text className="text-center text-xs leading-4 text-barrio-muted">{action.detail}</Text>
                </Pressable>
              ))}
            </View>

            <Text accessibilityRole="header" className="mt-1 text-xl font-extrabold text-barrio-ink">Cerca de ti ahora</Text>
            {activity.length ? activity.map((item) => {
              const label = item.type === 'swap' ? 'Ayuda vecinal' : item.type === 'tool' ? 'Herramienta compartida' : item.type === 'purchase' ? 'Compra grupal' : 'Oficio local';
              const href = item.type === 'service' ? '/explore' : '/neighbors';
              return <Pressable key={`${item.type}-${item.id}`} accessibilityRole="button" className="flex-row items-center gap-3 rounded-2xl border border-barrio-border bg-white p-4" onPress={() => router.push(href)}>
                <View className="h-11 w-11 items-center justify-center rounded-full bg-barrio-green-soft">
                  <Text accessibilityElementsHidden className="text-xl text-barrio-green">{item.type === 'tool' ? '⚒' : item.type === 'purchase' ? '▣' : item.type === 'service' ? '⌂' : '♡'}</Text>
                </View>
                <View className="flex-1 gap-1">
                  <Text className="text-[11px] font-bold uppercase tracking-wide text-barrio-muted">{label}</Text>
                  <Text className="text-sm font-bold leading-5 text-barrio-ink">{item.title}</Text>
                  <Text className="text-xs text-barrio-muted">En tu cuadrante</Text>
                </View>
                <Text accessibilityElementsHidden className="text-2xl text-barrio-muted">›</Text>
              </Pressable>;
            }) : (
              <View className="rounded-2xl border border-barrio-border bg-white p-4">
                <Text className="text-sm leading-5 text-barrio-muted">Cuando haya oficios, ayudas o compras activas en tu cuadrante, aparecerán aquí.</Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </AppShell>
  );
}
