import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText as Text } from '@/components/app-text';
import { useAppState } from '@/components/app-state';
import { PhoneFrame } from '@/components/phone-frame';
import { authApi } from '@/features/auth/data/auth-api';
import { authStorage } from '@/features/auth/data/auth-storage';

type AppTab = 'home' | 'services' | 'neighbors' | 'learn' | 'profile';
type AppHref = '/home' | '/explore' | '/neighbors' | '/learn' | '/profile';

const TABS = [
  { id: 'home', label: 'Inicio', href: '/home', ios: 'house.fill', android: 'home' },
  { id: 'services', label: 'Oficios', href: '/explore', ios: 'wrench.and.screwdriver.fill', android: 'handyman' },
  { id: 'neighbors', label: 'Vecinos', href: '/neighbors', ios: 'person.2.fill', android: 'groups' },
  { id: 'learn', label: 'Aprender', href: '/learn', ios: 'play.circle.fill', android: 'play_circle' },
  { id: 'profile', label: 'Mi perfil', href: '/profile', ios: 'person.crop.circle.fill', android: 'account_circle' },
] as const satisfies readonly { id: AppTab; label: string; href: AppHref; ios: string; android: string }[];

export function AppShell({ activeTab, children, emergencyMode = false }: { activeTab: AppTab; children: ReactNode; emergencyMode?: boolean }) {
  const [showNotifications, setShowNotifications] = useState(false);
  const [preferenceError, setPreferenceError] = useState('');
  const { notificationPreferences, setNotificationPreferences } = useAppState();

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const session = await authStorage.getSession();
        if (!session) return;
        const saved = await authApi.getNotificationPreferences(session.accessToken);
        if (mounted) {
          setNotificationPreferences({ offers: saved.notify_offers, swaps: saved.notify_swaps, tutorials: saved.notify_tutorials });
          setPreferenceError('');
        }
      } catch {
        if (mounted) setPreferenceError('No pudimos cargar tus preferencias guardadas. Puedes cambiar los controles y volver a intentarlo.');
      }
    })();
    return () => { mounted = false; };
  }, [setNotificationPreferences]);

  const togglePreference = async (key: 'offers' | 'swaps' | 'tutorials') => {
    const next = { ...notificationPreferences, [key]: !notificationPreferences[key] };
    setNotificationPreferences(next);
    setPreferenceError('');
    try {
      const session = await authStorage.getSession();
      if (!session) return;
      const saved = await authApi.updateNotificationPreferences(session.accessToken, {
        notify_offers: next.offers,
        notify_swaps: next.swaps,
        notify_tutorials: next.tutorials,
      });
      setNotificationPreferences({ offers: saved.notify_offers, swaps: saved.notify_swaps, tutorials: saved.notify_tutorials });
    } catch {
      setPreferenceError('No se guardó el cambio. Revisa tu conexión e inténtalo nuevamente.');
    }
  };

  return (
    <PhoneFrame emergency={emergencyMode}>
      <SafeAreaView className={`flex-1 ${emergencyMode ? 'bg-[#FFF1E6]' : 'bg-barrio-canvas'}`} edges={['top', 'bottom']}>
      <View className="mx-auto w-full max-w-[400px] flex-1">
        <View className={`flex-row items-center gap-2 px-3 py-2 ${emergencyMode ? 'bg-[#B71C1C]' : 'bg-barrio-green'}`}>
          <SymbolView name={{ ios: emergencyMode ? 'exclamationmark.triangle.fill' : 'house.fill', android: emergencyMode ? 'warning' : 'home', web: emergencyMode ? 'warning' : 'home' }} tintColor="#FFFFFF" size={28} />
          <Text className="flex-1 text-[22px] font-extrabold text-white">{emergencyMode ? 'EMERGENCIA' : 'Mi Barrio'}</Text>
          {!emergencyMode ? <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ver preferencias de avisos"
            className="relative h-[51px] w-[51px] items-center justify-center rounded-full bg-white/20"
            onPress={() => setShowNotifications(true)}>
            <SymbolView name={{ ios: 'bell.fill', android: 'notifications', web: 'notifications' }} tintColor="#FFFFFF" size={23} />
          </Pressable> : null}
          {!emergencyMode ? <Pressable
            accessibilityRole="button"
            accessibilityLabel={emergencyMode ? 'Salir del modo emergencia' : 'Abrir ayuda de emergencia'}
            className="min-h-[51px] flex-row items-center gap-1 rounded-full border-2 border-white bg-[#D32F2F] px-3"
            onPress={() => router.replace('/emergency')}>
            <SymbolView name={{ ios: 'exclamationmark.triangle.fill', android: 'warning', web: 'warning' }} tintColor="#FFFFFF" size={20} />
            <Text className="font-extrabold text-white">SOS</Text>
          </Pressable> : null}
        </View>

        <View className="flex-1">{children}</View>

        {!emergencyMode ? <View className="flex-row border-t border-barrio-border bg-white px-1 pb-1 pt-1">
          {TABS.map((tab) => {
            const selected = activeTab === tab.id;
            return (
              <Pressable
                key={tab.id}
                accessibilityRole="button"
                accessibilityLabel={tab.label}
                accessibilityState={{ selected }}
                className={`min-h-[68px] flex-1 items-center justify-center gap-1 px-0.5 ${selected ? 'bg-barrio-green-soft' : ''}`}
                onPress={() => router.replace(tab.href)}>
                <SymbolView
                  name={{ ios: tab.ios, android: tab.android, web: tab.android }}
                  tintColor={selected ? '#155A43' : '#4F5F58'}
                  size={23}
                />
                <Text className={`text-center text-xs font-bold ${selected ? 'text-barrio-green-dark' : 'text-barrio-muted'}`}>
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View> : null}
      </View>

      {showNotifications ? (
        <View className="absolute inset-0 z-30 justify-end bg-black/45">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cerrar avisos"
            className="absolute inset-0"
            onPress={() => setShowNotifications(false)}
          />
          <View className="mx-auto max-h-[90%] w-full max-w-[400px] rounded-t-3xl bg-barrio-canvas px-5 pb-6 pt-4">
            <View className="mb-3 flex-row items-center">
              <Text accessibilityRole="header" className="flex-1 text-xl font-bold text-barrio-ink">Mis avisos</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Cerrar" className="h-11 w-11 items-center justify-center rounded-full bg-barrio-green-soft" onPress={() => setShowNotifications(false)}>
                <Text className="text-xl font-bold text-barrio-green">×</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerClassName="gap-3 pb-3" showsVerticalScrollIndicator={false}>
              <Text className="rounded-2xl border border-barrio-border bg-white p-4 text-sm leading-5 text-barrio-muted">El centro de preferencias ya guarda tus opciones. Las notificaciones push aún requieren configurar un proveedor de entrega.</Text>
              <Text className="mt-1 text-lg font-bold text-barrio-ink">¿Qué avisos quieres recibir?</Text>
              <View className="rounded-2xl border border-barrio-border bg-white px-4">
                {([
                  ['offers', 'Ofertas de vecinos'],
                  ['swaps', 'Intercambios y ayuda'],
                  ['tutorials', 'Nuevos tutoriales'],
                ] as const).map(([key, label]) => (
                  <View key={key} className="min-h-14 flex-row items-center justify-between border-b border-barrio-border">
                    <Text className="flex-1 text-sm font-semibold text-barrio-ink">{label}</Text>
                    <Pressable
                      accessibilityRole="switch"
                      accessibilityLabel={label}
                      accessibilityState={{ checked: notificationPreferences[key] }}
                      className={`h-8 w-14 justify-center rounded-full px-1 ${notificationPreferences[key] ? 'items-end bg-barrio-green' : 'items-start bg-[#9AA39E]'}`}
                      onPress={() => { void togglePreference(key); }}>
                      <View className="h-6 w-6 rounded-full bg-white" />
                    </Pressable>
                  </View>
                ))}
                <View className="min-h-14 flex-row items-center justify-between">
                  <View className="flex-1 pr-3">
                    <Text className="text-sm font-semibold text-barrio-ink">Alertas de emergencia</Text>
                    <Text className="text-xs leading-4 text-barrio-muted">Siempre activas para cuidar a todos</Text>
                  </View>
                  <View className="h-8 w-14 items-end justify-center rounded-full bg-barrio-green px-1">
                    <View className="h-6 w-6 rounded-full bg-white" />
                  </View>
                </View>
              </View>
              {preferenceError ? <Text accessibilityLiveRegion="polite" className="text-center text-xs leading-4 text-amber-900">{preferenceError}</Text> : null}
            </ScrollView>
          </View>
        </View>
      ) : null}
    </SafeAreaView>
    </PhoneFrame>
  );
}
