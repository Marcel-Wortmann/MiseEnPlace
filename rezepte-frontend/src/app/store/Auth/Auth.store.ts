import { computed, inject } from '@angular/core';
import { signalStore, withState, withMethods, withComputed, patchState } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import { AuthService, LoginPayload, RegisterPayload } from '../../services/auth/auth.service';
import { AuthTokens, User } from '@shared/interfaces';

const ACCESS_KEY = 'auth.accessToken';
const REFRESH_KEY = 'auth.refreshToken';
const USER_KEY = 'auth.user';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  initialized: boolean;
}

function readInitial(): AuthState {
  try {
    const accessToken = localStorage.getItem(ACCESS_KEY);
    const refreshToken = localStorage.getItem(REFRESH_KEY);
    const userRaw = localStorage.getItem(USER_KEY);
    const user = userRaw ? (JSON.parse(userRaw) as User) : null;
    return { user, accessToken, refreshToken, initialized: !!accessToken && !!user };
  } catch {
    return { user: null, accessToken: null, refreshToken: null, initialized: false };
  }
}

export const AuthStore = signalStore(
  { providedIn: 'root' },
  withState<AuthState>(readInitial()),
  withComputed((store) => ({
    isAuthenticated: computed(() => !!store.accessToken() && !!store.user()),
  })),
  withMethods((store, service = inject(AuthService)) => ({
    async register(payload: RegisterPayload): Promise<boolean> {
      try {
        const res = await firstValueFrom(service.register(payload));
        persist(res.user, res.tokens);
        patchState(store, {
          user: res.user,
          accessToken: res.tokens.accessToken,
          refreshToken: res.tokens.refreshToken,
          initialized: true,
        });
        return true;
      } catch {
        return false;
      }
    },

    async login(payload: LoginPayload): Promise<{ ok: true } | { ok: false; totpRequired?: true }> {
      try {
        const res = await firstValueFrom(service.login(payload));
        if ('totpRequired' in res) {
          return { ok: false, totpRequired: true };
        }
        persist(res.user, res.tokens);
        patchState(store, {
          user: res.user,
          accessToken: res.tokens.accessToken,
          refreshToken: res.tokens.refreshToken,
          initialized: true,
        });
        return { ok: true };
      } catch {
        return { ok: false };
      }
    },

    async logout(): Promise<void> {
      const rt = store.refreshToken();
      if (rt) {
        try { await firstValueFrom(service.logout(rt)); } catch { /* ignore */ }
      }
      clearStorage();
      patchState(store, { user: null, accessToken: null, refreshToken: null, initialized: false });
    },

    setTokens(tokens: AuthTokens): void {
      localStorage.setItem(ACCESS_KEY, tokens.accessToken);
      localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
      patchState(store, { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
    },

    setUser(user: User): void {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      patchState(store, { user, initialized: true });
    },

    forceLogout(): void {
      clearStorage();
      patchState(store, { user: null, accessToken: null, refreshToken: null, initialized: false });
    },
  })),
);

function persist(user: User, tokens: AuthTokens): void {
  localStorage.setItem(ACCESS_KEY, tokens.accessToken);
  localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function clearStorage(): void {
  // Komplett alles entfernen — auch Caches/SW-Daten/Theme/Filter
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch { /* ignore */ }
}
