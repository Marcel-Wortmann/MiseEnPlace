import { Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { SharesService } from '../../services/shares/shares.service';
import { UploadService } from '../../services/upload/upload.service';
import { Wine } from '@shared/interfaces';

@Component({
  selector: 'app-share-wine',
  imports: [RouterLink],
  templateUrl: './share-wine.html',
  styleUrl: './share-wine.css',
})
export class ShareWineComponent {
  readonly token = input.required<string>();
  private readonly shares = inject(SharesService);
  private readonly uploadService = inject(UploadService);

  readonly wine = signal<(Wine & { user?: { email: string; displayName: string | null } }) | null>(null);
  readonly loading = signal(true);
  readonly notFound = signal(false);
  readonly imageSrc = computed(() => {
    const w = this.wine();
    return w ? this.uploadService.resolveUrl(w.imagePath) : null;
  });
  readonly imageBackSrc = computed(() => {
    const w = this.wine();
    return w?.imagePathBack ? this.uploadService.resolveUrl(w.imagePathBack) : null;
  });

  async ngOnInit(): Promise<void> {
    try {
      const data = (await firstValueFrom(this.shares.publicWine(this.token()))) as Wine & {
        user?: { email: string; displayName: string | null };
      };
      this.wine.set(data);
    } catch {
      this.notFound.set(true);
    } finally {
      this.loading.set(false);
    }
  }
}
