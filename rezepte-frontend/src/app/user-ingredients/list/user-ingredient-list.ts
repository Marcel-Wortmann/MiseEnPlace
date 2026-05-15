import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import { UserIngredientsStore } from '../../store/UserIngredients/UserIngredients.store';
import { NotificationStore } from '../../store/Notification/Notification.store';

@Component({
  selector: 'app-user-ingredient-list',
  imports: [RouterLink, DecimalPipe],
  templateUrl: './user-ingredient-list.html',
  styleUrl: './user-ingredient-list.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserIngredientListComponent {
  readonly store = inject(UserIngredientsStore);
  private readonly notify = inject(NotificationStore);
  private readonly router = inject(Router);

  readonly deleteId = signal<string | null>(null);
  readonly deleting = signal(false);

  async ngOnInit(): Promise<void> {
    if (!this.store.loaded()) {
      try {
        await this.store.load();
      } catch (err) {
        this.notify.error('Konnte Vorrat nicht laden', (err as Error).message);
      }
    }
  }

  openDelete(id: string, event?: Event): void {
    event?.stopPropagation();
    this.deleteId.set(id);
  }
  cancelDelete(): void { this.deleteId.set(null); }

  async confirmDelete(): Promise<void> {
    const id = this.deleteId();
    if (!id) return;
    this.deleting.set(true);
    try {
      await this.store.remove(id);
      this.notify.success('Zutat gelöscht');
    } catch (err) {
      this.notify.error('Löschen fehlgeschlagen', (err as Error).message);
    } finally {
      this.deleting.set(false);
      this.deleteId.set(null);
    }
  }

  edit(id: string): void {
    this.router.navigate(['/vorrat', id, 'bearbeiten']);
  }
}
