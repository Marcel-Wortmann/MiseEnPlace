import { ChangeDetectionStrategy, Component, OnInit, OnDestroy, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { WinesStore } from '../../store/Wines/Wines.store';
import { WinesService } from '../../services/wines/wines.service';
import { LightboxService } from '../../shared/lightbox';
import { UploadService } from '../../services/upload/upload.service';
import { ShareModalComponent } from '../../share/share-modal/share-modal';
import { Wine, WineRating, WineType } from '@shared/interfaces';

@Component({
  selector: 'app-wine-detail',
  imports: [RouterLink, ShareModalComponent],
  templateUrl: './wine-detail.html',
  styleUrl: './wine-detail.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WineDetailComponent implements OnInit, OnDestroy {
  readonly id = input.required<string>();

  private readonly store = inject(WinesStore);
  private readonly service = inject(WinesService);
  private readonly uploadService = inject(UploadService);
  private readonly router = inject(Router);
  readonly lightbox = inject(LightboxService);

  readonly wine = signal<Wine | null>(null);
  readonly loading = signal(false);

  async ngOnInit(): Promise<void> {
    const id = this.id();
    const cached = this.store.findById(id);
    if (cached) {
      this.wine.set(cached);
    } else {
      this.loading.set(true);
    }
    try {
      const fresh = await firstValueFrom(this.service.get(id));
      this.wine.set(fresh);
    } catch {
      if (!cached) this.notFound.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  ngOnDestroy(): void {
    console.timeEnd('Click→FormShown');
    console.log('WineDetail destroyed');
  }

  onEditClick(): void {
    console.time('Click→FormShown');
  }
  readonly retrying = signal(false);
  readonly notFound = signal(false);
  readonly showDeleteModal = signal(false);
  readonly showShareModal = signal(false);

  readonly imageSrc = computed(() => {
    const w = this.wine();
    // 480er Thumb teilt Cache mit der Liste → erscheint sofort
    return w ? this.uploadService.thumbUrl(w.imagePath, 768) : null;
  });
  readonly imageBackSrc = computed(() => {
    const w = this.wine();
    return w?.imagePathBack ? this.uploadService.thumbUrl(w.imagePathBack, 768) : null;
  });
  /** Originale für Lightbox */
  readonly imageOriginal = computed(() => {
    const w = this.wine();
    return w ? this.uploadService.resolveUrl(w.imagePath) : null;
  });
  readonly imageBackOriginal = computed(() => {
    const w = this.wine();
    return w?.imagePathBack ? this.uploadService.resolveUrl(w.imagePathBack) : null;
  });

  readonly ratings: Record<WineRating, { label: string; color: string }> = {
    schlecht: { label: 'Schlecht', color: '#dc2626' },
    okay: { label: 'Okay', color: '#94a3b8' },
    gut: { label: 'Gut', color: '#16a34a' },
    sehr_gut: { label: 'Sehr gut', color: '#c9a57c' },
  };

  readonly typeLabels: Record<WineType, string> = {
    rot: 'Rotwein',
    weiss: 'Weißwein',
    rose: 'Roséwein',
    schaumwein: 'Schaumwein',
  };

  ratingLabel(r: WineRating | null): string {
    return r ? this.ratings[r].label : '—';
  }

  ratingColor(r: WineRating | null): string {
    return r ? this.ratings[r].color : '#94a3b8';
  }

  typeLabel(t: WineType | null): string {
    return t ? this.typeLabels[t] : '';
  }

  openDelete(): void {
    this.showDeleteModal.set(true);
  }

  cancelDelete(): void {
    this.showDeleteModal.set(false);
  }

  openShare(): void {
    this.showShareModal.set(true);
  }

  closeShare(): void {
    this.showShareModal.set(false);
  }

  async confirmDelete(): Promise<void> {
    const w = this.wine();
    if (!w) return;
    const success = await this.store.delete(w.id);
    if (success) this.router.navigate(['/wein']);
  }

  async retryAnalysis(): Promise<void> {
    const w = this.wine();
    if (!w) return;
    this.retrying.set(true);
    try {
      const updated = await this.store.retryAnalysis(w.id);
      if (updated) this.wine.set(updated);
    } finally {
      this.retrying.set(false);
    }
  }
}
