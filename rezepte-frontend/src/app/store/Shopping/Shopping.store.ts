import { computed, inject } from '@angular/core';
import { signalStore, withState, withMethods, withComputed, patchState } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import { ShoppingService } from '../../services/shopping/shopping.service';
import { ShoppingListItem, CreateShoppingItemDto, UpdateShoppingItemDto } from '@shared/interfaces';
import { NotificationStore } from '../Notification/Notification.store';

interface ShoppingState {
  items: ShoppingListItem[];
  loading: boolean;
}

export const ShoppingStore = signalStore(
  { providedIn: 'root' },
  withState<ShoppingState>({ items: [], loading: false }),
  withComputed((store) => ({
    pending: computed(() => store.items().filter((i) => !i.done)),
    done: computed(() => store.items().filter((i) => i.done)),
    pendingCount: computed(() => store.items().filter((i) => !i.done).length),
    totalCount: computed(() => store.items().length),
  })),
  withMethods((store, service = inject(ShoppingService), notify = inject(NotificationStore)) => ({
    async load() {
      patchState(store, { loading: true });
      try {
        const items = await firstValueFrom(service.list());
        patchState(store, { items, loading: false });
      } catch {
        patchState(store, { loading: false });
        notify.error('Einkaufsliste konnte nicht geladen werden');
      }
    },

    async add(dto: CreateShoppingItemDto): Promise<boolean> {
      try {
        const item = await firstValueFrom(service.add(dto));
        patchState(store, { items: [...store.items(), item] });
        return true;
      } catch {
        notify.error('Eintrag konnte nicht hinzugefügt werden');
        return false;
      }
    },

    async addFromRecipe(recipeId: string, servingsOverride?: number | null): Promise<boolean> {
      try {
        const newItems = await firstValueFrom(service.addFromRecipe({ recipeId, servingsOverride }));
        // Reload für korrekte Konsolidierung
        const fresh = await firstValueFrom(service.list());
        patchState(store, { items: fresh });
        notify.success(`${newItems.length} Zutat(en) zur Einkaufsliste hinzugefügt`);
        return true;
      } catch {
        notify.error('Rezept konnte nicht hinzugefügt werden');
        return false;
      }
    },

    async update(id: string, dto: UpdateShoppingItemDto): Promise<boolean> {
      const old = store.items();
      const optimistic = old.map((i) => (i.id === id ? { ...i, ...dto } as ShoppingListItem : i));
      patchState(store, { items: optimistic });
      try {
        const updated = await firstValueFrom(service.update(id, dto));
        patchState(store, { items: store.items().map((i) => (i.id === id ? updated : i)) });
        return true;
      } catch {
        patchState(store, { items: old });
        notify.error('Eintrag konnte nicht aktualisiert werden');
        return false;
      }
    },

    async toggleDone(id: string): Promise<void> {
      const item = store.items().find((i) => i.id === id);
      if (!item) return;
      await this.update(id, { done: !item.done });
    },

    async remove(id: string): Promise<boolean> {
      const old = store.items();
      patchState(store, { items: old.filter((i) => i.id !== id) });
      try {
        await firstValueFrom(service.remove(id));
        return true;
      } catch {
        patchState(store, { items: old });
        notify.error('Eintrag konnte nicht gelöscht werden');
        return false;
      }
    },

    async clearDone(): Promise<void> {
      try {
        await firstValueFrom(service.clearDone());
        patchState(store, { items: store.items().filter((i) => !i.done) });
      } catch {
        notify.error('Erledigte Einträge konnten nicht entfernt werden');
      }
    },

    async clearAll(): Promise<void> {
      try {
        await firstValueFrom(service.clearAll());
        patchState(store, { items: [] });
      } catch {
        notify.error('Einkaufsliste konnte nicht geleert werden');
      }
    },

    /** Konsolidiert Einträge mit gleichem name+unit für Anzeige (auch über Rezeptgrenzen) */
    consolidatedView(): { name: string; unit: string | null; amount: number | null; ids: string[]; sources: string[] }[] {
      const map = new Map<string, { name: string; unit: string | null; amount: number | null; ids: string[]; sources: Set<string> }>();
      for (const item of store.items()) {
        if (item.done) continue;
        const key = `${item.name.toLowerCase().trim()}|${(item.unit ?? '').toLowerCase().trim()}`;
        const existing = map.get(key);
        if (existing) {
          if (item.amount !== null) {
            existing.amount = (existing.amount ?? 0) + item.amount;
          }
          existing.ids.push(item.id);
          if (item.sourceRecipeTitle) existing.sources.add(item.sourceRecipeTitle);
        } else {
          map.set(key, {
            name: item.name,
            unit: item.unit,
            amount: item.amount,
            ids: [item.id],
            sources: new Set(item.sourceRecipeTitle ? [item.sourceRecipeTitle] : []),
          });
        }
      }
      return Array.from(map.values()).map((v) => ({
        name: v.name,
        unit: v.unit,
        amount: v.amount,
        ids: v.ids,
        sources: Array.from(v.sources),
      }));
    },

    /** Plain-Text Export für Copy/Share */
    asText(): string {
      const view = this.consolidatedView();
      return view
        .map((v) => {
          const qty = v.amount !== null ? `${v.amount}${v.unit ? ' ' + v.unit : ''} ` : '';
          return `- ${qty}${v.name}`;
        })
        .join('\n');
    },
  })),
);
