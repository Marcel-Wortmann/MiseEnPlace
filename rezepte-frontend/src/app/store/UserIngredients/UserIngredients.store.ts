import { computed, inject } from '@angular/core';
import { signalStore, withState, withMethods, withComputed, patchState } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import { UserIngredient } from '@shared/interfaces';
import { UserIngredientsService, UserIngredientPayload } from '../../services/user-ingredients/user-ingredients.service';

interface UserIngredientsState {
  items: UserIngredient[];
  loading: boolean;
  loaded: boolean;
}

export const UserIngredientsStore = signalStore(
  { providedIn: 'root' },
  withState<UserIngredientsState>({ items: [], loading: false, loaded: false }),
  withComputed((store) => ({
    count: computed(() => store.items().length),
  })),
  withMethods((store, service = inject(UserIngredientsService)) => ({
    async load(): Promise<void> {
      patchState(store, { loading: true });
      try {
        const items = await firstValueFrom(service.findAll());
        patchState(store, { items, loaded: true });
      } finally {
        patchState(store, { loading: false });
      }
    },

    async create(payload: UserIngredientPayload): Promise<UserIngredient> {
      const created = await firstValueFrom(service.create(payload));
      patchState(store, { items: [...store.items(), created].sort((a, b) => a.name.localeCompare(b.name)) });
      return created;
    },

    async update(id: string, payload: Partial<UserIngredientPayload>): Promise<UserIngredient> {
      const updated = await firstValueFrom(service.update(id, payload));
      patchState(store, {
        items: store.items().map((i) => (i.id === id ? updated : i)).sort((a, b) => a.name.localeCompare(b.name)),
      });
      return updated;
    },

    async remove(id: string): Promise<void> {
      await firstValueFrom(service.remove(id));
      patchState(store, { items: store.items().filter((i) => i.id !== id) });
    },
  })),
);
