import { router } from 'expo-router';
import * as Location from 'expo-location';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';

import { AppText as Text } from '@/components/app-text';
import { AppShell } from '@/components/app-shell';
import { authStorage } from '@/features/auth/data/auth-storage';
import { communityApi, CommunityApiError, type CommunityCoordinates, type PurchaseRecord, type SwapRecord, type ToolRecord, type ToolRequestRecord } from '@/features/neighbors/data/community-api';

type CommunityTab = 'help' | 'tools' | 'buys';
type Composer = 'swap' | 'tool' | 'purchase' | null;
const TABS: { id: CommunityTab; label: string }[] = [{ id: 'help', label: 'Ayuda mutua' }, { id: 'tools', label: 'Herramientas' }, { id: 'buys', label: 'Compras juntas' }];
const explainError = (error: unknown) => error instanceof CommunityApiError ? error.message : 'Ocurrió un problema. Inténtalo nuevamente.';
const distanceLabel = (meters: number) => meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${meters} m`;

export function NeighborsScreen() {
  const [tab, setTab] = useState<CommunityTab>('help');
  const [token, setToken] = useState('');
  const [currentUserId, setCurrentUserId] = useState('');
  const [coordinates, setCoordinates] = useState<CommunityCoordinates | null>(null);
  const [swaps, setSwaps] = useState<SwapRecord[]>([]);
  const [tools, setTools] = useState<ToolRecord[]>([]);
  const [purchases, setPurchases] = useState<PurchaseRecord[]>([]);
  const [joinedIds, setJoinedIds] = useState<string[]>([]);
  const [requestedToolIds, setRequestedToolIds] = useState<string[]>([]);
  const [expandedToolId, setExpandedToolId] = useState('');
  const [toolRequests, setToolRequests] = useState<ToolRequestRecord[]>([]);
  const [reportedIds, setReportedIds] = useState<string[]>([]);
  const [interestedIds, setInterestedIds] = useState<string[]>([]);
  const [composer, setComposer] = useState<Composer>(null);
  const [kind, setKind] = useState<'need' | 'offer'>('offer');
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [provider, setProvider] = useState('');
  const [savings, setSavings] = useState('');
  const [target, setTarget] = useState('8');
  const [deadline, setDeadline] = useState('2026-12-31');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [searchDone, setSearchDone] = useState(false);
  const [walkingOnly, setWalkingOnly] = useState(true);

  const loadDirectory = useCallback(async (accessToken: string) => {
    const [toolResult, purchaseResult, requestResult] = await Promise.all([communityApi.tools(accessToken), communityApi.purchases(accessToken), communityApi.myToolRequests(accessToken)]);
    setTools(toolResult.data);
    setPurchases(purchaseResult.data);
    setJoinedIds(purchaseResult.data.filter((item) => item.joined).map((item) => item.id));
    setRequestedToolIds(requestResult.data.map((item) => item.tool_id));
  }, []);

  const restoreSession = useCallback(async () => {
    try {
      const session = await authStorage.getSession();
      if (!session) { router.replace('/'); return; }
      setToken(session.accessToken);
      setCurrentUserId(session.user.id);
      await loadDirectory(session.accessToken);
    } catch (error) { setNotice(explainError(error)); }
    finally { setLoading(false); }
  }, [loadDirectory]);

  useEffect(() => {
    // Restore the session and load the neighborhood directories after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void restoreSession();
  }, [restoreSession]);

  const getLocation = async () => {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== 'granted') throw new CommunityApiError('Permite la ubicación mientras usas la app para confirmar que estás en tu cuadrante.');
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    if (position.mocked === true) throw new CommunityApiError('La ubicación simulada no está permitida.');
    if (position.coords.accuracy === null || position.coords.accuracy > 150) throw new CommunityApiError('La ubicación no es suficientemente precisa.');
    const result = { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy_m: position.coords.accuracy, mocked: false };
    setCoordinates(result);
    return result;
  };

  const loadSwaps = async (knownCoordinates?: CommunityCoordinates) => {
    if (!token || busy) return;
    setBusy(true); setNotice('');
    try {
      const current = knownCoordinates ?? await getLocation();
      const result = await communityApi.swaps(token, current, walkingOnly);
      setSwaps(result.data); setSearchDone(true);
    } catch (error) { setSwaps([]); setNotice(explainError(error)); }
    finally { setBusy(false); }
  };

  const submitSwap = async () => {
    if (title.trim().length < 3) { setNotice('Escribe un título de al menos 3 caracteres.'); return; }
    if (!token || busy) return;
    setBusy(true);
    try {
      const current = await getLocation();
      const created = await communityApi.createSwap(token, current, { kind, title: title.trim(), details: details.trim(), is_urgent: kind === 'need' && urgent });
      setComposer(null); setNotice(created.warning ?? 'Tu publicación ya está disponible para vecinos de tu cuadrante.');
      const result = await communityApi.swaps(token, current, walkingOnly); setSwaps(result.data); setSearchDone(true);
    } catch (error) { setNotice(explainError(error)); }
    finally { setBusy(false); }
  };

  const actOnSwap = async (swap: SwapRecord, action: 'interest' | 'report') => {
    if (!token || busy) return;
    setBusy(true);
    try {
      if (action === 'report') {
        await communityApi.reportSwap(token, swap.id); setReportedIds((current) => [...current, swap.id]);
        setNotice('Reporte enviado. Al llegar al umbral, la base de datos oculta la publicación para revisión.');
      } else {
        const result = await communityApi.interest(token, swap.id); setInterestedIds((current) => [...current, swap.id]);
        setNotice(`Puedes coordinar directamente con ${swap.author}: ${result.contact_phone}`);
      }
      if (coordinates) { const fresh = await communityApi.swaps(token, coordinates, walkingOnly); setSwaps(fresh.data); }
    } catch (error) { setNotice(explainError(error)); }
    finally { setBusy(false); }
  };

  const submitTool = async () => {
    if (title.trim().length < 2 || !token || busy) return;
    setBusy(true);
    try {
      const current = await getLocation(); await communityApi.createTool(token, current, title.trim());
      setComposer(null); setTitle(''); await loadDirectory(token); setNotice('Herramienta publicada en tu comunidad.');
    } catch (error) { setNotice(explainError(error)); }
    finally { setBusy(false); }
  };

  const requestTool = async (tool: ToolRecord) => {
    if (!token || busy) return;
    setBusy(true);
    try { await communityApi.requestTool(token, tool.id); setRequestedToolIds((current) => [...current, tool.id]); setNotice('Solicitud registrada. Coordina con el propietario para acordar la devolución.'); }
    catch (error) { setNotice(explainError(error)); }
    finally { setBusy(false); }
  };

  const showToolRequests = async (tool: ToolRecord) => {
    if (!token || busy) return;
    if (expandedToolId === tool.id) { setExpandedToolId(''); return; }
    setBusy(true);
    try { const result = await communityApi.toolRequests(token, tool.id); setToolRequests(result.data); setExpandedToolId(tool.id); }
    catch (error) { setNotice(explainError(error)); }
    finally { setBusy(false); }
  };

  const updateToolRequest = async (request: ToolRequestRecord, status: 'accepted' | 'returned') => {
    if (!token || busy) return;
    setBusy(true);
    try {
      await communityApi.updateToolRequest(token, request.id, status);
      setToolRequests((current) => current.map((item) => item.id === request.id ? { ...item, status } : item));
      await loadDirectory(token);
      setNotice(status === 'accepted' ? 'Préstamo aceptado; la herramienta aparece como prestada.' : 'Devolución registrada; la herramienta volvió a estar disponible.');
    } catch (error) { setNotice(explainError(error)); }
    finally { setBusy(false); }
  };

  const submitPurchase = async () => {
    const participants = Number(target);
    if (!token || busy || !Number.isInteger(participants)) { setNotice('Indica una cantidad válida de vecinos.'); return; }
    setBusy(true);
    try {
      await communityApi.createPurchase(token, { title: title.trim(), provider_name: provider.trim(), savings_description: savings.trim(), target_participants: participants, deadline });
      setComposer(null); await loadDirectory(token); setNotice('Compra grupal creada. Ya estás incluido como organizador.');
    } catch (error) { setNotice(explainError(error)); }
    finally { setBusy(false); }
  };

  const toggleGroupPurchase = async (purchase: PurchaseRecord) => {
    if (!token || busy) return;
    const join = !joinedIds.includes(purchase.id); setBusy(true);
    try {
      const result = await communityApi.membership(token, purchase.id, join);
      setJoinedIds((current) => join ? [...current, purchase.id] : current.filter((id) => id !== purchase.id));
      setPurchases((current) => current.map((item) => item.id === purchase.id ? { ...item, current: result.current, joined: result.joined } : item));
      setNotice(join ? 'Te uniste a la compra.' : 'Saliste de la compra.');
    } catch (error) { setNotice(explainError(error)); }
    finally { setBusy(false); }
  };

  const openComposer = (type: Exclude<Composer, null>) => {
    setTitle(''); setDetails(''); setProvider(''); setSavings(''); setComposer(type);
  };

  return (
    <AppShell activeTab="neighbors">
      <View className="flex-1">
        <ScrollView contentContainerClassName="gap-3 px-3 py-4 pb-8" showsVerticalScrollIndicator={false}>
          <View accessibilityRole="tablist" className="flex-row rounded-2xl bg-barrio-green-soft p-1">{TABS.map((item) => { const selected = tab === item.id; return <Pressable key={item.id} accessibilityRole="tab" accessibilityState={{ selected }} className={`min-h-12 flex-1 items-center justify-center rounded-xl px-1 ${selected ? 'bg-barrio-green' : ''}`} onPress={() => setTab(item.id)}><Text className={`text-center text-xs font-bold ${selected ? 'text-white' : 'text-barrio-green-dark'}`}>{item.label}</Text></Pressable>; })}</View>
          {loading || busy ? <View className="items-center py-4"><ActivityIndicator accessibilityLabel="Cargando actividad vecinal" color="#1F7A5C" /></View> : null}
          {notice ? <View className="flex-row items-start gap-2 rounded-2xl bg-barrio-green-soft px-4 py-3"><Text accessibilityLiveRegion="polite" className="flex-1 text-sm leading-5 text-barrio-ink">{notice}</Text><Pressable accessibilityRole="button" accessibilityLabel="Cerrar aviso" onPress={() => setNotice('')}><Text className="font-bold text-barrio-green">×</Text></Pressable></View> : null}

          {tab === 'help' ? <>
            <Text className="text-sm leading-5 text-barrio-muted">Comparte o pide ayuda a vecinos de tu cuadrante. La ubicación se usa solo para filtrar y no se muestra.</Text>
            <Pressable accessibilityRole="button" className="min-h-12 flex-row items-center justify-center gap-2 rounded-2xl bg-barrio-green-soft px-4" onPress={() => void loadSwaps()}><SymbolView name={{ ios: 'location.fill', android: 'my_location', web: 'my_location' }} tintColor="#155A43" size={19} /><Text className="font-extrabold text-barrio-green-dark">Buscar ayuda cerca de mí</Text></Pressable>
            <Pressable accessibilityRole="button" className="min-h-12 flex-row items-center justify-center gap-2 rounded-2xl bg-barrio-green px-4" onPress={() => { setKind('offer'); openComposer('swap'); }}><SymbolView name={{ ios: 'plus.circle.fill', android: 'add_circle', web: 'add_circle' }} tintColor="#FFFFFF" size={20} /><Text className="font-extrabold text-white">Publicar una ayuda</Text></Pressable>
            <Pressable accessibilityRole="switch" accessibilityState={{ checked: walkingOnly }} className="flex-row items-center justify-between rounded-2xl border border-barrio-border bg-white px-4 py-3" onPress={() => setWalkingOnly((value) => !value)}><Text className="text-sm font-bold text-barrio-ink">Solo a pie · menos de 1 km</Text><View className={`h-8 w-14 justify-center rounded-full px-1 ${walkingOnly ? 'items-end bg-barrio-green' : 'items-start bg-[#9AA39E]'}`}><View className="h-6 w-6 rounded-full bg-white" /></View></Pressable>
            {swaps.map((swap) => <View key={swap.id} className="gap-2 rounded-3xl border border-barrio-border bg-white p-4"><View className="flex-row flex-wrap gap-2"><View className={`rounded-lg px-2 py-1 ${swap.kind === 'need' ? 'bg-amber-50' : 'bg-barrio-green-soft'}`}><Text className={`text-xs font-bold ${swap.kind === 'need' ? 'text-amber-900' : 'text-barrio-green-dark'}`}>{swap.kind === 'need' ? 'Necesito' : 'Ofrezco'}</Text></View>{swap.urgent ? <View className="rounded-lg bg-red-100 px-2 py-1"><Text className="text-xs font-bold text-red-800">Urgente</Text></View> : null}<View className="rounded-lg bg-barrio-canvas px-2 py-1"><Text className="text-xs font-semibold text-barrio-muted">Aprox. {distanceLabel(swap.distance_m)}</Text></View></View><Text className="text-base font-extrabold text-barrio-ink">{swap.title}</Text><Text className="text-sm leading-5 text-barrio-muted">{swap.details || 'Sin detalles.'}</Text><Text className="text-xs text-barrio-muted">Publicado por {swap.author}</Text><Pressable accessibilityRole="button" className="min-h-12 items-center justify-center rounded-2xl bg-barrio-green px-4" onPress={() => void actOnSwap(swap, 'interest')}><Text className="font-bold text-white">{interestedIds.includes(swap.id) ? 'Datos de contacto mostrados arriba' : swap.kind === 'need' ? 'Quiero ayudar' : 'Me interesa'}</Text></Pressable><Pressable accessibilityRole="button" className="min-h-10 items-center justify-center" onPress={() => void actOnSwap(swap, 'report')}><Text className="text-sm font-semibold text-barrio-muted">{reportedIds.includes(swap.id) ? 'Reporte enviado' : 'Reportar publicación'}</Text></Pressable></View>)}
            {searchDone && !swaps.length ? <View className="rounded-2xl border border-barrio-border bg-white p-5"><Text className="text-center text-sm text-barrio-muted">No hay publicaciones activas en este radio.</Text></View> : null}
          </> : null}

          {tab === 'tools' ? <><Text className="text-sm leading-5 text-barrio-muted">Pide prestado herramientas e insumos compartidos por tu comunidad.</Text><Pressable accessibilityRole="button" className="min-h-12 items-center justify-center rounded-2xl bg-barrio-green-soft" onPress={() => openComposer('tool')}><Text className="font-extrabold text-barrio-green-dark">Compartir una herramienta</Text></Pressable>{tools.map((tool) => <View key={tool.id} className="gap-3 rounded-3xl border border-barrio-border bg-white p-4"><View className="flex-row items-center gap-3"><View className="h-12 w-12 items-center justify-center rounded-2xl bg-barrio-green-soft"><SymbolView name={{ ios: 'wrench.and.screwdriver.fill', android: 'handyman', web: 'handyman' }} tintColor="#155A43" size={22} /></View><View className="flex-1 gap-1"><Text className="text-base font-extrabold text-barrio-ink">{tool.name}</Text><Text className="text-sm text-barrio-muted">De {tool.owner}</Text><Text className={`self-start rounded-full px-3 py-1 text-xs font-bold ${tool.available ? 'bg-barrio-green-soft text-barrio-green-dark' : 'bg-barrio-canvas text-barrio-muted'}`}>{tool.available ? 'Disponible' : 'Prestada'}</Text></View></View>{tool.owner_id === currentUserId ? <Pressable accessibilityRole="button" className="min-h-11 items-center justify-center rounded-2xl bg-barrio-green-soft" onPress={() => void showToolRequests(tool)}><Text className="font-bold text-barrio-green-dark">{expandedToolId === tool.id ? 'Ocultar solicitudes' : 'Ver solicitudes'}</Text></Pressable> : <Pressable accessibilityRole="button" disabled={!tool.available || requestedToolIds.includes(tool.id)} className={`min-h-12 items-center justify-center rounded-2xl px-4 ${tool.available ? 'bg-barrio-green' : 'bg-barrio-canvas'}`} onPress={() => void requestTool(tool)}><Text className={`font-bold ${tool.available ? 'text-white' : 'text-barrio-muted'}`}>{requestedToolIds.includes(tool.id) ? 'Solicitud enviada' : tool.available ? 'Pedir prestada' : 'No disponible'}</Text></Pressable>}{expandedToolId === tool.id ? toolRequests.map((item) => <View key={item.id} className="flex-row items-center gap-2 rounded-xl bg-barrio-canvas p-3"><View className="flex-1"><Text className="font-bold text-barrio-ink">{item.borrower}</Text><Text className="text-xs text-barrio-muted">{item.status === 'pending' ? 'Solicitud pendiente' : item.status === 'accepted' ? 'Préstamo activo' : 'Devuelta'}</Text></View>{item.status === 'pending' ? <Pressable accessibilityRole="button" className="min-h-9 rounded-lg bg-barrio-green px-2" onPress={() => void updateToolRequest(item, 'accepted')}><Text className="text-xs font-bold text-white">Aceptar</Text></Pressable> : null}{item.status === 'accepted' ? <Pressable accessibilityRole="button" className="min-h-9 rounded-lg bg-barrio-green px-2" onPress={() => void updateToolRequest(item, 'returned')}><Text className="text-xs font-bold text-white">Marcar devuelta</Text></Pressable> : null}</View>) : null}</View>)}{!loading && !tools.length ? <View className="rounded-2xl border border-barrio-border bg-white p-5"><Text className="text-center text-sm text-barrio-muted">Todavía no hay herramientas compartidas en tu cuadrante.</Text></View> : null}</> : null}

          {tab === 'buys' ? <><Text className="text-sm leading-5 text-barrio-muted">Coordina pedidos con tus vecinos para alcanzar mejores precios.</Text><Pressable accessibilityRole="button" className="min-h-12 items-center justify-center rounded-2xl bg-barrio-green-soft" onPress={() => openComposer('purchase')}><Text className="font-extrabold text-barrio-green-dark">Organizar una compra</Text></Pressable>{purchases.map((purchase) => { const joined = joinedIds.includes(purchase.id); const progress = Math.min(100, Math.round((purchase.current / purchase.target) * 100)); return <View key={purchase.id} className="gap-3 rounded-3xl border border-barrio-border bg-white p-4"><Text className="text-base font-extrabold text-barrio-ink">{purchase.title}</Text><Text className="text-sm text-barrio-muted">{purchase.provider}</Text><Text className="font-bold text-green-800">{purchase.savings}</Text><View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: progress }} className="h-3 overflow-hidden rounded-full bg-barrio-green-soft"><View className="h-full rounded-full bg-barrio-green" style={{ width: `${progress}%` }} /></View><Text className="text-sm text-barrio-muted">{purchase.current} de {purchase.target} vecinos · vence {purchase.deadline}</Text><Pressable accessibilityRole="button" className={`min-h-12 items-center justify-center rounded-2xl px-4 ${joined ? 'bg-barrio-green-soft' : 'bg-barrio-green'}`} onPress={() => void toggleGroupPurchase(purchase)}><Text className={`font-bold ${joined ? 'text-barrio-green-dark' : 'text-white'}`}>{joined ? 'Ya participas · salir' : 'Unirme a la compra'}</Text></Pressable></View>; })}{!loading && !purchases.length ? <View className="rounded-2xl border border-barrio-border bg-white p-5"><Text className="text-center text-sm text-barrio-muted">Todavía no hay compras grupales activas.</Text></View> : null}</> : null}
        </ScrollView>
      </View>
      {composer ? <View className="absolute inset-0 z-20 justify-end bg-black/45"><Pressable accessibilityRole="button" accessibilityLabel="Cerrar" className="absolute inset-0" onPress={() => setComposer(null)} /><View className="mx-auto max-h-[92%] w-full max-w-[400px] gap-3 rounded-t-3xl bg-barrio-canvas px-5 pb-8 pt-4"><View className="flex-row items-center"><Text accessibilityRole="header" className="flex-1 text-xl font-extrabold text-barrio-ink">{composer === 'swap' ? 'Publicar ayuda' : composer === 'tool' ? 'Compartir herramienta' : 'Organizar compra grupal'}</Text><Pressable accessibilityRole="button" accessibilityLabel="Cerrar" className="h-11 w-11 items-center justify-center" onPress={() => setComposer(null)}><Text className="text-2xl">×</Text></Pressable></View>
        {composer === 'swap' ? <><View accessibilityRole="tablist" className="flex-row rounded-2xl bg-barrio-green-soft p-1">{(['offer', 'need'] as const).map((value) => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: kind === value }} className={`min-h-12 flex-1 items-center justify-center rounded-xl ${kind === value ? 'bg-barrio-green' : ''}`} onPress={() => setKind(value)}><Text className={`font-bold ${kind === value ? 'text-white' : 'text-barrio-green-dark'}`}>{value === 'offer' ? 'Ofrezco' : 'Necesito'}</Text></Pressable>)}</View><TextInput className="min-h-12 rounded-2xl border-2 border-barrio-border bg-white px-3 text-base" maxLength={150} onChangeText={setTitle} placeholder="¿Qué ofreces o necesitas?" value={title} /><TextInput className="min-h-24 rounded-2xl border-2 border-barrio-border bg-white px-3 py-3 text-base" multiline maxLength={2000} onChangeText={setDetails} placeholder="Cuéntanos un poco más" textAlignVertical="top" value={details} />{kind === 'need' ? <Pressable accessibilityRole="switch" accessibilityState={{ checked: urgent }} className="min-h-12 flex-row items-center justify-between" onPress={() => setUrgent((value) => !value)}><Text className="font-semibold">Marcar como urgente</Text><View className={`h-8 w-14 justify-center rounded-full px-1 ${urgent ? 'items-end bg-barrio-green' : 'items-start bg-[#9AA39E]'}`}><View className="h-6 w-6 rounded-full bg-white" /></View></Pressable> : null}<Pressable accessibilityRole="button" disabled={busy} className="min-h-14 items-center justify-center rounded-2xl bg-barrio-green" onPress={() => void submitSwap()}><Text className="font-extrabold text-white">{busy ? 'Publicando…' : 'Publicar'}</Text></Pressable></> : null}
        {composer === 'tool' ? <><TextInput className="min-h-12 rounded-2xl border-2 border-barrio-border bg-white px-3 text-base" maxLength={100} onChangeText={setTitle} placeholder="Nombre de la herramienta" value={title} /><Pressable accessibilityRole="button" disabled={busy} className="min-h-14 items-center justify-center rounded-2xl bg-barrio-green" onPress={() => void submitTool()}><Text className="font-extrabold text-white">{busy ? 'Publicando…' : 'Compartir'}</Text></Pressable></> : null}
        {composer === 'purchase' ? <><TextInput className="min-h-12 rounded-2xl border-2 border-barrio-border bg-white px-3 text-base" maxLength={150} onChangeText={setTitle} placeholder="Producto o pedido" value={title} /><TextInput className="min-h-12 rounded-2xl border-2 border-barrio-border bg-white px-3 text-base" maxLength={120} onChangeText={setProvider} placeholder="Proveedor" value={provider} /><TextInput className="min-h-12 rounded-2xl border-2 border-barrio-border bg-white px-3 text-base" maxLength={100} onChangeText={setSavings} placeholder="Ahorro estimado" value={savings} /><TextInput className="min-h-12 rounded-2xl border-2 border-barrio-border bg-white px-3 text-base" keyboardType="number-pad" onChangeText={setTarget} placeholder="Meta de participantes" value={target} /><TextInput className="min-h-12 rounded-2xl border-2 border-barrio-border bg-white px-3 text-base" onChangeText={setDeadline} placeholder="Fecha límite YYYY-MM-DD" value={deadline} /><Pressable accessibilityRole="button" disabled={busy} className="min-h-14 items-center justify-center rounded-2xl bg-barrio-green" onPress={() => void submitPurchase()}><Text className="font-extrabold text-white">{busy ? 'Creando…' : 'Crear compra'}</Text></Pressable></> : null}
        <Text className="text-center text-xs leading-4 text-barrio-muted">La participación requiere residencia validada en el mismo cuadrante.</Text>
      </View></View> : null}
    </AppShell>
  );
}
