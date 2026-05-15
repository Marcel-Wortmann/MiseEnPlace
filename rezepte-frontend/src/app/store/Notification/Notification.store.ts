import { computed } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';

export type NotificationType = 'success' | 'error' | 'info';

export interface Notification {
  id: number;
  type: NotificationType;
  title: string;
  message: string | null;
}

interface NotificationState {
  items: Notification[];
  nextId: number;
}

const initialState: NotificationState = {
  items: [],
  nextId: 1,
};

export const NotificationStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed((store) => ({
    hasItems: computed(() => store.items().length > 0),
  })),
  withMethods((store) => ({
    show(type: NotificationType, title: string, message: string | null = null): void {
      const id = store.nextId();
      const item: Notification = { id, type, title, message };
      patchState(store, {
        items: [...store.items(), item],
        nextId: id + 1,
      });
      setTimeout(() => {
        patchState(store, { items: store.items().filter((n) => n.id !== id) });
      }, 4000);
    },
    success(title: string, message: string | null = null): void {
      this.show('success', title, message);
    },
    error(title: string, message: string | null = null): void {
      this.show('error', title, message);
    },
    info(title: string, message: string | null = null): void {
      this.show('info', title, message);
    },
    dismiss(id: number): void {
      patchState(store, { items: store.items().filter((n) => n.id !== id) });
    },
  })),
);
