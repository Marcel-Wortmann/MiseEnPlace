import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { RestaurantsStore } from '../../store/Restaurants/Restaurants.store';
import { RestaurantsService } from '../../services/restaurants/restaurants.service';
import { UploadService } from '../../services/upload/upload.service';
import { Restaurant, RestaurantRating } from '@shared/interfaces';
import { LightboxService } from '../../shared/lightbox';

@Component({
  selector: 'app-restaurant-detail',
  standalone: true,
  imports: [],
  templateUrl: './restaurant-detail.html',
})
export class RestaurantDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly service = inject(RestaurantsService);
  private readonly store = inject(RestaurantsStore);
  private readonly uploadService = inject(UploadService);
  readonly lightbox = inject(LightboxService);

  readonly restaurant = signal<Restaurant | null>(null);
  readonly loading = signal(false);
  readonly showDeleteModal = signal(false);

  private readonly ratingLabels: Record<RestaurantRating, string> = {
    schlecht: 'Schlecht',
    okay: 'Okay',
    gut: 'Gut',
    sehr_gut: 'Sehr gut',
  };

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.router.navigate(['/restaurants']);
      return;
    }
    const cached = this.store.findById(id);
    if (cached) {
      this.restaurant.set(cached);
    } else {
      this.loading.set(true);
    }
    try {
      const r = await firstValueFrom(this.service.get(id));
      this.restaurant.set(r);
    } catch {
      if (!cached) this.router.navigate(['/restaurants']);
    } finally {
      this.loading.set(false);
    }
  }

  imageUrl(path: string | null): string | null {
    return this.uploadService.thumbUrl(path, 480);
  }
  imageOriginal(path: string | null): string | null {
    return this.uploadService.resolveUrl(path);
  }

  ratingLabel(r: RestaurantRating | null): string {
    return r ? this.ratingLabels[r] : '';
  }

  priceDisplay(level: number | null): string {
    if (!level) return '';
    return '€'.repeat(Math.max(1, Math.min(4, level)));
  }

  edit(): void {
    const r = this.restaurant();
    if (r) this.router.navigate(['/restaurants', r.id, 'bearbeiten']);
  }

  back(): void {
    this.router.navigate(['/restaurants']);
  }

  openDelete(): void {
    this.showDeleteModal.set(true);
  }

  closeDelete(): void {
    this.showDeleteModal.set(false);
  }

  async confirmDelete(): Promise<void> {
    const r = this.restaurant();
    if (!r) return;
    const success = await this.store.delete(r.id);
    if (success) this.router.navigate(['/restaurants']);
  }
}
