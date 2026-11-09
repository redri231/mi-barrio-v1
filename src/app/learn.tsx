import { useCallback, useEffect, useMemo, useState } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';

import { AppText as Text } from '@/components/app-text';
import { AppShell } from '@/components/app-shell';
import { protocols, tutorials, type LearnLesson } from '@/features/learn/data/lessons';
import { savedLessonsStorage } from '@/features/learn/data/saved-lessons-storage';
import { tutorialsApi, type RemoteTutorial } from '@/features/learn/data/tutorials-api';
import { authStorage } from '@/features/auth/data/auth-storage';

type LearnTab = 'tutorials' | 'protocols';

export default function LearnScreen() {
  const [tab, setTab] = useState<LearnTab>('tutorials');
  const [selectedLesson, setSelectedLesson] = useState<LearnLesson | null>(null);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [cachedLessons, setCachedLessons] = useState<LearnLesson[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [remoteLessons, setRemoteLessons] = useState<LearnLesson[]>([]);
  const [remoteIds, setRemoteIds] = useState<string[]>([]);
  const [accessToken, setAccessToken] = useState('');
  const [createGuideOpen, setCreateGuideOpen] = useState(false);
  const [guideTitle, setGuideTitle] = useState('');
  const [guideDuration, setGuideDuration] = useState('5');
  const [guideSteps, setGuideSteps] = useState('');
  const [savingGuide, setSavingGuide] = useState(false);

  const loadSavedLessons = useCallback(async () => {
    try {
      const localSaved = await savedLessonsStorage.getLessons();
      setCachedLessons(localSaved);
      setSavedIds(localSaved.map((lesson) => lesson.id));
      setRemoteLessons(localSaved);
      const session = await authStorage.getSession();
      if (!session) { router.replace('/'); return; }
      setAccessToken(session.accessToken);
      const response = await tutorialsApi.list(session.accessToken);
      const mapped = response.data.map((lesson: RemoteTutorial): LearnLesson => ({
        id: lesson.id,
        title: lesson.title,
        duration: lesson.duration,
        author: lesson.author,
        source: lesson.is_official_protocol ? 'Protocolo oficial del barrio' : undefined,
        steps: lesson.steps.map((step) => typeof step === 'string' ? step : (step && typeof step === 'object' && 'text' in step && typeof step.text === 'string' ? step.text : '')).filter(Boolean),
      }));
      setRemoteLessons([...mapped, ...localSaved.filter((lesson) => !mapped.some((remote) => remote.id === lesson.id))]);
      setRemoteIds(mapped.map((lesson) => lesson.id));
      const allSaved = [...new Set([...localSaved.map((lesson) => lesson.id), ...response.data.filter((lesson) => lesson.saved).map((lesson) => lesson.id)])];
      setSavedIds(allSaved);
    } catch {
      setStorageError('Mostramos las guías guardadas localmente. Las guías comunitarias nuevas requieren conexión.');
    } finally {
      setStorageReady(true);
    }
  }, []);

  useEffect(() => {
    // Saved items are read asynchronously from local storage.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSavedLessons();
  }, [loadSavedLessons]);

  const lessons = useMemo(() => tab === 'tutorials' ? [...remoteLessons.filter((lesson) => !lesson.source), ...tutorials] : [...remoteLessons.filter((lesson) => lesson.source), ...protocols], [remoteLessons, tab]);

  const toggleSaved = async (lesson: LearnLesson) => {
    const isSaved = savedIds.includes(lesson.id);
    const nextIds = isSaved ? savedIds.filter((id) => id !== lesson.id) : [...savedIds, lesson.id];
    const nextCachedLessons = isSaved ? cachedLessons.filter((item) => item.id !== lesson.id) : [...cachedLessons.filter((item) => item.id !== lesson.id), lesson];
    setSavedIds(nextIds);
    setCachedLessons(nextCachedLessons);
    setStorageError('');
    try {
      if (remoteIds.includes(lesson.id)) {
        const nextRemote = remoteIds.includes(lesson.id) ? remoteIds.filter((id) => id !== lesson.id) : [...remoteIds, lesson.id];
        await tutorialsApi.save(accessToken, lesson.id, !isSaved);
        setRemoteIds(nextRemote);
      }
      await savedLessonsStorage.saveLessons(nextCachedLessons);
    } catch {
      setSavedIds(savedIds);
      setCachedLessons(cachedLessons);
      setStorageError('No pudimos guardar este contenido en el dispositivo. Inténtalo nuevamente.');
    }
  };

  const submitGuide = async () => {
    const steps = guideSteps.split('\n').map((step) => step.trim()).filter(Boolean);
    const duration = Number(guideDuration);
    if (guideTitle.trim().length < 4 || !Number.isInteger(duration) || duration < 1 || steps.length < 2) {
      setStorageError('Escribe un título, una duración válida y al menos dos pasos.');
      return;
    }
    if (!accessToken || savingGuide) return;
    setSavingGuide(true); setStorageError('');
    try {
      const result = await tutorialsApi.create(accessToken, { title: guideTitle.trim(), duration_minutes: duration, steps });
      const tutorial: LearnLesson = {
        id: result.tutorial.id, title: result.tutorial.title, duration: result.tutorial.duration,
        author: result.tutorial.author, steps: result.tutorial.steps.filter((step): step is string => typeof step === 'string'),
      };
      setRemoteLessons((current) => [tutorial, ...current]);
      setRemoteIds((current) => [...current, tutorial.id]);
      setGuideTitle(''); setGuideDuration('5'); setGuideSteps(''); setCreateGuideOpen(false);
      setStorageError('Guía publicada en la comunidad.');
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : 'No pudimos publicar la guía.');
    } finally { setSavingGuide(false); }
  };

  return (
    <AppShell activeTab="learn">
      <View className="mx-auto w-full max-w-2xl flex-1">
        <ScrollView contentContainerClassName="gap-3 px-4 py-4 pb-8" showsVerticalScrollIndicator={false}>
          <View>
            <Text className="text-2xl font-bold text-barrio-ink">Aprendamos entre vecinos</Text>
            <Text className="mt-1 text-base leading-6 text-barrio-muted">
              Consejos prácticos para casa y pasos claros para cuidarnos.
            </Text>
          </View>

          <View accessibilityRole="tablist" className="flex-row rounded-2xl bg-white p-1">
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === 'tutorials' }}
              className={`min-h-12 flex-1 items-center justify-center rounded-xl px-2 ${tab === 'tutorials' ? 'bg-barrio-green' : ''}`}
              onPress={() => {
                setTab('tutorials');
                setSelectedLesson(null);
              }}>
              <Text className={`text-center text-sm font-bold ${tab === 'tutorials' ? 'text-white' : 'text-barrio-muted'}`}>
                Guías prácticas
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === 'protocols' }}
              className={`min-h-12 flex-1 items-center justify-center rounded-xl px-2 ${tab === 'protocols' ? 'bg-barrio-green' : ''}`}
              onPress={() => {
                setTab('protocols');
                setSelectedLesson(null);
              }}>
              <Text className={`text-center text-sm font-bold ${tab === 'protocols' ? 'text-white' : 'text-barrio-muted'}`}>
                Qué hacer si…
              </Text>
            </Pressable>
          </View>

          {tab === 'tutorials' ? (
            <Text className="-mt-2 text-sm leading-5 text-barrio-muted">
              Guías escritas de la comunidad. Los pasos se publican y guardan en tu dispositivo.
            </Text>
              ) : (
            <Text className="-mt-2 text-sm leading-5 text-barrio-muted">
              Guarda estas pautas para consultarlas aunque no tengas conexión.
            </Text>
          )}

          {tab === 'tutorials' ? <Pressable accessibilityRole="button" className="min-h-12 items-center justify-center rounded-2xl bg-barrio-green-soft" onPress={() => setCreateGuideOpen(true)}><Text className="font-extrabold text-barrio-green-dark">Compartir una guía escrita</Text></Pressable> : null}

          {storageError ? (
            <Text accessibilityLiveRegion="polite" className="rounded-2xl bg-amber-50 px-4 py-3 text-sm leading-5 text-amber-950">
              {storageError}
            </Text>
          ) : null}

          {!storageReady ? (
            <View className="items-center py-8">
              <ActivityIndicator color="#1F7A5C" />
            </View>
          ) : lessons.map((lesson) => {
            const isSaved = savedIds.includes(lesson.id);
            const isTutorial = Boolean(lesson.duration);
            return (
              <Pressable
                key={lesson.id}
                accessibilityRole="button"
                accessibilityLabel={`${lesson.title}${isSaved ? ', guardado en el teléfono' : ''}`}
                className="flex-row items-center gap-3 rounded-3xl border border-barrio-border bg-white p-4 active:bg-barrio-green-soft"
                onPress={() => setSelectedLesson(lesson)}>
                <View className={`h-12 w-12 items-center justify-center rounded-2xl ${isTutorial ? 'bg-barrio-green-soft' : 'bg-amber-50'}`}>
                  <Text accessibilityElementsHidden className={`text-2xl font-bold ${isTutorial ? 'text-barrio-green' : 'text-amber-800'}`}>
                    {isTutorial ? '✓' : '!'}
                  </Text>
                </View>
                <View className="flex-1 gap-1">
                  <Text className="text-base font-bold leading-5 text-barrio-ink">{lesson.title}</Text>
                  {isTutorial ? (
                    <View className="flex-row flex-wrap gap-2">
                      <Text className="text-sm text-barrio-muted">{lesson.duration}</Text>
                      <Text className="text-sm text-barrio-muted">{lesson.author}</Text>
                    </View>
                  ) : (
                    <Text className="text-sm text-barrio-muted">
                      {isSaved ? 'Guardado en tu teléfono' : 'Toca para ver los pasos'}
                    </Text>
                  )}
                </View>
                <Text accessibilityElementsHidden className="text-2xl text-barrio-muted">›</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {selectedLesson ? (
        <View className="absolute inset-0 z-20 justify-end bg-black/40">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cerrar detalle"
            className="absolute inset-0"
            onPress={() => setSelectedLesson(null)}
          />
          <View className="w-full rounded-t-3xl bg-barrio-canvas px-5 pb-8 pt-5" style={{ maxHeight: '90%' }}>
            <View className="mb-4 flex-row items-start gap-3">
              <Text accessibilityRole="header" className="flex-1 text-xl font-bold text-barrio-ink">{selectedLesson.title}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Cerrar" className="min-h-11 min-w-11 items-center justify-center" onPress={() => setSelectedLesson(null)}>
                <Text className="text-2xl text-barrio-muted">×</Text>
              </Pressable>
            </View>

            <ScrollView contentContainerClassName="gap-3 pb-3" showsVerticalScrollIndicator={false}>
              {selectedLesson.duration ? <View className="rounded-2xl bg-barrio-green-soft px-4 py-3"><Text className="text-sm font-bold text-barrio-green-dark">Guía paso a paso · {selectedLesson.duration}</Text></View> : null}
              {selectedLesson.author ? (
                <Text className="text-sm text-barrio-muted">Compartido por {selectedLesson.author}</Text>
              ) : null}
              {selectedLesson.source ? (
                <Text className="text-xs leading-5 text-barrio-muted">{selectedLesson.source}</Text>
              ) : null}
              {selectedLesson.steps.map((step, index) => (
                <View key={`${selectedLesson.id}-${index}`} className="flex-row items-start gap-3 rounded-2xl bg-white p-4">
                  <View className="h-8 w-8 items-center justify-center rounded-full bg-barrio-green-soft">
                    <Text className="font-bold text-barrio-green">{index + 1}</Text>
                  </View>
                  <Text className="flex-1 pt-1 text-base leading-6 text-barrio-ink">{step}</Text>
                </View>
              ))}
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: savedIds.includes(selectedLesson.id) }}
                className={`mt-1 min-h-14 items-center justify-center rounded-2xl px-5 ${savedIds.includes(selectedLesson.id) ? 'border border-barrio-border bg-white' : 'bg-barrio-green'}`}
                onPress={() => void toggleSaved(selectedLesson)}>
                <Text className={`text-base font-bold ${savedIds.includes(selectedLesson.id) ? 'text-barrio-green' : 'text-white'}`}>
                  {savedIds.includes(selectedLesson.id) ? 'Guardado para usar sin internet' : 'Guardar para usar sin internet'}
                </Text>
              </Pressable>
              <Text className="px-2 text-center text-xs leading-5 text-barrio-muted">
                {storageReady ? 'Los protocolos incluidos están disponibles sin conexión; las guías guardadas se conservan en el dispositivo.' : 'Preparando el contenido guardado…'}
              </Text>
            </ScrollView>
          </View>
        </View>
      ) : null}
      {createGuideOpen ? <View className="absolute inset-0 z-30 justify-end bg-black/45"><Pressable accessibilityRole="button" accessibilityLabel="Cerrar formulario" className="absolute inset-0" onPress={() => setCreateGuideOpen(false)} /><View className="mx-auto max-h-[92%] w-full max-w-[400px] gap-3 rounded-t-3xl bg-barrio-canvas px-5 pb-8 pt-5"><View className="flex-row items-center"><Text accessibilityRole="header" className="flex-1 text-xl font-bold text-barrio-ink">Compartir una guía</Text><Pressable accessibilityRole="button" accessibilityLabel="Cerrar" onPress={() => setCreateGuideOpen(false)}><Text className="p-2 text-2xl text-barrio-muted">×</Text></Pressable></View><Text className="text-sm leading-5 text-barrio-muted">Las guías escritas requieren residencia validada. El modelo actual no almacena archivos de video.</Text><TextInput className="min-h-12 rounded-2xl border border-barrio-border bg-white px-3 text-base" maxLength={150} onChangeText={setGuideTitle} placeholder="Título de la guía" value={guideTitle} /><TextInput className="min-h-12 rounded-2xl border border-barrio-border bg-white px-3 text-base" keyboardType="number-pad" onChangeText={setGuideDuration} placeholder="Duración en minutos" value={guideDuration} /><TextInput className="min-h-28 rounded-2xl border border-barrio-border bg-white px-3 py-3 text-base" multiline onChangeText={setGuideSteps} placeholder={'Un paso por línea\nDescribe qué hacer con claridad'} textAlignVertical="top" value={guideSteps} /><Pressable accessibilityRole="button" disabled={savingGuide} className="min-h-14 items-center justify-center rounded-2xl bg-barrio-green" onPress={() => void submitGuide()}><Text className="font-bold text-white">{savingGuide ? 'Publicando…' : 'Publicar guía'}</Text></Pressable></View></View> : null}
    </AppShell>
  );
}
