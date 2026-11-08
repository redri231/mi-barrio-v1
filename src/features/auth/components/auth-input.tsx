import { Text, TextInput, View, type TextInputProps } from 'react-native';

type AuthInputProps = TextInputProps & {
  label: string;
  error?: string;
  leading?: string;
};

export function AuthInput({ label, error, leading, className, ...props }: AuthInputProps) {
  return (
    <View className="gap-2">
      <Text className="text-base font-semibold text-barrio-ink">{label}</Text>
      <View
        className={`min-h-14 flex-row items-center rounded-2xl border bg-white px-4 ${
          error ? 'border-red-600' : 'border-barrio-border focus-within:border-barrio-green'
        }`}>
        {leading ? <Text className="mr-3 text-base font-semibold text-barrio-muted">{leading}</Text> : null}
        <TextInput
          accessibilityLabel={label}
          className={`min-h-14 flex-1 py-3 text-lg text-barrio-ink ${className ?? ''}`}
          placeholderTextColor="#78847E"
          {...props}
        />
      </View>
      {error ? (
        <Text accessibilityLiveRegion="polite" className="text-sm font-medium text-red-700">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
