import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { CaloriesEstimate, RecipeIngredient } from '@shared/interfaces';

@Injectable({ providedIn: 'root' })
export class AiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/api/ai`;

  estimateCalories(payload: {
    ingredients: RecipeIngredient[];
    servings?: number | null;
    title?: string | null;
  }): Observable<CaloriesEstimate> {
    return this.http
      .post<CaloriesEstimate>(`${this.baseUrl}/estimate-calories`, payload)
      .pipe(catchError((err) => this.toError(err)));
  }

  private toError(err: unknown): Observable<never> {
    if (err instanceof HttpErrorResponse) {
      const msg =
        err.error?.message ??
        (err.status === 0
          ? 'Backend nicht erreichbar.'
          : `Fehler ${err.status}: ${err.statusText}`);
      return throwError(() => new Error(msg));
    }
    return throwError(() => err);
  }
}
