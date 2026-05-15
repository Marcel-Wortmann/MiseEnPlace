import { inject } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import {
  CreateRecipeIdeaPayload,
  RecipeIdeasService,
  UpdateRecipeIdeaPayload,
} from '../../services/recipe-ideas/recipe-ideas.service';
import { NotificationStore } from '../Notification/Notification.store';
import { RecipeIdea } from '@shared/interfaces';

interface RecipeIdeasState {
  items: RecipeIdea[];
  loading: boolean;
  error: string | null;
}

const initialState: RecipeIdeasState = {
  items: [],
  loading: false,
  error: null,
};

export const RecipeIdeasStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withMethods((store) => {
    const ideasService = inject(RecipeIdeasService);
    const notify = inject(NotificationStore);

    return {
      async loadAll(): Promise<void> {
        const hasCached = store.items().length > 0;
        if (!hasCached) patchState(store, { loading: true, error: null });
        try {
          const items = await firstValueFrom(ideasService.loadAll());
          patchState(store, { items, loading: false });
        } catch (err) {
          patchState(store, { loading: false, error: (err as Error).message });
          if (!hasCached) notify.error('Rezeptideen konnten nicht geladen werden');
        }
      },

      async create(dto: CreateRecipeIdeaPayload): Promise<RecipeIdea | null> {
        try {
          const idea = await firstValueFrom(ideasService.create(dto));
          patchState(store, { items: [idea, ...store.items()] });
          notify.success('Idee gespeichert');
          return idea;
        } catch (err) {
          notify.error('Idee konnte nicht gespeichert werden', (err as Error).message);
          return null;
        }
      },

      async update(id: string, dto: UpdateRecipeIdeaPayload): Promise<RecipeIdea | null> {
        const old = store.items();
        patchState(store, { items: old.map((i) => (i.id === id ? { ...i, ...dto } as RecipeIdea : i)) });
        try {
          const updated = await firstValueFrom(ideasService.update(id, dto));
          patchState(store, {
            items: store.items().map((i) => (i.id === id ? updated : i)),
          });
          notify.success('Idee aktualisiert');
          return updated;
        } catch (err) {
          patchState(store, { items: old });
          notify.error('Idee konnte nicht aktualisiert werden', (err as Error).message);
          return null;
        }
      },

      async delete(id: string): Promise<boolean> {
        const old = store.items();
        patchState(store, { items: old.filter((i) => i.id !== id) });
        try {
          await firstValueFrom(ideasService.delete(id));
          notify.success('Idee gelöscht');
          firstValueFrom(ideasService.loadAll(true))
            .then((items) => patchState(store, { items }))
            .catch(() => undefined);
          return true;
        } catch (err) {
          const status = (err as { status?: number })?.status;
          if (status === 404) {
            firstValueFrom(ideasService.loadAll(true))
              .then((items) => patchState(store, { items }))
              .catch(() => undefined);
            return true;
          }
          patchState(store, { items: old });
          notify.error('Idee konnte nicht gelöscht werden', (err as Error).message);
          return false;
        }
      },

      findById(id: string): RecipeIdea | undefined {
        return store.items().find((i) => i.id === id);
      },
    };
  }),
);
