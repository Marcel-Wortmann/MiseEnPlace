import { effect } from '@angular/core';
import { signalStore, withState, withMethods, withHooks, patchState } from '@ngrx/signals';

export type ThemeMode = 'system' | 'light' | 'dark';
const STORAGE_KEY = 'theme.mode';

interface ThemeState {
  mode: ThemeMode;
}

function readMode(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch { /* no-op */ }
  return 'system';
}

function applyTheme(mode: ThemeMode): void {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const actualDark = mode === 'dark' || (mode === 'system' && prefersDark);
  const root = document.documentElement;
  if (actualDark) root.classList.add('dark');
  else root.classList.remove('dark');
  // Update theme-color meta-tag for status bar
  const themeColor = actualDark ? '#25201c' : '#f8f6f3';
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', themeColor);
}

export const ThemeStore = signalStore(
  { providedIn: 'root' },
  withState<ThemeState>({ mode: readMode() }),
  withMethods((store) => ({
    setMode(mode: ThemeMode): void {
      localStorage.setItem(STORAGE_KEY, mode);
      patchState(store, { mode });
      applyTheme(mode);
    },
    init(): void {
      applyTheme(store.mode());
      // React to system changes when mode is 'system'
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      mql.addEventListener('change', () => {
        if (store.mode() === 'system') applyTheme('system');
      });
    },
  })),
);
