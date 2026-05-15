import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { PublicUser, Recipe } from '@shared/interfaces';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class FollowService {
  private http = inject(HttpClient);
  private base = `${environment.apiBaseUrl}/api/follow`;

  search(q: string): Observable<PublicUser[]> {
    return this.http.get<PublicUser[]>(`${this.base}/search`, { params: { q } });
  }
  listFollowing(): Observable<PublicUser[]> {
    return this.http.get<PublicUser[]>(`${this.base}/following`);
  }
  feed(): Observable<Recipe[]> {
    return this.http.get<Recipe[]>(`${this.base}/feed`);
  }
  follow(id: string): Observable<void> {
    return this.http.post<void>(`${this.base}/${id}`, {});
  }
  unfollow(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }
  followRecipe(id: string): Observable<void> {
    return this.http.post<void>(`${this.base}/recipe/${id}`, {});
  }
  unfollowRecipe(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/recipe/${id}`);
  }
}
