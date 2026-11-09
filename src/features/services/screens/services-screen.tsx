import { router } from 'expo-router';
import * as Location from 'expo-location';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';

import { AppText as Text } from '@/components/app-text';
import { AppShell } from '@/components/app-shell';
import { authStorage } from '@/features/auth/data/auth-storage';
import { servicesApi, ServicesApiError, type Coordinates, type ManagedService, type ServiceCategory, type ServiceDetails, type ServiceItem } from '@/features/services/data/services-api';
import { SERVICE_CATEGORIES } from '@/features/services/data/sample-services';

const categories = SERVICE_CATEGORIES.filter((item) => item.id !== 'all');
const errorMessage = (error: unknown) => error instanceof ServicesApiError ? error.message : 'Ocurrió un problema. Inténtalo nuevamente.';
const tierLabel = (tier: ServiceItem['provider_tier']) => tier === 'level_3_provider_brigade' ? 'Prestador verificado' : tier === 'level_2_verified' ? 'Vecino validado' : 'Vecino';
const distanceLabel = (distance: number) => distance >= 1000 ? `${(distance / 1000).toFixed(1)} km` : `${distance} m`;

export function ServicesScreen() {
  const [token, setToken] = useState('');
  const [location, setLocation] = useState<Coordinates | null>(null);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [myServices, setMyServices] = useState<ManagedService[]>([]);
  const [showMyServices, setShowMyServices] = useState(false);
  const [editingServiceId, setEditingServiceId] = useState('');
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const [walkingOnly, setWalkingOnly] = useState(true);
  const [selected, setSelected] = useState<ServiceDetails | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [serviceTitle, setServiceTitle] = useState('');
  const [serviceDescription, setServiceDescription] = useState('');
  const [serviceCategory, setServiceCategory] = useState<ServiceCategory>('otros');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchRequested, setSearchRequested] = useState(false);
  const [vouchedIds, setVouchedIds] = useState<string[]>([]);
  const [reportedIds, setReportedIds] = useState<string[]>([]);

  const restoreSession = useCallback(async () => {
    try {
      const session = await authStorage.getSession();
      if (!session) { router.replace('/'); return; }
      setToken(session.accessToken);
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void restoreSession();
  }, [restoreSession]);

  const acquireLocation = useCallback(async () => {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== 'granted') throw new ServicesApiError('Necesitamos permiso de ubicación mientras usas la app para encontrar servicios de tu comunidad.');
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    if (position.mocked === true) throw new ServicesApiError('La ubicación parece simulada. Activa la ubicación real para continuar.');
    if (position.coords.accuracy === null || position.coords.accuracy > 250) throw new ServicesApiError('La ubicación no es suficientemente precisa. Inténtalo en un espacio abierto.');
    const current = { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy_m: position.coords.accuracy, mocked: false };
    setLocation(current);
    return current;
  }, []);

  const searchNearby = useCallback(async () => {
    if (!token || busy) return;
    setBusy(true); setNotice(''); setSearchRequested(true);
    try {
      const current = await acquireLocation();
      const result = await servicesApi.nearby(token, current, category === 'all' ? null : category as ServiceCategory, query, walkingOnly);
      setServices(result.data);
    } catch (error) { setServices([]); setNotice(errorMessage(error)); }
    finally { setBusy(false); }
  }, [acquireLocation, busy, category, query, token, walkingOnly]);

  const openDetails = async (item: ServiceItem) => {
    if (!token || busy) return;
    setBusy(true); setNotice('');
    try { setSelected(await servicesApi.details(item.id, token)); }
    catch (error) { setNotice(errorMessage(error)); }
    finally { setBusy(false); }
  };

  const refreshList = async () => {
    if (!token || !location) return;
    try {
      const result = await servicesApi.nearby(token, location, category === 'all' ? null : category as ServiceCategory, query, walkingOnly);
      setServices(result.data);
    } catch (error) { setNotice(errorMessage(error)); }
  };

  const submitVouch = async () => {
    if (!selected || !token || busy) return;
    setBusy(true);
    try {
      const result = await servicesApi.vouch(selected.id, token);
      setVouchedIds((current) => [...current, selected.id]);
      setSelected({ ...selected, recommendations: result.recommendations });
      setServices((current) => current.map((item) => item.id === selected.id ? { ...item, recommendations: result.recommendations } : item));
      setNotice('Tu Visto Bueno quedó registrado.');
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setBusy(false); }
  };

  const submitReport = async () => {
    if (!selected || !token || busy) return;
    setBusy(true);
    try {
      await servicesApi.report(selected.id, token);
      setReportedIds((current) => [...current, selected.id]);
      setSelected(null);
      setNotice('Gracias. El reporte se envió para revisión.');
      await refreshList();
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setBusy(false); }
  };

  const publishService = async () => {
    const title = serviceTitle.trim();
    const description = serviceDescription.trim();
    if (title.length < 3 || description.length < 3) { setNotice('Escribe un título y una descripción breve.'); return; }
    if (!token || busy) return;
    setBusy(true);
    try {
      let current = location;
      if (editingServiceId) {
        const item = myServices.find((service) => service.id === editingServiceId);
        if (!item) throw new ServicesApiError('No encontramos la publicación que quieres editar.');
        const result = await servicesApi.update(token, { ...item, title, category: serviceCategory, description }, item.status === 'resolved' ? 'resolved' : 'active');
        setMyServices((items) => items.map((service) => service.id === result.service.id ? result.service : service));
      } else {
        current = await acquireLocation();
        await servicesApi.create(token, current, title, serviceCategory, description);
        setSearchRequested(true);
        const result = await servicesApi.nearby(token, current, category === 'all' ? null : category as ServiceCategory, query, walkingOnly);
        setServices(result.data);
      }
      setComposerOpen(false); setEditingServiceId(''); setNotice(editingServiceId ? 'Tus cambios quedaron guardados.' : 'Tu oficio se publicó en tu cuadrante.');
      if (showMyServices) setMyServices((await servicesApi.mine(token)).data);
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setBusy(false); }
  };

  const openMyServices = async () => {
    if (!token || busy) return;
    setBusy(true);
    try { setMyServices((await servicesApi.mine(token)).data); setShowMyServices(true); }
    catch (error) { setNotice(errorMessage(error)); }
    finally { setBusy(false); }
  };

  const toggleServiceStatus = async (service: ManagedService) => {
    if (!token || busy || !['active', 'resolved'].includes(service.status)) return;
    setBusy(true);
    try {
      const nextStatus = service.status === 'active' ? 'resolved' : 'active';
      const result = await servicesApi.update(token, service, nextStatus);
      setMyServices((items) => items.map((item) => item.id === service.id ? result.service : item));
      setNotice(nextStatus === 'resolved' ? 'El oficio quedó pausado y no aparecerá en las búsquedas.' : 'El oficio volvió a estar disponible.');
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setBusy(false); }
  };

  const editService = (service: ManagedService) => {
    setEditingServiceId(service.id); setServiceTitle(service.title); setServiceDescription(service.description ?? ''); setServiceCategory(service.category); setComposerOpen(true);
  };

  const categoryLabel = useMemo(() => new Map<string, string>([...SERVICE_CATEGORIES.map((item): [string, string] => [item.id, item.label]), ['otros', 'Otros']]), []);

  return (
    <AppShell activeTab="services">
      <View className="flex-1">
        <ScrollView contentContainerClassName="gap-3 px-4 py-4 pb-8" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View><Text className="text-2xl font-extrabold text-barrio-ink">Oficios cerca de ti</Text><Text className="mt-1 text-sm leading-5 text-barrio-muted">Servicios recomendados por personas del barrio.</Text></View>
          <View className="flex-row items-center gap-2 rounded-2xl border border-barrio-border bg-white px-3"><SymbolView name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }} tintColor="#4F5F58" size={21} /><TextInput accessibilityLabel="Buscar oficio o tienda" className="min-h-12 flex-1 text-base text-barrio-ink" onChangeText={setQuery} onSubmitEditing={() => void searchNearby()} placeholder="Buscar: gasfitero, clases…" returnKeyType="search" value={query} /></View>
          <ScrollView horizontal contentContainerClassName="gap-2" showsHorizontalScrollIndicator={false}>
            {[{ id: 'all', label: 'Todos' }, ...categories].map((item) => { const active = category === item.id; return <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: active }} className={`min-h-11 items-center justify-center rounded-full border-2 px-3 ${active ? 'border-barrio-green bg-barrio-green' : 'border-barrio-border bg-white'}`} onPress={() => setCategory(item.id)}><Text className={`text-xs font-bold ${active ? 'text-white' : 'text-barrio-muted'}`}>{item.label}</Text></Pressable>; })}
          </ScrollView>
          <Pressable accessibilityRole="switch" accessibilityState={{ checked: walkingOnly }} className="flex-row items-center gap-3 rounded-2xl border border-barrio-border bg-white px-4 py-3" onPress={() => setWalkingOnly((value) => !value)}><View className={`h-8 w-14 justify-center rounded-full px-1 ${walkingOnly ? 'items-end bg-barrio-green' : 'items-start bg-[#9AA39E]'}`}><View className="h-6 w-6 rounded-full bg-white" /></View><View className="flex-1"><Text className="text-sm font-bold text-barrio-ink">Solo a pie (menos de 1 km)</Text><Text className="text-xs text-barrio-muted">Filtra servicios según la distancia</Text></View></Pressable>
          <Pressable accessibilityRole="button" disabled={busy || loading} className="min-h-12 flex-row items-center justify-center gap-2 rounded-2xl bg-barrio-green-soft px-4" onPress={() => void searchNearby()}><SymbolView name={{ ios: 'location.fill', android: 'my_location', web: 'my_location' }} tintColor="#155A43" size={20} /><Text className="font-extrabold text-barrio-green-dark">{busy ? 'Buscando…' : 'Buscar cerca de mí'}</Text></Pressable>
          <Text className="px-2 text-center text-[11px] leading-4 text-barrio-muted">Usamos tu ubicación mientras buscas. No aparece en el anuncio ni se guarda en tu perfil.</Text>
          <Pressable accessibilityRole="button" className="min-h-12 flex-row items-center justify-center gap-2 rounded-2xl border border-barrio-border bg-white px-4" onPress={() => { setEditingServiceId(''); setServiceTitle(''); setServiceDescription(''); setServiceCategory('otros'); setComposerOpen(true); }}><SymbolView name={{ ios: 'plus.circle.fill', android: 'add_circle', web: 'add_circle' }} tintColor="#155A43" size={20} /><Text className="font-extrabold text-barrio-green-dark">Ofrecer mi servicio</Text></Pressable>
          <Pressable accessibilityRole="button" className="min-h-11 items-center justify-center rounded-2xl border border-barrio-border bg-white" onPress={() => void openMyServices()}><Text className="font-bold text-barrio-green-dark">Mis publicaciones</Text></Pressable>
          {showMyServices ? <View className="gap-2 rounded-2xl border border-barrio-border bg-white p-3"><View className="flex-row items-center"><Text className="flex-1 text-base font-extrabold text-barrio-ink">Tus oficios</Text><Pressable accessibilityRole="button" onPress={() => setShowMyServices(false)}><Text className="font-bold text-barrio-green">Cerrar</Text></Pressable></View>{myServices.length ? myServices.map((service) => <View key={service.id} className="gap-2 rounded-xl bg-barrio-canvas p-3"><View className="flex-row items-center"><Text className="flex-1 font-bold text-barrio-ink">{service.title}</Text><Text className="text-xs text-barrio-muted">{service.status === 'active' ? 'Activo' : service.status === 'resolved' ? 'Pausado' : 'En revisión'}</Text></View>{service.status === 'active' || service.status === 'resolved' ? <View className="flex-row gap-2"><Pressable accessibilityRole="button" className="min-h-10 flex-1 items-center justify-center rounded-lg bg-white" onPress={() => editService(service)}><Text className="text-xs font-bold text-barrio-green">Editar</Text></Pressable><Pressable accessibilityRole="button" className="min-h-10 flex-1 items-center justify-center rounded-lg bg-white" onPress={() => void toggleServiceStatus(service)}><Text className="text-xs font-bold text-barrio-green">{service.status === 'active' ? 'Pausar' : 'Reactivar'}</Text></Pressable></View> : null}</View>) : <Text className="text-center text-sm text-barrio-muted">Todavía no tienes oficios publicados.</Text>}</View> : null}
          {loading || busy ? <View className="items-center py-3"><ActivityIndicator accessibilityLabel="Cargando" color="#1F7A5C" /></View> : null}
          {notice ? <View className="flex-row items-start gap-2 rounded-2xl bg-barrio-green-soft px-4 py-3"><Text accessibilityLiveRegion="polite" className="flex-1 text-sm leading-5 text-barrio-ink">{notice}</Text><Pressable accessibilityRole="button" accessibilityLabel="Cerrar aviso" onPress={() => setNotice('')}><Text className="font-bold text-barrio-green">×</Text></Pressable></View> : null}
          {searchRequested && !busy && services.length === 0 && !notice ? <View className="rounded-2xl border border-barrio-border bg-white p-5"><Text className="text-center text-sm leading-5 text-barrio-muted">No encontramos oficios en este radio. Prueba otra categoría o amplía la búsqueda.</Text></View> : null}
          {!searchRequested && !loading ? <View className="rounded-2xl border border-barrio-border bg-white p-5"><Text className="text-center text-sm leading-5 text-barrio-muted">Busca cerca de ti para ver los oficios disponibles en tu comunidad.</Text></View> : null}
          {services.map((service) => <Pressable key={service.id} accessibilityRole="button" className="flex-row items-center gap-3 rounded-3xl border border-barrio-border bg-white p-4" onPress={() => void openDetails(service)}><View className="h-12 w-12 items-center justify-center rounded-full bg-barrio-green-soft"><Text className="text-xl font-extrabold text-barrio-green">{service.provider_name.charAt(0)}</Text></View><View className="flex-1 gap-1"><Text className="text-base font-extrabold text-barrio-ink">{service.provider_name}</Text><Text className="text-sm text-barrio-muted">{service.title}</Text><View className="flex-row flex-wrap gap-1.5"><View className="rounded-full bg-barrio-canvas px-2 py-1"><Text className="text-xs font-semibold text-barrio-muted">A pie · {Math.max(1, Math.round(service.distance_m / 80))} min · {distanceLabel(service.distance_m)}</Text></View><View className="rounded-full bg-barrio-green-soft px-2 py-1"><Text className="text-xs font-bold text-barrio-green-dark">👍 {service.recommendations} Visto Bueno</Text></View>{service.provider_tier === 'level_3_provider_brigade' ? <View className="rounded-full bg-barrio-green-soft px-2 py-1"><Text className="text-xs font-bold text-barrio-green-dark">Verificado</Text></View> : null}</View></View><Text accessibilityElementsHidden className="text-2xl text-barrio-muted">›</Text></Pressable>)}
        </ScrollView>
      </View>

      {selected || composerOpen ? <View className="absolute inset-0 z-20 justify-end bg-black/45"><Pressable accessibilityRole="button" accessibilityLabel="Cerrar detalle" className="absolute inset-0" onPress={() => { setSelected(null); setComposerOpen(false); setEditingServiceId(''); }} /><View className="mx-auto max-h-[90%] w-full max-w-[400px] gap-3 rounded-t-3xl bg-barrio-canvas px-5 pb-8 pt-4"><View className="flex-row items-center"><Text accessibilityRole="header" className="flex-1 text-xl font-extrabold text-barrio-ink">{composerOpen ? editingServiceId ? 'Editar publicación' : 'Ofrecer mi servicio' : selected?.provider_name}</Text><Pressable accessibilityRole="button" accessibilityLabel="Cerrar" className="h-11 w-11 items-center justify-center rounded-full bg-barrio-green-soft" onPress={() => { setSelected(null); setComposerOpen(false); setEditingServiceId(''); }}><Text className="text-xl font-bold text-barrio-green">×</Text></Pressable></View>
        {composerOpen ? <><Text className="text-sm font-bold text-barrio-ink">¿Qué oficio ofreces?</Text><TextInput className="min-h-12 rounded-2xl border-2 border-barrio-border bg-white px-3 text-base text-barrio-ink" maxLength={100} onChangeText={setServiceTitle} placeholder="Ej.: Pintor de casas" value={serviceTitle} /><Text className="text-sm font-bold text-barrio-ink">Categoría</Text><ScrollView horizontal contentContainerClassName="gap-2" showsHorizontalScrollIndicator={false}>{categories.map((item) => <Pressable key={item.id} className={`rounded-full px-3 py-2 ${serviceCategory === item.id ? 'bg-barrio-green' : 'bg-white'}`} onPress={() => setServiceCategory(item.id as ServiceCategory)}><Text className={`text-xs font-bold ${serviceCategory === item.id ? 'text-white' : 'text-barrio-ink'}`}>{item.label}</Text></Pressable>)}</ScrollView><Text className="text-sm font-bold text-barrio-ink">Cuéntanos un poco más</Text><TextInput className="min-h-24 rounded-2xl border-2 border-barrio-border bg-white px-3 py-3 text-base text-barrio-ink" multiline maxLength={2000} onChangeText={setServiceDescription} placeholder="Horarios, precios, detalles…" textAlignVertical="top" value={serviceDescription} /><Pressable accessibilityRole="button" disabled={busy} className="min-h-14 items-center justify-center rounded-2xl bg-barrio-green px-4" onPress={() => void publishService()}><Text className="font-extrabold text-white">{busy ? editingServiceId ? 'Guardando…' : 'Publicando…' : editingServiceId ? 'Guardar cambios' : 'Publicar'}</Text></Pressable><Text className="text-center text-[11px] text-barrio-muted">{editingServiceId ? 'Los anuncios en revisión solo pueden ser modificados por moderación.' : 'La publicación solo se acepta desde tu cuadrante validado.'}</Text></> : null}
        {selected && !composerOpen ? <><Text className="text-sm text-barrio-muted">{categoryLabel.get(selected.category) ?? 'Servicio'}</Text><View className="flex-row flex-wrap gap-2"><View className="rounded-full bg-barrio-green-soft px-3 py-2"><Text className="text-xs font-bold text-barrio-green-dark">{selected.recommendations} Visto Bueno</Text></View><View className="rounded-full bg-barrio-canvas px-3 py-2"><Text className="text-xs font-semibold text-barrio-muted">{tierLabel(selected.provider_tier)}</Text></View></View><Text className="text-base leading-6 text-barrio-ink">{selected.description || 'Sin descripción.'}</Text><View className="items-center gap-1 rounded-2xl border border-barrio-border bg-white p-4"><Text className="text-xs text-barrio-muted">Teléfono de contacto</Text><Text className="text-sm font-semibold text-barrio-ink">{selected.contact_phone}</Text></View><Pressable accessibilityRole="button" disabled={busy || vouchedIds.includes(selected.id)} className={`min-h-12 items-center justify-center rounded-2xl px-4 ${vouchedIds.includes(selected.id) ? 'bg-barrio-green-soft' : 'bg-barrio-green'}`} onPress={() => void submitVouch()}><Text className={`font-bold ${vouchedIds.includes(selected.id) ? 'text-barrio-green-dark' : 'text-white'}`}>{vouchedIds.includes(selected.id) ? 'Ya diste Visto Bueno' : 'Dar Visto Bueno'}</Text></Pressable><Pressable accessibilityRole="button" disabled={busy || reportedIds.includes(selected.id)} className="min-h-11 items-center justify-center px-4" onPress={() => void submitReport()}><Text className="font-semibold text-barrio-muted">{reportedIds.includes(selected.id) ? 'Reportado' : 'Reportar este anuncio'}</Text></Pressable><Text className="text-center text-[11px] text-barrio-muted">La dirección exacta del servicio no se comparte.</Text></> : null}
      </View></View> : null}
    </AppShell>
  );
}
