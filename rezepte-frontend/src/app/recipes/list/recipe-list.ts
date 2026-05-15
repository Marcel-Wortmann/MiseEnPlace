import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { RecipesStore } from '../../store/Recipes/Recipes.store';
import { UploadService } from '../../services/upload/upload.service';
import { Difficulty, Recipe } from '@shared/interfaces';

@Component({
  selector: 'app-recipe-list',
  imports: [RouterLink],
  templateUrl: './recipe-list.html',
  styleUrl: './recipe-list.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecipeListComponent implements OnInit {
  readonly store = inject(RecipesStore);
  private readonly router = inject(Router);
  private readonly uploadService = inject(UploadService);

  readonly difficulties: { value: Difficulty; label: string }[] = [
    { value: 'einfach', label: 'Einfach' },
    { value: 'mittel', label: 'Mittel' },
    { value: 'schwer', label: 'Schwer' },
  ];

  readonly recipeToDelete = signal<Recipe | null>(null);
  readonly filterPanelOpen = signal(false);

  readonly hasItems = computed(() => this.store.items().length > 0);
  readonly filteredCount = computed(() => this.store.filteredItems().length);

  readonly quickTags = computed(() => {
    const tags = this.store.allTags();
    return ['Alle', ...tags];
  });

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

  openDetail(id: string): void {
    this.router.navigate(['/rezepte', id]);
  }

  onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.store.setFilter({ search: value || null });
  }

  onMaxDurationInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    const num = raw === '' ? null : Number(raw);
    this.store.setFilter({ maxDurationMinutes: Number.isFinite(num) ? num : null });
  }

  onDifficultyChange(value: Difficulty | null): void {
    this.store.setFilter({ difficulty: value });
  }

  onMinRatingChange(value: number | null): void {
    this.store.setFilter({ minRating: value });
  }

  onQuickTagClick(tag: string): void {
    if (tag === 'Alle') {
      this.store.setFilter({ tags: [] });
    } else {
      this.store.toggleTagFilter(tag);
    }
  }

  isQuickTagActive(tag: string): boolean {
    if (tag === 'Alle') {
      return this.store.filter().tags.length === 0;
    }
    return this.store.filter().tags.includes(tag);
  }

  resetFilter(): void {
    this.store.resetFilter();
  }

  toggleFilterPanel(): void {
    this.filterPanelOpen.update((v) => !v);
  }

  difficultyLabel(value: Difficulty | null): string {
    return this.difficulties.find((d) => d.value === value)?.label ?? '—';
  }

  confirmDelete(recipe: Recipe, event: Event): void {
    event.stopPropagation();
    this.recipeToDelete.set(recipe);
  }

  cancelDelete(): void {
    this.recipeToDelete.set(null);
  }

  async deleteRecipe(recipe: Recipe): Promise<void> {
    const success = await this.store.delete(recipe.id);
    if (success) {
      this.recipeToDelete.set(null);
    }
  }

  editRecipe(id: string, event: Event): void {
    event.stopPropagation();
    this.router.navigate(['/rezepte', id, 'bearbeiten']);
  }

  ratingStars(rating: number | null): boolean[] {
    const value = rating ?? 0;
    return [1, 2, 3, 4, 5].map((i) => i <= value);
  }

  toggleFavoritesOnly(): void {
    this.store.setFilter({ favoritesOnly: !this.store.filter().favoritesOnly });
  }

  async toggleFavorite(recipe: Recipe, event: Event): Promise<void> {
    event.stopPropagation();
    await this.store.toggleFavorite(recipe.id);
  }
}
