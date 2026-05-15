import { Component, inject, input, output, signal, OnInit } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { SharesService, ShareKind, UserSearchResult } from '../../services/shares/shares.service';
import { NotificationStore } from '../../store/Notification/Notification.store';
import { ShareInfo } from '@shared/interfaces';

@Component({
  selector: 'app-share-modal',
  imports: [],
  templateUrl: './share-modal.html',
  styleUrl: './share-modal.css',
})
export class ShareModalComponent implements OnInit {
  readonly kind = input.required<ShareKind>();
  readonly entityId = input.required<string>();
  readonly close = output<void>();

  private readonly shares = inject(SharesService);
  private readonly notify = inject(NotificationStore);

  readonly info = signal<ShareInfo | null>(null);
  readonly loading = signal(true);
  readonly searchQuery = signal('');
  readonly searchResults = signal<UserSearchResult[]>([]);
  readonly searching = signal(false);
  readonly busy = signal(false);

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      const info = await firstValueFrom(this.shares.getInfo(this.kind(), this.entityId()));
      this.info.set(info);
    } catch {
      this.notify.error('Share-Info konnte nicht geladen werden');
    } finally {
      this.loading.set(false);
    }
  }

  shareUrl(): string {
    const token = this.info()?.shareToken;
    if (!token) return '';
    const base = window.location.origin;
    const path = this.kind() === 'recipes' ? 'rezept' : this.kind() === 'wines' ? 'wein' : 'idee';
    return `${base}/share/${path}/${token}`;
  }

  async createLink(): Promise<void> {
    this.busy.set(true);
    try {
      await firstValueFrom(this.shares.createLink(this.kind(), this.entityId()));
      await this.refresh();
      this.notify.success('Share-Link erstellt');
    } catch (err) {
      this.notify.error('Link konnte nicht erstellt werden', (err as Error).message);
    } finally {
      this.busy.set(false);
    }
  }

  async revokeLink(): Promise<void> {
    this.busy.set(true);
    try {
      await firstValueFrom(this.shares.revokeLink(this.kind(), this.entityId()));
      await this.refresh();
      this.notify.success('Link widerrufen');
    } catch (err) {
      this.notify.error('Link konnte nicht widerrufen werden', (err as Error).message);
    } finally {
      this.busy.set(false);
    }
  }

  async copyLink(): Promise<void> {
    const url = this.shareUrl();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      this.notify.success('Link kopiert');
    } catch {
      this.notify.error('Link konnte nicht kopiert werden');
    }
  }

  onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchQuery.set(value);
    this.runSearch(value);
  }

  private async runSearch(q: string): Promise<void> {
    if (q.trim().length < 2) {
      this.searchResults.set([]);
      return;
    }
    this.searching.set(true);
    try {
      const res = await firstValueFrom(this.shares.searchUsers(q));
      this.searchResults.set(res);
    } catch {
      this.searchResults.set([]);
    } finally {
      this.searching.set(false);
    }
  }

  async addUser(user: UserSearchResult): Promise<void> {
    this.busy.set(true);
    try {
      await firstValueFrom(this.shares.shareWithUser(this.kind(), this.entityId(), user.id));
      this.searchQuery.set('');
      this.searchResults.set([]);
      await this.refresh();
      this.notify.success('Geteilt mit ' + (user.displayName ?? user.email));
    } catch (err) {
      this.notify.error('Teilen fehlgeschlagen', (err as Error).message);
    } finally {
      this.busy.set(false);
    }
  }

  async removeUser(userId: string): Promise<void> {
    this.busy.set(true);
    try {
      await firstValueFrom(this.shares.unshareWithUser(this.kind(), this.entityId(), userId));
      await this.refresh();
      this.notify.success('Freigabe entfernt');
    } catch (err) {
      this.notify.error('Konnte nicht entfernt werden', (err as Error).message);
    } finally {
      this.busy.set(false);
    }
  }

  onClose(): void {
    this.close.emit();
  }
}
