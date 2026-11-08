import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView className="flex-1 bg-barrio-canvas" edges={['top', 'bottom']}>
      <ScrollView
        className="flex-1"
        contentContainerClassName="mx-auto min-h-full w-full max-w-md justify-center px-6 py-8"
        keyboardShouldPersistTaps="handled">
        <View className="mb-9 items-center">
          <View className="mb-4 h-16 w-16 items-center justify-center rounded-[22px] bg-barrio-green">
            <Text accessibilityElementsHidden className="text-3xl text-white">⌂</Text>
          </View>
          <Text className="text-3xl font-extrabold tracking-tight text-barrio-ink">Mi Barrio</Text>
          <Text className="mt-2 text-center text-base leading-6 text-barrio-muted">
            Cerca de ti, hecho entre vecinos.
          </Text>
        </View>
        <View className="rounded-3xl border border-barrio-border bg-white p-6 shadow-sm">{children}</View>
        <Text className="mt-6 px-3 text-center text-sm leading-5 text-barrio-muted">
          Tu número solo se usa para confirmar tu cuenta y no se muestra a otros vecinos.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
