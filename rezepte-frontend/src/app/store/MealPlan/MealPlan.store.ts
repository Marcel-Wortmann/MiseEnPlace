import { computed, inject } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import { MealPlanService } from '../../services/meal-plan/meal-plan.service';
import { NotificationStore } from '../Notification/Notification.store';
import { MealPlanEntry, MealSlot, UpsertMealPlanPayload } from '@shared/interfaces';

interface State {
  items: MealPlanEntry[];
  loading: boolean;
  weekStart: string; // Monday ISO date
}

const monday = (d: Date): Date => {
  const x = new Date(d);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
};

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

const initialState: State = {
  items: [],
  loading: false,
  weekStart: isoDate(monday(new Date())),
};

export const MealPlanStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed((store) => ({
    weekDays: computed(() => {
      const start = new Date(store.weekStart());
      return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        return isoDate(d);
      });
    }),
    entriesByKey: computed(() => {
      const map = new Map<string, MealPlanEntry>();
      for (const e of store.items()) map.set(`${e.date}::${e.slot}`, e);
      return map;
    }),
  })),
  withMethods((store) => {
    const service = inject(MealPlanService);
    const notify = inject(NotificationStore);

    const loadWeek = async (): Promise<void> => {
      const start = new Date(store.weekStart());
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      patchState(store, { loading: true });
      try {
        const items = await firstValueFrom(service.findRange(isoDate(start), isoDate(end)));
        patchState(store, { items, loading: false });
      } catch (err) {
        patchState(store, { loading: false });
        notify.error('Wochenplan konnte nicht geladen werden', (err as Error).message);
      }
    };

    return {
      loadWeek,

      async setWeek(monday: string): Promise<void> {
        patchState(store, { weekStart: monday });
        await loadWeek();
      },

      async nextWeek(): Promise<void> {
        const d = new Date(store.weekStart());
        d.setDate(d.getDate() + 7);
        patchState(store, { weekStart: isoDate(d) });
        await loadWeek();
      },

      async prevWeek(): Promise<void> {
        const d = new Date(store.weekStart());
        d.setDate(d.getDate() - 7);
        patchState(store, { weekStart: isoDate(d) });
        await loadWeek();
      },

      async thisWeek(): Promise<void> {
        patchState(store, { weekStart: isoDate(monday(new Date())) });
        await loadWeek();
      },

      async upsert(payload: UpsertMealPlanPayload): Promise<void> {
        try {
          const updated = await firstValueFrom(service.upsert(payload));
          const existing = store.items().filter((e) => !(e.date === payload.date && e.slot === payload.slot));
          if (updated.id) {
            patchState(store, { items: [...existing, updated] });
          } else {
            patchState(store, { items: existing });
          }
        } catch (err) {
          notify.error('Eintrag konnte nicht gespeichert werden', (err as Error).message);
        }
      },

      async clear(date: string, slot: MealSlot): Promise<void> {
        await this.upsert({ date, slot, recipeId: null, customText: null });
      },
    };
  }),
);
