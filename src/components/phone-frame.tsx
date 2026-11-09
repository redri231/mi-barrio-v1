import type { ReactNode } from 'react';
import { Platform, View } from 'react-native';

export function PhoneFrame({ children, emergency = false }: { children: ReactNode; emergency?: boolean }) {
  const web = Platform.OS === 'web';

  return (
    <View
      className={web ? 'h-screen flex-1 items-center justify-center bg-[#E7E5DC] p-4' : 'flex-1 bg-barrio-canvas'}>
      <View
        className={web ? 'h-full max-h-[800px] w-full max-w-[400px] rounded-[34px] bg-[#1B2420] p-[10px] shadow-2xl' : 'w-full flex-1'}
        style={web ? { height: '100%' } : undefined}>
        <View
          className={`flex-1 overflow-hidden ${web ? 'rounded-[26px]' : 'rounded-[20px]'} ${emergency ? 'bg-[#FFF1E6]' : 'bg-barrio-canvas'}`}>
          {children}
        </View>
      </View>
    </View>
  );
}
