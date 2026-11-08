import { ActivityIndicator, Pressable, Text } from 'react-native';

type AuthButtonProps = {
  label: string;
  loading?: boolean;
  disabled?: boolean;
  onPress: () => void;
};

export function AuthButton({ label, loading = false, disabled = false, onPress }: AuthButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      className={`mt-2 min-h-14 flex-row items-center justify-center rounded-2xl px-5 ${
        disabled || loading ? 'bg-barrio-green/60' : 'bg-barrio-green active:bg-barrio-green-dark'
      }`}
      disabled={disabled || loading}
      onPress={onPress}>
      {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text className="text-lg font-bold text-white">{label}</Text>}
    </Pressable>
  );
}
