import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ShareInfo } from '@shared/interfaces';

export type ShareKind = 'recipes' | 'ideas' | 'wines';

export interface UserSearchHit {
  id: string;
  email: string;
  displayName: string | null;
}

// Backward-compat alias used by share-modal
export type UserSearchResult = UserSearchHit;

@Injectable({ providedIn: 'root' })
export class SharesService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/api/shares`;
  private readonly usersBase = `${environment.apiBaseUrl}/api/users`;

  getInfo(kind: ShareKind, id: string): Observable<ShareInfo> {
    return this.http.get<ShareInfo>(`${this.base}/${kind}/${id}`);
  }

  createLink(kind: ShareKind, id: string): Observable<{ shareToken: string }> {
    return this.http.post<{ shareToken: string }>(`${this.base}/${kind}/${id}/link`, {});
  }

  revokeLink(kind: ShareKind, id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${kind}/${id}/link`);
  }

  shareWithUser(kind: ShareKind, id: string, userId: string): Observable<void> {
    return this.http.post<void>(`${this.base}/${kind}/${id}/users`, { userId });
  }

  unshareWithUser(kind: ShareKind, id: string, userId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${kind}/${id}/users/${userId}`);
  }

  searchUsers(query: string): Observable<UserSearchHit[]> {
    return this.http.get<UserSearchHit[]>(`${this.usersBase}/search`, { params: { q: query } });
  }

  publicRecipe(token: string): Observable<unknown> {
    return this.http.get<unknown>(`${this.base}/public/recipes/${token}`);
  }
  publicIdea(token: string): Observable<unknown> {
    return this.http.get<unknown>(`${this.base}/public/ideas/${token}`);
  }
  publicWine(token: string): Observable<unknown> {
    return this.http.get<unknown>(`${this.base}/public/wines/${token}`);
  }

  // Backward-compat aliases
  getPublicRecipe(token: string): Observable<unknown> { return this.publicRecipe(token); }
  getPublicIdea(token: string): Observable<unknown> { return this.publicIdea(token); }
  getPublicWine(token: string): Observable<unknown> { return this.publicWine(token); }
}
