import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { RestaurantsStore } from '../../store/Restaurants/Restaurants.store';
import { UploadService } from '../../services/upload/upload.service';
import { Restaurant, RestaurantRating } from '@shared/interfaces';

@Component({
  selector: 'app-restaurant-list',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './restaurant-list.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RestaurantListComponent implements OnInit {
  readonly store = inject(RestaurantsStore);
  private readonly router = inject(Router);
  private readonly uploadService = inject(UploadService);

  readonly restaurantToDelete = signal<Restaurant | null>(null);
  readonly deleting = signal(false);

  private readonly ratingLabels: Record<RestaurantRating, string> = {
    schlecht: 'Schlecht',
    okay: 'Okay',
    gut: 'Gut',
    sehr_gut: 'Sehr gut',
  };

  ngOnInit(): void {
    if (this.store.items().length === 0) this.store.load();
  }

  imageUrl(path: string | null): string | null {
    return this.uploadService.thumbUrl(path, 480);
  }

  imageUrlW(path: string | null, w: 240 | 480 | 768): string | null {
    return this.uploadService.thumbUrl(path, w);
  }

  ratingLabel(r: RestaurantRating | null): string {
    return r ? this.ratingLabels[r] : '';
  }

  priceDisplay(level: number | null): string {
    if (!level) return '';
    return '€'.repeat(Math.max(1, Math.min(4, level)));
  }

  openDetail(id: string): void {
    this.router.navigate(['/restaurants', id]);
  }

  editRestaurant(id: string, ev: Event): void {
    ev.stopPropagation();
    this.router.navigate(['/restaurants', id, 'bearbeiten']);
  }

  confirmDelete(r: Restaurant, ev: Event): void {
    ev.stopPropagation();
    this.restaurantToDelete.set(r);
  }

  cancelDelete(): void {
    this.restaurantToDelete.set(null);
  }

  async deleteRestaurant(r: Restaurant): Promise<void> {
    if (this.deleting()) return;
    this.deleting.set(true);
    try {
      const success = await this.store.delete(r.id);
      if (success) this.restaurantToDelete.set(null);
    } finally {
      this.deleting.set(false);
    }
  }

  setRatingFilter(r: RestaurantRating | null): void {
    this.store.setFilter({ rating: this.store.filter().rating === r ? null : r });
  }
}
