import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { RecipeIdeasStore } from '../../store/RecipeIdeas/RecipeIdeas.store';
import { UploadService } from '../../services/upload/upload.service';
import { LightboxService } from '../../shared/lightbox';
import { ShareModalComponent } from '../../share/share-modal/share-modal';
import { RecipeIdea } from '@shared/interfaces';

@Component({
  selector: 'app-recipe-idea-list',
  imports: [RouterLink, ShareModalComponent],
  templateUrl: './recipe-idea-list.html',
  styleUrl: './recipe-idea-list.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecipeIdeaListComponent implements OnInit {
  readonly store = inject(RecipeIdeasStore);
  private readonly router = inject(Router);
  private readonly uploadService = inject(UploadService);
  readonly lightbox = inject(LightboxService);

  readonly ideaToDelete = signal<RecipeIdea | null>(null);
  readonly ideaToShare = signal<RecipeIdea | null>(null);
  readonly hasItems = computed(() => this.store.items().length > 0);

  ngOnInit(): void {
    if (this.store.items().length === 0) {
      this.store.loadAll();
    }
  }

  imageUrl(path: string | null): string | null {
    return this.uploadService.thumbUrl(path, 480);
  }

  imageUrlW(path: string | null, w: 240 | 480 | 768): string | null {
    return this.uploadService.thumbUrl(path, w);
  }

  editIdea(id: string, event: Event): void {
    event.stopPropagation();
    this.router.navigate(['/ideen', id, 'bearbeiten']);
  }

  confirmDelete(idea: RecipeIdea, event: Event): void {
    event.stopPropagation();
    this.ideaToDelete.set(idea);
  }

  cancelDelete(): void {
    this.ideaToDelete.set(null);
  }

  async deleteIdea(idea: RecipeIdea): Promise<void> {
    const success = await this.store.delete(idea.id);
    if (success) {
      this.ideaToDelete.set(null);
    }
  }

  openShare(idea: RecipeIdea, event: Event): void {
    event.stopPropagation();
    this.ideaToShare.set(idea);
  }

  closeShare(): void {
    this.ideaToShare.set(null);
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }
}
