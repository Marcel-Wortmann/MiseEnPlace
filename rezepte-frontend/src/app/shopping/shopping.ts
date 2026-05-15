import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ShoppingStore } from '../store/Shopping/Shopping.store';
import { NotificationStore } from '../store/Notification/Notification.store';

@Component({
  selector: 'app-shopping',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './shopping.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShoppingComponent implements OnInit {
  readonly store = inject(ShoppingStore);
  private readonly notify = inject(NotificationStore);

  readonly newName = signal('');
  readonly newAmount = signal<string>('');
  readonly newUnit = signal('');
  readonly showClearAllConfirm = signal(false);

  async ngOnInit(): Promise<void> {
    if (this.store.totalCount() === 0) {
      await this.store.load();
    }
  }

  async addManual(): Promise<void> {
    const name = this.newName().trim();
    if (!name) return;
    const amountStr = this.newAmount().trim();
    const amount = amountStr ? Number(amountStr) : null;
    const unit = this.newUnit().trim() || null;
    const ok = await this.store.add({ name, amount: Number.isFinite(amount as number) ? amount : null, unit });
    if (ok) {
      this.newName.set('');
      this.newAmount.set('');
      this.newUnit.set('');
    }
  }

  async copyAsText(): Promise<void> {
    const text = this.store.asText();
    if (!text) {
      this.notify.info('Liste ist leer');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      this.notify.success('In Zwischenablage kopiert');
    } catch {
      this.notify.error('Kopieren fehlgeschlagen');
    }
  }

  async share(): Promise<void> {
    const text = this.store.asText();
    if (!text) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Einkaufsliste', text });
      } catch {
        // user cancelled
      }
    } else {
      this.copyAsText();
    }
  }

  async confirmClearAll(): Promise<void> {
    await this.store.clearAll();
    this.showClearAllConfirm.set(false);
  }
}
