import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { LearnLesson } from './lessons';

const SAVED_LESSONS_KEY = 'mibarrio.learn.saved.v2';

export const savedLessonsStorage = {
  async getLessons(): Promise<LearnLesson[]> {
    const value = Platform.OS === 'web'
      ? globalThis.localStorage?.getItem(SAVED_LESSONS_KEY) ?? null
      : await SecureStore.getItemAsync(SAVED_LESSONS_KEY);
    if (!value) return [];
    try {
      const lessons: unknown = JSON.parse(value);
      return Array.isArray(lessons) ? lessons.filter((lesson): lesson is LearnLesson => Boolean(lesson && typeof lesson === 'object' && typeof lesson.id === 'string' && typeof lesson.title === 'string' && Array.isArray(lesson.steps))) : [];
    } catch {
      return [];
    }
  },
  async saveLessons(lessons: LearnLesson[]) {
    const value = JSON.stringify(lessons);
    if (Platform.OS === 'web') {
      globalThis.localStorage?.setItem(SAVED_LESSONS_KEY, value);
      return;
    }
    await SecureStore.setItemAsync(SAVED_LESSONS_KEY, value);
  },
};
