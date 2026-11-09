import { router } from 'expo-router';
import * as Location from 'expo-location';
import * as Linking from 'expo-linking';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';

import { AppText as Text } from '@/components/app-text';
import { AppShell } from '@/components/app-shell';
import { authStorage } from '@/features/auth/data/auth-storage';
import { EmergencyApiError, emergencyApi, type Brigade, type EmergencyAlert, type OwnEmergencyAlert } from '@/features/emergency/data/emergency-api';

const contacts = [{ name: 'Policía Nacional', number: '105' }, { name: 'Bomberos', number: '116' }, { name: 'SAMU', number: '106' }];

export default function EmergencyScreen() {
  const [token, setToken] = useState('');
  const [alerts, setAlerts] = useState<EmergencyAlert[]>([]);
  const [brigades, setBrigades] = useState<Brigade[]>([]);
  const [ownAlert, setOwnAlert] = useState<OwnEmergencyAlert | null>(null);
  const [reportedAlertIds, setReportedAlertIds] = useState<string[]>([]);
  const [shareLocationConsent, setShareLocationConsent] = useState(false);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const loadEmergencyInfo = useCallback(async () => {
    try {
      const session = await authStorage.getSession();
      if (!session) { router.replace('/'); return; }
      setToken(session.accessToken);
      const [directory, mine] = await Promise.all([emergencyApi.nearby(session.accessToken), emergencyApi.own(session.accessToken)]);
      setAlerts(directory.alerts); setBrigades(directory.brigades); setOwnAlert(mine.alert);
    } catch (error) { setNotice(error instanceof EmergencyApiError ? error.message : 'No pudimos cargar la información del barrio.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    // Load the emergency directory after the route is mounted.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadEmergencyInfo();
  }, [loadEmergencyInfo]);

  useEffect(() => {
    if (!token) return;
    const refreshId = setInterval(() => { void loadEmergencyInfo(); }, 15_000);
    return () => clearInterval(refreshId);
  }, [loadEmergencyInfo, token]);

  const submitSOS = async () => {
    if (busy || !token) return;
    setBusy(true); setNotice('');
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') throw new EmergencyApiError('Se necesita permiso de ubicación para incluir el cuadrante correcto. Si es urgente, llama directamente a emergencias.');
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      if (position.mocked === true) throw new EmergencyApiError('No se puede enviar SOS con una ubicación simulada.');
      if (position.coords.accuracy === null || position.coords.accuracy > 100) throw new EmergencyApiError('La ubicación no es suficientemente precisa para enviar el SOS.');
      const result = await emergencyApi.send(token, { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy_m: position.coords.accuracy, mocked: false });
      setOwnAlert(result.alert); setAlerts((current) => [ { ...result.alert, sender: 'Tú', channel: 'internet_push' }, ...current ]);
      setNotice(`${result.message} Llama a los servicios oficiales si necesitas respuesta inmediata.`);
    } catch (error) { setNotice(error instanceof EmergencyApiError ? error.message : 'No pudimos enviar el SOS. Llama directamente a emergencias.'); }
    finally { setBusy(false); }
  };

  const finishSOS = async (action: 'resolve' | 'cancel') => {
    if (!token || !ownAlert || busy) return;
    setBusy(true);
    try {
      await emergencyApi.finish(token, ownAlert.id, action);
      setOwnAlert(null); setAlerts((current) => current.filter((item) => item.id !== ownAlert.id));
      setNotice(action === 'cancel' ? 'Alerta cancelada. Si ya pediste ayuda, avisa también a tus contactos.' : 'Alerta marcada como resuelta.');
    } catch (error) { setNotice(error instanceof EmergencyApiError ? error.message : 'No pudimos actualizar la alerta.'); }
    finally { setBusy(false); }
  };

  const reportAlert = async (alert: EmergencyAlert) => {
    if (!token || busy || reportedAlertIds.includes(alert.id)) return;
    setBusy(true);
    try {
      const result = await emergencyApi.report(token, alert.id);
      setReportedAlertIds((current) => [...current, alert.id]);
      setNotice(result.needs_review ? 'La alerta alcanzó tres reportes y requiere revisión del equipo.' : 'Reporte enviado para revisión.');
    } catch (error) { setNotice(error instanceof EmergencyApiError ? error.message : 'No pudimos reportar la alerta.'); }
    finally { setBusy(false); }
  };

  return <AppShell activeTab="home" emergencyMode>
    <ScrollView contentContainerClassName="gap-4 px-4 py-4 pb-8" showsVerticalScrollIndicator={false}>
      <View className="gap-2 rounded-3xl border-2 border-red-700 bg-red-50 p-5"><Text accessibilityRole="header" className="text-2xl font-extrabold text-red-900">Ayuda de emergencia</Text><Text className="text-sm leading-5 text-red-900">El SOS registra y comparte tu ubicación con tu cuadrante. Mientras esta pantalla está abierta, revisa alertas nuevas cada 15 segundos. No funciona en segundo plano ni sin internet; si necesitas respuesta inmediata, llama a emergencias.</Text></View>
      <View className="gap-2 rounded-3xl border border-barrio-border bg-white p-4"><Text className="text-lg font-extrabold text-barrio-ink">Llama a los servicios oficiales</Text>{contacts.map((contact) => <Pressable key={contact.number} accessibilityRole="button" className="min-h-14 flex-row items-center justify-between rounded-2xl bg-red-50 px-4" onPress={() => { void Linking.openURL(`tel:${contact.number}`).catch(() => setNotice(`Marca ${contact.number} desde tu teléfono.`)); }}><Text className="font-bold text-barrio-ink">{contact.name}</Text><Text className="text-xl font-extrabold text-red-800">{contact.number} · Llamar</Text></Pressable>)}</View>
      {ownAlert ? <View className="gap-3 rounded-3xl border-2 border-red-700 bg-white p-5"><Text className="text-lg font-extrabold text-red-900">Tienes un SOS activo</Text><Text className="text-sm leading-5 text-barrio-muted">Tu alerta está registrada y se actualizará en esta pantalla mientras mantengas abierta la app.</Text><View className="flex-row gap-2"><Pressable accessibilityRole="button" disabled={busy} className="min-h-12 flex-1 items-center justify-center rounded-2xl bg-red-700 px-3" onPress={() => void finishSOS('resolve')}><Text className="text-center font-bold text-white">Marcar resuelta</Text></Pressable><Pressable accessibilityRole="button" disabled={busy} className="min-h-12 flex-1 items-center justify-center rounded-2xl bg-barrio-canvas px-3" onPress={() => void finishSOS('cancel')}><Text className="text-center font-bold text-barrio-ink">Cancelar falsa alarma</Text></Pressable></View></View> : <><Pressable accessibilityRole="checkbox" accessibilityState={{ checked: shareLocationConsent }} className="flex-row items-start gap-3 rounded-2xl border border-red-300 bg-white p-4" onPress={() => setShareLocationConsent((current) => !current)}><View className={`h-6 w-6 items-center justify-center rounded-md border ${shareLocationConsent ? 'border-red-700 bg-red-700' : 'border-barrio-border'}`}><Text className="font-extrabold text-white">{shareLocationConsent ? '✓' : ''}</Text></View><Text className="flex-1 text-sm leading-5 text-barrio-ink">Entiendo que al enviar SOS mi ubicación exacta se compartirá con usuarios de mi cuadrante.</Text></Pressable><Pressable accessibilityRole="button" disabled={busy || loading || !shareLocationConsent} className={`min-h-16 items-center justify-center rounded-2xl px-5 ${shareLocationConsent ? 'bg-red-700' : 'bg-red-300'}`} onPress={() => void submitSOS()}><Text className="text-lg font-extrabold text-white">{busy ? 'Registrando…' : 'Enviar SOS a Mi Barrio'}</Text></Pressable></>}
      {notice ? <Text accessibilityLiveRegion="polite" className="rounded-2xl bg-amber-50 p-4 text-sm leading-5 text-amber-950">{notice}</Text> : null}
      <View className="gap-3 rounded-3xl border border-barrio-border bg-white p-4"><Text className="text-lg font-extrabold text-barrio-ink">Brigadistas de mi cuadrante</Text>{loading ? <ActivityIndicator color="#1F7A5C" /> : brigades.length ? brigades.map((brigade) => <View key={brigade.id} className="rounded-2xl bg-barrio-green-soft p-3"><Text className="font-bold text-barrio-ink">{brigade.full_name}</Text><Text className="text-sm text-barrio-muted">{brigade.specialty}</Text></View>) : <Text className="text-sm leading-5 text-barrio-muted">No hay brigadistas activos registrados en tu cuadrante.</Text>}</View>
      <View className="gap-3 rounded-3xl border border-barrio-border bg-white p-4"><Text className="text-lg font-extrabold text-barrio-ink">Alertas vecinales activas</Text>{alerts.length ? alerts.map((alert) => <View key={alert.id} className="gap-2 rounded-2xl bg-red-50 p-3"><Text className="font-bold text-red-900">SOS · {alert.sender}</Text><Text className="text-xs text-red-800">{new Date(alert.created_at).toLocaleString('es-PE')} · registrado en servidor</Text>{typeof alert.latitude === 'number' && typeof alert.longitude === 'number' ? <Text selectable className="text-xs text-red-800">Ubicación: {alert.latitude.toFixed(5)}, {alert.longitude.toFixed(5)}</Text> : null}{alert.sender !== 'Tú' ? <Pressable accessibilityRole="button" disabled={busy || reportedAlertIds.includes(alert.id)} className="min-h-10 items-center justify-center rounded-xl bg-white" onPress={() => void reportAlert(alert)}><Text className="text-xs font-bold text-red-800">{reportedAlertIds.includes(alert.id) ? 'Reporte enviado' : 'Reportar falsa alarma'}</Text></Pressable> : null}</View>) : <Text className="text-sm text-barrio-muted">No hay alertas activas registradas.</Text>}</View>
      {loading ? <ActivityIndicator color="#1F7A5C" /> : null}
      <Pressable accessibilityRole="button" className="min-h-12 items-center justify-center" onPress={() => router.replace('/home')}><Text className="font-bold text-barrio-green">Volver al inicio</Text></Pressable>
    </ScrollView>
  </AppShell>;
}
