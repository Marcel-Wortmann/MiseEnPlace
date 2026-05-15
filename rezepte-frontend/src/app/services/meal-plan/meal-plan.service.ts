import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { DayNutrition, MealPlanEntry, UpsertMealPlanPayload } from '@shared/interfaces';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class MealPlanService {
  private http = inject(HttpClient);
  private base = `${environment.apiBaseUrl}/api/meal-plan`;

  findRange(from: string, to: string): Observable<MealPlanEntry[]> {
    return this.http.get<MealPlanEntry[]>(this.base, { params: { from, to } });
  }
  nutrition(from: string, to: string): Observable<DayNutrition[]> {
    return this.http.get<DayNutrition[]>(`${this.base}/nutrition`, { params: { from, to } });
  }
  upsert(payload: UpsertMealPlanPayload): Observable<MealPlanEntry> {
    return this.http.post<MealPlanEntry>(this.base, payload);
  }
}
