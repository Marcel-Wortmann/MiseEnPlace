import { computed, inject } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import {
  CreateRecipePayload,
  RecipesService,
  UpdateRecipePayload,
} from '../../services/recipes/recipes.service';
import { FollowService } from '../../services/follow/follow.service';
import { NotificationStore } from '../Notification/Notification.store';
import { EMPTY_RECIPE_FILTER, Recipe, RecipeFilter } from '@shared/interfaces';

interface RecipesState {
  items: Recipe[];
  loading: boolean;
  error: string | null;
  filter: RecipeFilter;
}

const initialState: RecipesState = {
  items: [],
  loading: false,
  error: null,
  filter: EMPTY_RECIPE_FILTER,
};

export const RecipesStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed((store) => ({
    filteredItems: computed(() => {
      const filter = store.filter();
      const search = filter.search?.trim().toLowerCase() ?? '';
      const filtered = store.items().filter((recipe) => {
        if (search) {
          const ingredientsHay = recipe.ingredients.map((i) => i.name).join(' ');
          const stepsHay = recipe.steps.map((s) => s.text).join(' ');
          const haystack = `${recipe.title} ${recipe.description ?? ''} ${recipe.tags.join(' ')} ${ingredientsHay} ${stepsHay}`.toLowerCase();
          if (!haystack.includes(search)) {
            return false;
          }
        }
        if (filter.maxDurationMinutes !== null) {
          if (recipe.durationMinutes === null || recipe.durationMinutes > filter.maxDurationMinutes) {
            return false;
          }
        }
        if (filter.difficulty !== null && recipe.difficulty !== filter.difficulty) {
          return false;
        }
        if (filter.minRating !== null) {
          if (recipe.rating === null || recipe.rating < filter.minRating) {
            return false;
          }
        }
        if (filter.tags.length > 0) {
          const hasAll = filter.tags.every((t) => recipe.tags.includes(t));
          if (!hasAll) {
            return false;
          }
        }
        if (filter.favoritesOnly && !recipe.isFavorite) {
          return false;
        }
        return true;
      });
      // Favoriten zuerst, dann nach Datum
      return [...filtered].sort((a, b) => {
        if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
        return b.createdAt.localeCompare(a.createdAt);
      });
    }),
    allTags: computed(() => {
      const set = new Set<string>();
      for (const recipe of store.items()) {
        for (const tag of recipe.tags) {
          set.add(tag);
        }
      }
      return Array.from(set).sort((a, b) => a.localeCompare(b, 'de'));
    }),
    isFilterActive: computed(() => {
      const f = store.filter();
      return Boolean(
        f.search ||
          f.maxDurationMinutes !== null ||
          f.difficulty !== null ||
          f.minRating !== null ||
          f.tags.length > 0,
      );
    }),
  })),
  withMethods((store) => {
    const recipesService = inject(RecipesService);
    const followService = inject(FollowService);
    const notify = inject(NotificationStore);

    return {
      async loadAll(): Promise<void> {
        const hasCached = store.items().length > 0;
        if (!hasCached) patchState(store, { loading: true, error: null });
        try {
          const items = await firstValueFrom(recipesService.loadAll());
          patchState(store, { items, loading: false });
        } catch (err) {
          patchState(store, { loading: false, error: (err as Error).message });
          if (!hasCached) notify.error('Rezepte konnten nicht geladen werden');
        }
      },

      async create(dto: CreateRecipePayload): Promise<Recipe | null> {
        try {
          const recipe = await firstValueFrom(recipesService.create(dto));
          patchState(store, { items: [recipe, ...store.items()] });
          notify.success('Rezept angelegt', recipe.title);
          return recipe;
        } catch (err) {
          notify.error('Rezept konnte nicht angelegt werden', (err as Error).message);
          return null;
        }
      },

      async createFromImage(file: File, hints?: { title?: string | null; description?: string | null }): Promise<Recipe | null> {
        try {
          const recipe = await firstValueFrom(recipesService.createFromImage(file, hints));
          patchState(store, { items: [recipe, ...store.items()] });
          notify.success('Rezept wird analysiert', 'KI läuft im Hintergrund.');
          return recipe;
        } catch (err) {
          notify.error('Rezept konnte nicht angelegt werden', (err as Error).message);
          return null;
        }
      },

      async createFromUrlAsync(url: string): Promise<Recipe | null> {
        // Calls the from-url endpoint; only used when async path was triggered server-side.
        // For sync (JSON-LD) the form fills itself with the draft and uses regular create.
        try {
          const result = await firstValueFrom(recipesService.createFromUrl(url));
          if (result.mode === 'async') {
            patchState(store, { items: [result.recipe, ...store.items()] });
            notify.success('Rezept wird analysiert', 'KI läuft im Hintergrund.');
            return result.recipe;
          }
          // sync mode: caller handles the draft, no store update here
          return null;
        } catch (err) {
          notify.error('URL-Import fehlgeschlagen', (err as Error).message);
          return null;
        }
      },

      async update(id: string, dto: UpdateRecipePayload): Promise<Recipe | null> {
        const old = store.items();
        const optimistic = old.map((r) => (r.id === id ? { ...r, ...dto } as Recipe : r));
        patchState(store, { items: optimistic });
        try {
          const updated = await firstValueFrom(recipesService.update(id, dto));
          patchState(store, {
            items: store.items().map((r) => (r.id === id ? updated : r)),
          });
          notify.success('Rezept aktualisiert', updated.title);
          return updated;
        } catch (err) {
          patchState(store, { items: old });
          const e = err as { error?: { message?: string | string[] }; message?: string };
          const msg = Array.isArray(e?.error?.message)
            ? e.error.message.join(', ')
            : e?.error?.message || e?.message || 'Unbekannter Fehler';
          notify.error('Rezept konnte nicht aktualisiert werden', msg);
          return null;
        }
      },

      async delete(id: string): Promise<boolean> {
        const old = store.items();
        patchState(store, { items: old.filter((r) => r.id !== id) });
        try {
          await firstValueFrom(recipesService.delete(id));
          notify.success('Rezept gelöscht');
          firstValueFrom(recipesService.loadAll(true))
            .then((items) => patchState(store, { items }))
            .catch(() => undefined);
          return true;
        } catch (err) {
          const status = (err as { status?: number })?.status;
          if (status === 404) {
            firstValueFrom(recipesService.loadAll(true))
              .then((items) => patchState(store, { items }))
              .catch(() => undefined);
            return true;
          }
          patchState(store, { items: old });
          notify.error('Rezept konnte nicht gelöscht werden', (err as Error).message);
          return false;
        }
      },

      async toggleFavorite(id: string): Promise<void> {
        const recipe = store.items().find((r) => r.id === id);
        if (!recipe) return;
        const next = !recipe.isFavorite;
        // Optimistic
        patchState(store, {
          items: store.items().map((r) => (r.id === id ? { ...r, isFavorite: next } : r)),
        });
        try {
          await firstValueFrom(recipesService.update(id, { isFavorite: next } as UpdateRecipePayload));
        } catch {
          patchState(store, {
            items: store.items().map((r) => (r.id === id ? { ...r, isFavorite: !next } : r)),
          });
          notify.error('Favorit konnte nicht aktualisiert werden');
        }
      },

      async toggleFollowRecipe(id: string): Promise<void> {
        const recipe = store.items().find((r) => r.id === id);
        if (!recipe) return;
        const next = !recipe.isFollowed;
        patchState(store, {
          items: store.items().map((r) => (r.id === id ? { ...r, isFollowed: next } : r)),
        });
        try {
          if (next) {
            await firstValueFrom(followService.followRecipe(id));
            notify.success('Rezept folgt');
          } else {
            await firstValueFrom(followService.unfollowRecipe(id));
            // Aus eigener Liste entfernen, da nicht mehr gefolgt
            patchState(store, { items: store.items().filter((r) => r.id !== id) });
          }
        } catch {
          patchState(store, {
            items: store.items().map((r) => (r.id === id ? { ...r, isFollowed: !next } : r)),
          });
          notify.error('Aktion fehlgeschlagen');
        }
      },

      setFilter(patch: Partial<RecipeFilter>): void {
        patchState(store, { filter: { ...store.filter(), ...patch } });
      },

      toggleTagFilter(tag: string): void {
        const current = store.filter().tags;
        const next = current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag];
        patchState(store, { filter: { ...store.filter(), tags: next } });
      },

      resetFilter(): void {
        patchState(store, { filter: EMPTY_RECIPE_FILTER });
      },

      findById(id: string): Recipe | undefined {
        return store.items().find((r) => r.id === id);
      },
    };
  }),
);
