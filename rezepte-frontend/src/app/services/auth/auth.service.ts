import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthResponse, AuthTokens, User } from '@shared/interfaces';

export interface RegisterPayload {
  email: string;
  username: string;
  password: string;
  displayName?: string;
}

export interface LoginPayload {
  email: string;
  password: string;
  totpCode?: string;
}

export type LoginResult = AuthResponse | { totpRequired: true; userId: string };

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/api/auth`;

  register(payload: RegisterPayload): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.baseUrl}/register`, payload);
  }

  login(payload: LoginPayload): Observable<LoginResult> {
    return this.http.post<LoginResult>(`${this.baseUrl}/login`, payload);
  }

  refresh(refreshToken: string): Observable<AuthTokens> {
    return this.http.post<AuthTokens>(`${this.baseUrl}/refresh`, { refreshToken });
  }

  logout(refreshToken: string): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/logout`, { refreshToken });
  }

  me(): Observable<User> {
    return this.http.get<User>(`${this.baseUrl}/me`);
  }

  updateProfile(displayName: string | null, username: string | null): Observable<User> {
    return this.http.patch<User>(`${this.baseUrl}/me`, { displayName, username });
  }

  changePassword(currentPassword: string, newPassword: string): Observable<void> {
    return this.http.patch<void>(`${this.baseUrl}/password`, { currentPassword, newPassword });
  }

  deleteAccount(): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/me`);
  }

  totpSetup(): Observable<{ secret: string; qrDataUrl: string; otpauthUrl: string }> {
    return this.http.post<{ secret: string; qrDataUrl: string; otpauthUrl: string }>(
      `${this.baseUrl}/totp/setup`, {},
    );
  }

  totpEnable(code: string): Observable<{ recoveryCodes: string[] }> {
    return this.http.post<{ recoveryCodes: string[] }>(`${this.baseUrl}/totp/enable`, { code });
  }

  totpDisable(password: string): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/totp/disable`, { password });
  }
}
