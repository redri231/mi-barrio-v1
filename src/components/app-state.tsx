import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

type NotificationPreferences = { offers: boolean; swaps: boolean; tutorials: boolean };

type AppState = {
  largeText: boolean;
  setLargeText: (value: boolean) => void;
  notificationPreferences: NotificationPreferences;
  setNotificationPreferences: (preferences: NotificationPreferences) => void;
};

const AppContext = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [largeText, setLargeText] = useState(false);
  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreferences>({ offers: true, swaps: true, tutorials: false });
  const value = useMemo(() => ({ largeText, setLargeText, notificationPreferences, setNotificationPreferences }), [largeText, notificationPreferences]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppState() {
  const state = useContext(AppContext);
  if (!state) throw new Error('useAppState must be used inside AppStateProvider.');
  return state;
}
