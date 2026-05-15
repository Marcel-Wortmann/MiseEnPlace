import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  ShoppingListItem,
  CreateShoppingItemDto,
  UpdateShoppingItemDto,
  AddRecipeToShoppingListDto,
} from '@shared/interfaces';

@Injectable({ providedIn: 'root' })
export class ShoppingService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/shopping';

  list(): Observable<ShoppingListItem[]> {
    return this.http.get<ShoppingListItem[]>(this.base);
  }
  add(dto: CreateShoppingItemDto): Observable<ShoppingListItem> {
    return this.http.post<ShoppingListItem>(this.base, dto);
  }
  addFromRecipe(dto: AddRecipeToShoppingListDto): Observable<ShoppingListItem[]> {
    return this.http.post<ShoppingListItem[]>(`${this.base}/from-recipe`, dto);
  }
  addFromPlan(from: string, to: string): Observable<ShoppingListItem[]> {
    return this.http.post<ShoppingListItem[]>(`${this.base}/from-plan`, { from, to });
  }
  update(id: string, dto: UpdateShoppingItemDto): Observable<ShoppingListItem> {
    return this.http.patch<ShoppingListItem>(`${this.base}/${id}`, dto);
  }
  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }
  clearDone(): Observable<void> {
    return this.http.delete<void>(`${this.base}/done`);
  }
  clearAll(): Observable<void> {
    return this.http.delete<void>(`${this.base}/all`);
  }
}
