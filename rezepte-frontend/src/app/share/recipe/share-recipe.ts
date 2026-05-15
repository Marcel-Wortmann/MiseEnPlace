import { Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { SharesService } from '../../services/shares/shares.service';
import { UploadService } from '../../services/upload/upload.service';
import { Recipe } from '@shared/interfaces';

@Component({
  selector: 'app-share-recipe',
  imports: [RouterLink],
  templateUrl: './share-recipe.html',
  styleUrl: './share-recipe.css',
})
export class ShareRecipeComponent {
  readonly token = input.required<string>();
  private readonly shares = inject(SharesService);
  private readonly uploadService = inject(UploadService);

  readonly recipe = signal<(Recipe & { user?: { email: string; displayName: string | null } }) | null>(null);
  readonly loading = signal(true);
  readonly notFound = signal(false);
  readonly imageSrc = computed(() => {
    const r = this.recipe();
    return r ? this.uploadService.resolveUrl(r.imagePath) : null;
  });

  async ngOnInit(): Promise<void> {
    try {
      const data = (await firstValueFrom(this.shares.publicRecipe(this.token()))) as Recipe & {
        user?: { email: string; displayName: string | null };
      };
      this.recipe.set(data);
    } catch {
      this.notFound.set(true);
    } finally {
      this.loading.set(false);
    }
  }
}
