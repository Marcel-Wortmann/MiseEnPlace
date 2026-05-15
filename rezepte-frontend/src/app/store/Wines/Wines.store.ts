import { computed, inject } from '@angular/core';
import { signalStore, withComputed, withMethods, withState, patchState } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import { Wine, WineRating, WineType } from '@shared/interfaces';
import {
  CreateWinePayload,
  UpdateWinePayload,
  WinesService,
} from '../../services/wines/wines.service';
import { NotificationStore } from '../Notification/Notification.store';

export interface WineFilter {
  rating: WineRating | null;
  wineType: WineType | null;
}

interface WinesState {
  items: Wine[];
  loading: boolean;
  error: string | null;
  filter: WineFilter;
}

const initialState: WinesState = {
  items: [],
  loading: false,
  error: null,
  filter: { rating: null, wineType: null },
};

const RATING_VALUE: Record<WineRating, number> = {
  schlecht: 1,
  okay: 2,
  gut: 3,
  sehr_gut: 4,
};
const ratingValue = (r: WineRating | null): number => (r ? RATING_VALUE[r] : 0);

export const WinesStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed((store) => {
    /**
     * Einmalige Partitionierung items+filter → { main, top, filterActive }.
     * Vermeidet 3 separate Iterationen + 2× Math.max(...spread) bei jedem Render.
     */
    const partitioned = computed(() => {
      const items = store.items();
      const f = store.filter();
      const filterActive = f.rating !== null || f.wineType !== null;

      const filtered = filterActive
        ? items.filter((w) => {
            if (f.rating !== null && w.rating !== f.rating) return false;
            if (f.wineType !== null && w.wineType !== f.wineType) return false;
            return true;
          })
        : items;

      // Nach Rating absteigend (sehr_gut → schlecht → null), bei Gleichstand neuere zuerst
      const sorted = [...filtered].sort((a, b) => {
        const diff = ratingValue(b.rating) - ratingValue(a.rating);
        if (diff !== 0) return diff;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });

      // Top-Rated nur ohne Filter und nur für Weine mit "sehr_gut" Bewertung
      if (filterActive) {
        return { main: sorted, top: [] as Wine[], filterActive };
      }
      const top = sorted.filter((w) => w.rating === 'sehr_gut').slice(0, 4);
      const topIds = new Set(top.map((w) => w.id));
      const main = sorted.filter((w) => !topIds.has(w.id));
      return { main, top, filterActive };
    });

    return {
      filteredItems: computed(() => {
        const items = store.items();
        const f = store.filter();
        return items.filter((w) => {
          if (f.rating !== null && w.rating !== f.rating) return false;
          if (f.wineType !== null && w.wineType !== f.wineType) return false;
          return true;
        });
      }),
      /** Hauptliste — ohne die Top-Rated wenn Top-Rated separat angezeigt werden */
      mainListItems: computed(() => partitioned().main),
      /** Alle Weine mit der höchsten Bewertung (auch mehr als 3 wenn gleichberechtigt) */
      topRated: computed(() => partitioned().top),
      isFilterActive: computed(() => partitioned().filterActive),
    };
  }),
  withMethods((store, service = inject(WinesService), notify = inject(NotificationStore)) => ({
    async loadAll(): Promise<void> {
      const hasCached = store.items().length > 0;
      // Stale-while-revalidate: wenn schon Daten da, nicht neu loading-flag setzen
      if (!hasCached) patchState(store, { loading: true, error: null });
      try {
        const items = await firstValueFrom(service.list());
        patchState(store, { items, loading: false });
      } catch (err) {
        const msg = (err as Error).message;
        patchState(store, { error: msg, loading: false });
        if (!hasCached) notify.error('Weine konnten nicht geladen werden', msg);
      }
    },

    findById(id: string): Wine | undefined {
      return store.items().find((w) => w.id === id);
    },

    async create(dto: CreateWinePayload): Promise<Wine | null> {
      try {
        const wine = await firstValueFrom(service.create(dto));
        patchState(store, { items: [wine, ...store.items()] });
        notify.success('Wein gespeichert', 'KI-Analyse läuft im Hintergrund.');
        return wine;
      } catch (err) {
        notify.error('Speichern fehlgeschlagen', (err as Error).message);
        return null;
      }
    },

    async update(id: string, dto: UpdateWinePayload, silent = false): Promise<Wine | null> {
      const old = store.items();
      patchState(store, {
        items: old.map((w) => (w.id === id ? { ...w, ...dto } as Wine : w)),
      });
      try {
        const wine = await firstValueFrom(service.update(id, dto));
        patchState(store, {
          items: store.items().map((w) => (w.id === id ? wine : w)),
        });
        if (!silent) notify.success('Wein aktualisiert');
        return wine;
      } catch (err) {
        patchState(store, { items: old });
        notify.error('Aktualisieren fehlgeschlagen', (err as Error).message);
        return null;
      }
    },

    async delete(id: string): Promise<boolean> {
      const old = store.items();
      patchState(store, { items: old.filter((w) => w.id !== id) });
      try {
        await firstValueFrom(service.remove(id));
        notify.success('Wein gelöscht');
        firstValueFrom(service.list(true))
          .then((items) => patchState(store, { items }))
          .catch(() => undefined);
        return true;
      } catch (err) {
        const status = (err as { status?: number })?.status;
        // 404 = bereits gelöscht — Liste revalidieren statt Eintrag wieder einblenden
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

    async retryAnalysis(id: string): Promise<Wine | null> {
      try {
        const wine = await firstValueFrom(service.retryAnalysis(id));
        patchState(store, { items: store.items().map((w) => (w.id === id ? wine : w)) });
        notify.success('Analyse neu gestartet');
        return wine;
      } catch (err) {
        notify.error('Erneuter Versuch fehlgeschlagen', (err as Error).message);
        return null;
      }
    },

    setFilter(partial: Partial<WineFilter>): void {
      patchState(store, { filter: { ...store.filter(), ...partial } });
    },

    resetFilter(): void {
      patchState(store, { filter: { rating: null, wineType: null } });
    },
  })),
);
