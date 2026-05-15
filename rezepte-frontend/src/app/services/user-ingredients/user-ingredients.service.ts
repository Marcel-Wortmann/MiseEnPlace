import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { UserIngredient } from '@shared/interfaces';

export interface UserIngredientPayload {
  name: string;
  aliases?: string[];
  kcalPer100g: number;
  defaultGramsPerPiece?: number | null;
}

export interface BarcodeLookup {
  name: string;
  brand: string | null;
  kcalPer100g: number | null;
  gramsPerPiece: number | null;
  barcode: string;
  productUrl: string;
}

@Injectable({ providedIn: 'root' })
export class UserIngredientsService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/api/my-ingredients`;

  findAll(): Observable<UserIngredient[]> {
    return this.http.get<UserIngredient[]>(this.base);
  }

  create(payload: UserIngredientPayload): Observable<UserIngredient> {
    return this.http.post<UserIngredient>(this.base, payload);
  }

  update(id: string, payload: Partial<UserIngredientPayload>): Observable<UserIngredient> {
    return this.http.patch<UserIngredient>(`${this.base}/${id}`, payload);
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }

  lookupBarcode(barcode: string): Observable<BarcodeLookup> {
    return this.http.get<BarcodeLookup>(`${this.base}/lookup`, { params: { barcode } });
  }
}
