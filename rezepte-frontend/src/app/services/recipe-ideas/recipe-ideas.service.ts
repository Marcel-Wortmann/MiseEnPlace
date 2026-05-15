import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { RecipeIdea } from '@shared/interfaces';

export interface CreateRecipeIdeaPayload {
  title: string | null;
  note: string | null;
  imagePath: string | null;
}

export type UpdateRecipeIdeaPayload = Partial<CreateRecipeIdeaPayload>;

@Injectable({ providedIn: 'root' })
export class RecipeIdeasService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/api/recipe-ideas`;

  loadAll(forceFresh = false): Observable<RecipeIdea[]> {
    const headers: Record<string, string> = forceFresh ? { 'ngsw-bypass': 'true' } : {};
    return this.http.get<RecipeIdea[]>(this.baseUrl, { headers });
  }

  loadOne(id: string): Observable<RecipeIdea> {
    return this.http.get<RecipeIdea>(`${this.baseUrl}/${id}`);
  }

  create(dto: CreateRecipeIdeaPayload): Observable<RecipeIdea> {
    return this.http.post<RecipeIdea>(this.baseUrl, dto);
  }

  update(id: string, dto: UpdateRecipeIdeaPayload): Observable<RecipeIdea> {
    return this.http.patch<RecipeIdea>(`${this.baseUrl}/${id}`, dto);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }
}
