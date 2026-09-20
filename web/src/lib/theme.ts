// Light / dark mode. The person chooses "system" (follow the phone), "light" or "dark"; the choice is remembered on this
// device (localStorage, best effort). The page always carries data-theme="light" | "dark" on <html>, which the CSS tokens
// in index.css react to. public/theme-init.js sets it before the first paint (no flash); this module keeps it in sync
// afterwards (a new choice, or the phone's setting changing while "system" is selected). Keep the two in step.
import { useSyncExternalStore } from 'react';
import { safeGetItem, safeSetItem } from './storage';

export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'yk-theme';
/** The browser bar colour (<meta name="theme-color">) of each theme: the primary colour / the dark background. */
export const THEME_COLORS: Record<ResolvedTheme, string> = { light: '#0b6a9c', dark: '#0a1a24' };

export const THEME_MODES: readonly ThemeMode[] = ['system', 'light', 'dark'];
export const isThemeMode = (value: unknown): value is ThemeMode => THEME_MODES.includes(value as ThemeMode);

/** "system" follows the phone; the other two are absolute. */
export const resolveTheme = (mode: ThemeMode, systemPrefersDark: boolean): ResolvedTheme => (mode === 'system' ? (systemPrefersDark ? 'dark' : 'light') : mode);

/** The saved choice; anything missing or unknown means "system". */
export const readThemeMode = (): ThemeMode => {
  const saved = safeGetItem(THEME_STORAGE_KEY);
  return isThemeMode(saved) ? saved : 'system';
};

const systemQuery = (): MediaQueryList | null =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

/** Puts the resolved theme on <html> (and the browser bar colour). Returns what it applied. */
export function applyTheme(mode: ThemeMode): ResolvedTheme {
  const resolved = resolveTheme(mode, systemQuery()?.matches ?? false);
  document.documentElement.setAttribute('data-theme', resolved);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[resolved]);
  return resolved;
}

let current: ThemeMode = readThemeMode();
const listeners = new Set<() => void>();

export const getThemeMode = (): ThemeMode => current;

export function setThemeMode(next: ThemeMode): void {
  current = next;
  safeSetItem(THEME_STORAGE_KEY, next);
  applyTheme(next);
  listeners.forEach((listener) => listener());
}

let watching = false;
/** Call once at start-up: applies the saved choice and follows the phone's setting while "system" is selected. */
export function initTheme(): void {
  current = readThemeMode();
  applyTheme(current);
  if (watching) return;
  watching = true;
  systemQuery()?.addEventListener('change', () => {
    if (current === 'system') applyTheme('system');
  });
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The current choice and a way to change it; re-renders when it changes. */
export function useThemeMode(): [ThemeMode, (mode: ThemeMode) => void] {
  return [useSyncExternalStore(subscribe, getThemeMode, getThemeMode), setThemeMode];
}
