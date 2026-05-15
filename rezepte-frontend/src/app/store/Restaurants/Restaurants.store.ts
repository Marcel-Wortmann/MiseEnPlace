import { computed, inject } from '@angular/core';
import { signalStore, withComputed, withMethods, withState, patchState } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import { CreateRestaurantPayload, Restaurant, RestaurantFilter, RestaurantRating, UpdateRestaurantPayload } from '@shared/interfaces';
import { RestaurantsService } from '../../services/restaurants/restaurants.service';
import { NotificationStore } from '../Notification/Notification.store';

interface RestaurantsState {
  items: Restaurant[];
  loading: boolean;
  filter: RestaurantFilter;
}

const initial: RestaurantsState = {
  items: [],
  loading: false,
  filter: { rating: null, cuisine: null },
};

export const RestaurantsStore = signalStore(
  { providedIn: 'root' },
  withState(initial),
  withComputed((store) => ({
    isFilterActive: computed(() => store.filter().rating !== null || store.filter().cuisine !== null),

    filteredItems: computed(() => {
      const f = store.filter();
      let items = store.items();
      if (f.rating) items = items.filter((r) => r.rating === f.rating);
      if (f.cuisine) items = items.filter((r) => r.cuisine === f.cuisine);
      return items;
    }),

    /** Top-bewertete Restaurants (rating gut oder sehr_gut) */
    topRated: computed(() => {
      const ratingValue = (r: RestaurantRating | null): number => {
        if (r === 'sehr_gut') return 4;
        if (r === 'gut') return 3;
        if (r === 'okay') return 2;
        if (r === 'schlecht') return 1;
        return 0;
      };
      const rated = store.items().filter((r) => r.rating !== null);
      if (rated.length === 0) return [];
      const max = Math.max(...rated.map((r) => ratingValue(r.rating)));
      if (max < 3) return [];
      return rated.filter((r) => ratingValue(r.rating) === max);
    }),
  })),
  withMethods((store, service = inject(RestaurantsService), notify = inject(NotificationStore)) => ({
    async load(): Promise<void> {
      const hasCached = store.items().length > 0;
      if (!hasCached) patchState(store, { loading: true });
      try {
        const items = await firstValueFrom(service.list());
        patchState(store, { items, loading: false });
      } catch (err) {
        if (!hasCached) notify.error('Restaurants laden fehlgeschlagen', (err as Error).message);
        patchState(store, { loading: false });
      }
    },

    findById(id: string): Restaurant | undefined {
      return store.items().find((r) => r.id === id);
    },

    async create(dto: CreateRestaurantPayload): Promise<Restaurant | null> {
      try {
        const r = await firstValueFrom(service.create(dto));
        patchState(store, { items: [r, ...store.items()] });
        notify.success('Restaurant gespeichert');
        return r;
      } catch (err) {
        notify.error('Speichern fehlgeschlagen', (err as Error).message);
        return null;
      }
    },

    async update(id: string, dto: UpdateRestaurantPayload): Promise<Restaurant | null> {
      const old = store.items();
      patchState(store, { items: old.map((x) => (x.id === id ? { ...x, ...dto } as Restaurant : x)) });
      try {
        const r = await firstValueFrom(service.update(id, dto));
        patchState(store, { items: store.items().map((x) => (x.id === id ? r : x)) });
        notify.success('Restaurant aktualisiert');
        return r;
      } catch (err) {
        patchState(store, { items: old });
        notify.error('Aktualisieren fehlgeschlagen', (err as Error).message);
        return null;
      }
    },

    async delete(id: string): Promise<boolean> {
      const old = store.items();
      patchState(store, { items: old.filter((r) => r.id !== id) });
      try {
        await firstValueFrom(service.remove(id));
        notify.success('Restaurant gelöscht');
        firstValueFrom(service.list(true))
          .then((items) => patchState(store, { items }))
          .catch(() => undefined);
        return true;
      } catch (err) {
        const status = (err as { status?: number })?.status;
        if (status === 404) {
          firstValueFrom(service.list(true))
            .then((items) => patchState(store, { items }))
            .catch(() => undefined);
          return true;
        }
        patchState(store, { items: old });
        notify.error('Löschen fehlgeschlagen', (err as Error).message);
        return false;
      }
    },

    setFilter(partial: Partial<RestaurantFilter>): void {
      patchState(store, { filter: { ...store.filter(), ...partial } });
    },

    resetFilter(): void {
      patchState(store, { filter: { rating: null, cuisine: null } });
    },
  })),
);
