import { Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { SharesService } from '../../services/shares/shares.service';
import { UploadService } from '../../services/upload/upload.service';
import { RecipeIdea } from '@shared/interfaces';

@Component({
  selector: 'app-share-idea',
  imports: [RouterLink],
  templateUrl: './share-idea.html',
  styleUrl: './share-idea.css',
})
export class ShareIdeaComponent {
  readonly token = input.required<string>();
  private readonly shares = inject(SharesService);
  private readonly uploadService = inject(UploadService);

  readonly idea = signal<(RecipeIdea & { user?: { email: string; displayName: string | null } }) | null>(null);
  readonly loading = signal(true);
  readonly notFound = signal(false);
  readonly imageSrc = computed(() => {
    const i = this.idea();
    return i ? this.uploadService.resolveUrl(i.imagePath) : null;
  });

  async ngOnInit(): Promise<void> {
    try {
      const data = (await firstValueFrom(this.shares.publicIdea(this.token()))) as RecipeIdea & {
        user?: { email: string; displayName: string | null };
      };
      this.idea.set(data);
    } catch {
      this.notFound.set(true);
    } finally {
      this.loading.set(false);
    }
  }
}
