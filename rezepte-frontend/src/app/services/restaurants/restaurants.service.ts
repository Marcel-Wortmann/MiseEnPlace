import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { CreateRestaurantPayload, Restaurant, UpdateRestaurantPayload } from '@shared/interfaces';

@Injectable({ providedIn: 'root' })
export class RestaurantsService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api/restaurants';

  list(forceFresh = false): Observable<Restaurant[]> {
    const headers: Record<string, string> = forceFresh ? { 'ngsw-bypass': 'true' } : {};
    return this.http.get<Restaurant[]>(this.baseUrl, { headers });
  }

  get(id: string): Observable<Restaurant> {
    return this.http.get<Restaurant>(`${this.baseUrl}/${id}`);
  }

  create(dto: CreateRestaurantPayload): Observable<Restaurant> {
    return this.http.post<Restaurant>(this.baseUrl, dto);
  }

  update(id: string, dto: UpdateRestaurantPayload): Observable<Restaurant> {
    return this.http.patch<Restaurant>(`${this.baseUrl}/${id}`, dto);
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }

  suggestTags(payload: { name: string; cuisine?: string | null; notes?: string | null }): Observable<{ tags: string[] }> {
    return this.http.post<{ tags: string[] }>('/api/ai/suggest-restaurant-tags', payload);
  }
}
