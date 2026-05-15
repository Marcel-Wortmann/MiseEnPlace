import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Wine, WineRating, WineType } from '@shared/interfaces';

export interface CreateWinePayload {
  imagePath: string;
  imagePathBack: string | null;
  rating: WineRating | null;
  notes: string | null;
  name: string | null;
  vintage: number | null;
  region: string | null;
  country: string | null;
  grape: string | null;
  winery: string | null;
  wineType: WineType | null;
  description?: string | null;
  tastingNotes?: string | null;
  needsReview?: boolean;
}

export type UpdateWinePayload = Partial<CreateWinePayload>;

@Injectable({ providedIn: 'root' })
export class WinesService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/api/wines`;

  list(forceFresh = false): Observable<Wine[]> {
    const headers: Record<string, string> = forceFresh ? { 'ngsw-bypass': 'true' } : {};
    return this.http.get<Wine[]>(this.baseUrl, { headers }).pipe(catchError(this.toError));
  }

  get(id: string, forceFresh = false): Observable<Wine> {
    const headers: Record<string, string> = forceFresh ? { 'ngsw-bypass': 'true' } : {};
    return this.http.get<Wine>(`${this.baseUrl}/${id}`, { headers }).pipe(catchError(this.toError));
  }

  create(dto: CreateWinePayload): Observable<Wine> {
    return this.http.post<Wine>(this.baseUrl, dto).pipe(catchError(this.toError));
  }

  update(id: string, dto: UpdateWinePayload): Observable<Wine> {
    return this.http.patch<Wine>(`${this.baseUrl}/${id}`, dto).pipe(catchError(this.toError));
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`).pipe(catchError(this.toError));
  }

  retryAnalysis(id: string): Observable<Wine> {
    return this.http.post<Wine>(`${this.baseUrl}/${id}/retry-analysis`, {}).pipe(catchError(this.toError));
  }

  private toError(err: unknown): Observable<never> {
    if (err instanceof HttpErrorResponse) {
      const msg =
        err.error?.message ??
        (err.status === 0 ? 'Backend nicht erreichbar.' : `Fehler ${err.status}`);
      const wrapped = new Error(msg) as Error & { status?: number };
      wrapped.status = err.status;
      return throwError(() => wrapped);
    }
    return throwError(() => err);
  }
}
