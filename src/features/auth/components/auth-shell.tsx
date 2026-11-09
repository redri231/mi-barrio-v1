import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';

import { PhoneFrame } from '@/components/phone-frame';

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <PhoneFrame>
      <SafeAreaView className="flex-1 bg-barrio-canvas" edges={['top', 'bottom']}>
        <ScrollView
          className="flex-1"
          contentContainerClassName="mx-auto min-h-full w-full max-w-[400px] justify-center gap-3 px-6 py-6"
          keyboardShouldPersistTaps="handled">
          <View className="items-center gap-1.5">
            <View className="h-[85px] w-[85px] items-center justify-center rounded-full bg-barrio-green">
              <SymbolView name={{ ios: 'house.fill', android: 'home', web: 'home' }} tintColor="#FFFFFF" size={44} />
            </View>
            <Text className="text-[27px] font-extrabold tracking-tight text-barrio-ink">Mi Barrio</Text>
            <Text className="text-center text-base leading-6 text-barrio-muted">
              Vecinos que se ayudan, se conocen y se cuidan.
            </Text>
          </View>
          <View className="gap-3">{children}</View>
          <Text className="px-3 text-center text-sm leading-5 text-barrio-muted">
            Tu número solo se usa para confirmar tu cuenta y no se muestra a otros vecinos.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </PhoneFrame>
  );
}
