import { Text as NativeText, type TextProps } from 'react-native';

import { useAppState } from '@/components/app-state';

const NEXT_TEXT_SIZE: Record<string, string> = {
  'text-[10px]': 'text-xs',
  'text-[11px]': 'text-xs',
  'text-xs': 'text-sm',
  'text-sm': 'text-base',
  'text-base': 'text-lg',
  'text-lg': 'text-xl',
  'text-xl': 'text-2xl',
  'text-2xl': 'text-3xl',
  'text-3xl': 'text-4xl',
};

export function AppText({ className, ...props }: TextProps & { className?: string }) {
  const { largeText } = useAppState();
  const scaledClassName = largeText
    ? (className ?? '').replace(/text-\[(?:10|11)px\]|text-(?:xs|sm|base|lg|xl|2xl|3xl)(?![\w-])/g, (size) => NEXT_TEXT_SIZE[size] ?? size)
    : className;
  return <NativeText {...props} className={scaledClassName} />;
}
