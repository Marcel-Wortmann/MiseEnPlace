import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ExtractedRecipeDraft, Recipe } from '@shared/interfaces';

export interface CreateRecipePayload {
  title: string;
  description: string | null;
  personalNotes?: string | null;
  imagePath: string | null;
  durationMinutes: number | null;
  difficulty: 'einfach' | 'mittel' | 'schwer' | null;
  rating: number | null;
  servings: number | null;
  caloriesPerServing: number | null;
  proteinPerServing: number | null;
  carbsPerServing: number | null;
  fatPerServing: number | null;
  isFavorite?: boolean;
  isPrivate?: boolean;
  tags: string[];
  ingredients: { name: string; amount: number | null; unit: string | null }[];
  steps: { order: number; text: string }[];
}

export type UpdateRecipePayload = Partial<CreateRecipePayload>;

export type CreateFromUrlResult =
  | { mode: 'sync'; draft: ExtractedRecipeDraft }
  | { mode: 'async'; recipe: Recipe };

@Injectable({ providedIn: 'root' })
export class RecipesService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/api/recipes`;

  loadAll(forceFresh = false): Observable<Recipe[]> {
    const headers: Record<string, string> = forceFresh ? { 'ngsw-bypass': 'true' } : {};
    return this.http.get<Recipe[]>(this.baseUrl, { headers });
  }

  loadOne(id: string): Observable<Recipe> {
    return this.http.get<Recipe>(`${this.baseUrl}/${id}`);
  }

  create(dto: CreateRecipePayload): Observable<Recipe> {
    return this.http.post<Recipe>(this.baseUrl, dto);
  }

  /**
   * Async pipeline: uploads image, server creates skeleton recipe with status 'pending',
   * vision analysis runs in the background. Returns the skeleton immediately.
   */
  createFromImage(file: File, hints?: { title?: string | null; description?: string | null }): Observable<Recipe> {
    const fd = new FormData();
    fd.append('image', file);
    if (hints?.title) fd.append('hintTitle', hints.title);
    if (hints?.description) fd.append('hintDescription', hints.description);
    return this.http.post<Recipe>(`${this.baseUrl}/from-image`, fd);
  }

  /**
   * Hybrid: server tries JSON-LD first (sync), falls back to async LLM otherwise.
   *  - mode 'sync': caller should fill form with draft
   *  - mode 'async': caller should redirect to list (skeleton recipe already created)
   */
  createFromUrl(url: string): Observable<CreateFromUrlResult> {
    return this.http.post<CreateFromUrlResult>(`${this.baseUrl}/from-url`, { url });
  }

  update(id: string, dto: UpdateRecipePayload): Observable<Recipe> {
    return this.http.patch<Recipe>(`${this.baseUrl}/${id}`, dto);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }

  suggestTags(payload: { title: string; description?: string | null; ingredients: { name: string }[]; steps: { text: string }[]; durationMinutes?: number | null }): Observable<{ tags: string[] }> {
    return this.http.post<{ tags: string[] }>('/api/ai/suggest-tags', payload);
  }
}
