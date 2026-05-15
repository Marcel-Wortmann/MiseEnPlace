import { inject } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import { FollowService } from '../../services/follow/follow.service';
import { NotificationStore } from '../Notification/Notification.store';
import { PublicUser, Recipe } from '@shared/interfaces';

interface State {
  following: PublicUser[];
  searchResults: PublicUser[];
  feed: Recipe[];
  loading: boolean;
}

const initial: State = { following: [], searchResults: [], feed: [], loading: false };

export const FollowStore = signalStore(
  { providedIn: 'root' },
  withState(initial),
  withMethods((store) => {
    const service = inject(FollowService);
    const notify = inject(NotificationStore);

    return {
      async loadFollowing(): Promise<void> {
        try {
          const following = await firstValueFrom(service.listFollowing());
          patchState(store, { following });
        } catch (err) {
          notify.error('Liste konnte nicht geladen werden', (err as Error).message);
        }
      },
      async loadFeed(): Promise<void> {
        patchState(store, { loading: true });
        try {
          const feed = await firstValueFrom(service.feed());
          patchState(store, { feed, loading: false });
        } catch (err) {
          patchState(store, { loading: false });
          notify.error('Feed konnte nicht geladen werden', (err as Error).message);
        }
      },
      async search(q: string): Promise<void> {
        if (q.trim().length < 2) {
          patchState(store, { searchResults: [] });
          return;
        }
        try {
          const results = await firstValueFrom(service.search(q));
          patchState(store, { searchResults: results });
        } catch {
          patchState(store, { searchResults: [] });
        }
      },
      async follow(user: PublicUser): Promise<void> {
        try {
          await firstValueFrom(service.follow(user.id));
          patchState(store, {
            searchResults: store.searchResults().map((u) =>
              u.id === user.id ? { ...u, isFollowing: true } : u,
            ),
            following: [...store.following().filter((u) => u.id !== user.id), { ...user, isFollowing: true }],
          });
          notify.success('Folgst jetzt', user.displayName ?? user.email);
        } catch (err) {
          notify.error('Folgen fehlgeschlagen', (err as Error).message);
        }
      },
      async unfollow(user: PublicUser): Promise<void> {
        try {
          await firstValueFrom(service.unfollow(user.id));
          patchState(store, {
            following: store.following().filter((u) => u.id !== user.id),
            searchResults: store.searchResults().map((u) =>
              u.id === user.id ? { ...u, isFollowing: false } : u,
            ),
          });
        } catch (err) {
          notify.error('Entfolgen fehlgeschlagen', (err as Error).message);
        }
      },
      async followRecipe(recipeId: string): Promise<void> {
        try {
          await firstValueFrom(service.followRecipe(recipeId));
          patchState(store, {
            feed: store.feed().map((r) => (r.id === recipeId ? { ...r, isFollowed: true } : r)),
          });
          notify.success('Rezept folgt');
        } catch (err) {
          notify.error('Folgen fehlgeschlagen', (err as Error).message);
        }
      },
      async unfollowRecipe(recipeId: string): Promise<void> {
        try {
          await firstValueFrom(service.unfollowRecipe(recipeId));
          patchState(store, {
            feed: store.feed().map((r) => (r.id === recipeId ? { ...r, isFollowed: false } : r)),
          });
        } catch (err) {
          notify.error('Entfolgen fehlgeschlagen', (err as Error).message);
        }
      },
      clearSearch(): void {
        patchState(store, { searchResults: [] });
      },
    };
  }),
);
