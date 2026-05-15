import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { WinesStore } from '../../store/Wines/Wines.store';
import { UploadService } from '../../services/upload/upload.service';
import { Wine, WineRating, WineType } from '@shared/interfaces';

@Component({
  selector: 'app-wine-list',
  imports: [RouterLink],
  templateUrl: './wine-list.html',
  styleUrl: './wine-list.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WineListComponent implements OnInit {
  readonly store = inject(WinesStore);
  private readonly router = inject(Router);
  private readonly uploadService = inject(UploadService);

  readonly ratings: { value: WineRating; label: string; color: string }[] = [
    { value: 'schlecht', label: 'Schlecht', color: '#dc2626' },
    { value: 'okay', label: 'Okay', color: '#94a3b8' },
    { value: 'gut', label: 'Gut', color: '#16a34a' },
    { value: 'sehr_gut', label: 'Sehr gut', color: '#c9a57c' },
  ];

  readonly types: { value: WineType; label: string }[] = [
    { value: 'rot', label: 'Rot' },
    { value: 'weiss', label: 'Weiß' },
    { value: 'rose', label: 'Rosé' },
    { value: 'schaumwein', label: 'Schaumwein' },
  ];

  /** Lookup-Maps für O(1)-Zugriff im Template (statt Array.find pro CD-Cycle). */
  readonly ratingMap: Record<WineRating, { label: string; color: string }> = {
    schlecht: { label: 'Schlecht', color: '#dc2626' },
    okay: { label: 'Okay', color: '#94a3b8' },
    gut: { label: 'Gut', color: '#16a34a' },
    sehr_gut: { label: 'Sehr gut', color: '#c9a57c' },
  };

  readonly typeMap: Record<WineType, string> = {
    rot: 'Rot',
    weiss: 'Weiß',
    rose: 'Rosé',
    schaumwein: 'Schaumwein',
  };

  readonly wineToDelete = signal<Wine | null>(null);
  readonly deleting = signal(false);
  readonly hasItems = computed(() => this.store.items().length > 0);

  ngOnInit(): void {
    this.store.loadAll();
  }

  imageUrl(path: string | null): string | null {
    return this.uploadService.thumbUrl(path, 480);
  }

  /** Variante mit explizitem Width für srcset */
  imageUrlW(path: string | null, w: 240 | 480 | 768): string | null {
    return this.uploadService.thumbUrl(path, w);
  }

  ratingLabel(rating: WineRating | null): string {
    return rating ? this.ratingMap[rating].label : '—';
  }

  ratingColor(rating: WineRating | null): string {
    return rating ? this.ratingMap[rating].color : '#94a3b8';
  }

  typeLabel(type: WineType | null): string {
    return type ? this.typeMap[type] : '';
  }

  openDetail(id: string): void {
    this.router.navigate(['/wein', id]);
  }

  setRatingFilter(rating: WineRating | null): void {
    this.store.setFilter({ rating });
  }

  setTypeFilter(type: WineType | null): void {
    this.store.setFilter({ wineType: type });
  }

  refresh(): void {
    this.store.loadAll();
  }

  confirmDelete(wine: Wine, event: Event): void {
    event.stopPropagation();
    this.wineToDelete.set(wine);
  }

  cancelDelete(): void {
    this.wineToDelete.set(null);
  }

  async deleteWine(wine: Wine): Promise<void> {
    if (this.deleting()) return;
    this.deleting.set(true);
    try {
      const success = await this.store.delete(wine.id);
      if (success) this.wineToDelete.set(null);
    } finally {
      this.deleting.set(false);
    }
  }

  editWine(id: string, event: Event): void {
    event.stopPropagation();
    this.router.navigate(['/wein', id, 'bearbeiten']);
  }
}
