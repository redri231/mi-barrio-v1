import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const PENDING_KEY = 'mibarrio.auth.pending';
const SESSION_KEY = 'mibarrio.auth.session';

export type PendingRegistration = { fullName?: string; phoneNumber: string };
export type StoredSession = {
  accessToken: string;
  refreshToken?: string;
  user: { id: string; fullName: string; phoneNumber: string };
};

async function read(key: string) {
  return Platform.OS === 'web' ? globalThis.sessionStorage?.getItem(key) ?? null : SecureStore.getItemAsync(key);
}

async function write(key: string, value: string) {
  if (Platform.OS === 'web') {
    globalThis.sessionStorage?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function remove(key: string) {
  if (Platform.OS === 'web') {
    globalThis.sessionStorage?.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export const authStorage = {
  async savePendingRegistration(value: PendingRegistration) {
    await write(PENDING_KEY, JSON.stringify(value));
  },
  async getPendingRegistration(): Promise<PendingRegistration | null> {
    const value = await read(PENDING_KEY);
    return value ? (JSON.parse(value) as PendingRegistration) : null;
  },
  clearPendingRegistration() {
    return remove(PENDING_KEY);
  },
  async saveSession(value: StoredSession) {
    await write(SESSION_KEY, JSON.stringify(value));
  },
  async getSession(): Promise<StoredSession | null> {
    const value = await read(SESSION_KEY);
    return value ? (JSON.parse(value) as StoredSession) : null;
  },
  clearSession() {
    return remove(SESSION_KEY);
  },
};
