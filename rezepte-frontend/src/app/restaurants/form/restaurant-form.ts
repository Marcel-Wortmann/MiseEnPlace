import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { RestaurantsStore } from '../../store/Restaurants/Restaurants.store';
import { RestaurantsService } from '../../services/restaurants/restaurants.service';
import { UploadService } from '../../services/upload/upload.service';
import { NotificationStore } from '../../store/Notification/Notification.store';
import { RestaurantRating } from '@shared/interfaces';

@Component({
  selector: 'app-restaurant-form',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './restaurant-form.html',
})
export class RestaurantFormComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly store = inject(RestaurantsStore);
  private readonly service = inject(RestaurantsService);
  private readonly upload = inject(UploadService);

  imageUrl(path: string): string | null {
    return this.upload.resolveUrl(path);
  }
  private readonly notify = inject(NotificationStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly id = signal<string | null>(null);
  readonly imagePath = signal<string | null>(null);
  readonly tags = signal<string[]>([]);
  readonly tagInput = signal('');
  readonly suggestingTags = signal(false);
  readonly isUploading = signal(false);
  readonly isLoading = signal(false);

  readonly ratings: RestaurantRating[] = ['schlecht', 'okay', 'gut', 'sehr_gut'];
  readonly ratingLabels: Record<RestaurantRating, string> = {
    schlecht: 'Schlecht',
    okay: 'Okay',
    gut: 'Gut',
    sehr_gut: 'Sehr gut',
  };

  readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(200)]],
    cuisine: [''],
    rating: this.fb.control<RestaurantRating | null>(null),
    priceLevel: this.fb.control<number | null>(null),
    notes: [''],
  });

  async ngOnInit(): Promise<void> {
    const idParam = this.route.snapshot.paramMap.get('id');
    if (idParam) {
      this.id.set(idParam);
      this.isLoading.set(true);
      try {
        const r = await firstValueFrom(this.service.get(idParam));
        this.form.patchValue({
          name: r.name,
          cuisine: r.cuisine ?? '',
          rating: r.rating,
          priceLevel: r.priceLevel,
          notes: r.notes ?? '',
        });
        this.imagePath.set(r.imagePath);
        this.tags.set(r.tags);
      } catch {
        this.notify.error('Restaurant nicht gefunden');
        this.router.navigate(['/restaurants']);
      } finally {
        this.isLoading.set(false);
      }
    }
  }

  setRating(r: RestaurantRating | null): void {
    this.form.patchValue({ rating: this.form.controls.rating.value === r ? null : r });
  }

  setPrice(p: number | null): void {
    this.form.patchValue({ priceLevel: this.form.controls.priceLevel.value === p ? null : p });
  }

  async onFileSelect(ev: Event): Promise<void> {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.isUploading.set(true);
    try {
      const result = await firstValueFrom(this.upload.uploadImage(file));
      this.imagePath.set(result.path);
    } catch (err) {
      this.notify.error('Bild-Upload fehlgeschlagen', (err as Error).message);
    } finally {
      this.isUploading.set(false);
    }
  }

  removeImage(): void {
    this.imagePath.set(null);
  }

  onTagInput(ev: Event): void {
    this.tagInput.set((ev.target as HTMLInputElement).value);
  }

  onTagKeydown(ev: KeyboardEvent): void {
    if (ev.key === 'Enter' || ev.key === ',') {
      ev.preventDefault();
      this.commitTag();
    }
  }

  commitTag(): void {
    const v = this.tagInput().trim();
    if (v && !this.tags().includes(v)) {
      this.tags.update((arr) => [...arr, v]);
    }
    this.tagInput.set('');
  }

  removeTag(tag: string): void {
    this.tags.update((arr) => arr.filter((t) => t !== tag));
  }

  async suggestTags(): Promise<void> {
    const name = this.form.controls.name.value.trim();
    if (!name) {
      this.notify.error('Bitte zuerst einen Namen eingeben');
      return;
    }
    this.suggestingTags.set(true);
    try {
      const result = await firstValueFrom(this.service.suggestTags({
        name,
        cuisine: this.form.controls.cuisine.value || null,
        notes: this.form.controls.notes.value || null,
      }));
      const newTags = result.tags.filter((t) => !this.tags().includes(t));
      if (newTags.length === 0) {
        this.notify.info('Keine neuen Vorschläge');
      } else {
        this.tags.update((arr) => [...arr, ...newTags].slice(0, 10));
        this.notify.success(`${newTags.length} Tag(s) hinzugefügt`);
      }
    } catch (err) {
      this.notify.error('Tag-Vorschlag fehlgeschlagen', (err as Error).message);
    } finally {
      this.suggestingTags.set(false);
    }
  }

  async save(): Promise<void> {
    this.commitTag();
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const payload = {
      name: v.name.trim(),
      cuisine: v.cuisine.trim() || null,
      rating: v.rating,
      priceLevel: v.priceLevel,
      imagePath: this.imagePath(),
      notes: v.notes.trim() || null,
      tags: this.tags(),
    };
    const id = this.id();
    const result = id
      ? await this.store.update(id, payload)
      : await this.store.create(payload);
    if (result) this.router.navigate(['/restaurants', result.id]);
  }

  cancel(): void {
    const id = this.id();
    if (id) this.router.navigate(['/restaurants', id]);
    else this.router.navigate(['/restaurants']);
  }
}
