export interface User {
  id: string;
  email: string;
  displayName: string | null;
  username: string | null;
  totpEnabled: boolean;
  isAdmin: boolean;
  createdAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResponse {
  user: User;
  tokens: AuthTokens;
}
