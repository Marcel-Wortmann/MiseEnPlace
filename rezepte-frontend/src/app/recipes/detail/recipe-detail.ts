import { ChangeDetectionStrategy, Component, OnInit, OnDestroy, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { RecipesStore } from '../../store/Recipes/Recipes.store';
import { RecipesService } from '../../services/recipes/recipes.service';
import { UploadService } from '../../services/upload/upload.service';
import { NotificationStore } from '../../store/Notification/Notification.store';
import { ShoppingStore } from '../../store/Shopping/Shopping.store';
import { ShareModalComponent } from '../../share/share-modal/share-modal';
import { LightboxService } from '../../shared/lightbox';
import { Difficulty, Recipe } from '@shared/interfaces';

@Component({
  selector: 'app-recipe-detail',
  imports: [RouterLink, ShareModalComponent, FormsModule],
  templateUrl: './recipe-detail.html',
  styleUrl: './recipe-detail.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecipeDetailComponent implements OnInit, OnDestroy {
  readonly id = input.required<string>();

  readonly store = inject(RecipesStore);
  private readonly router = inject(Router);
  private readonly recipesService = inject(RecipesService);
  private readonly uploadService = inject(UploadService);
  private readonly notify = inject(NotificationStore);
  private readonly shopping = inject(ShoppingStore);
  readonly lightbox = inject(LightboxService);

  readonly recipe = signal<Recipe | null>(null);
  readonly loading = signal(false);
  readonly notFound = signal(false);
  readonly showDeleteModal = signal(false);
  readonly showShareModal = signal(false);
  readonly cookMode = signal(false);
  readonly cookIngredientsOpen = signal(false);
  /** Aktueller Schritt im Kochmodus (1-basiert) */
  readonly currentCookStep = signal<number>(1);
  /** User-overridable portion count, default = recipe.servings */
  readonly portionsOverride = signal<number | null>(null);
  readonly editingNotes = signal(false);
  readonly notesDraft = signal('');
  private wakeLock: { release: () => Promise<void> } | null = null;

  readonly difficultyLabels: Record<Difficulty, string> = {
    einfach: 'Einfach',
    mittel: 'Mittel',
    schwer: 'Schwer',
  };

  readonly imageError = signal(false);
  readonly imageSrc = computed(() => {
    const r = this.recipe();
    return r ? this.uploadService.thumbUrl(r.imagePath, 480) : null;
  });
  readonly imageOriginal = computed(() => {
    const r = this.recipe();
    return r ? this.uploadService.resolveUrl(r.imagePath) : null;
  });

  /** Aktuelle Portionen (override oder default) */
  readonly currentServings = computed(() => {
    const r = this.recipe();
    return this.portionsOverride() ?? r?.servings ?? 1;
  });

  /** Skalierungsfaktor */
  readonly scaleFactor = computed(() => {
    const r = this.recipe();
    const base = r?.servings ?? 1;
    return base > 0 ? this.currentServings() / base : 1;
  });

  /** Skalierte Zutaten (für Detail + Cook-Mode) */
  readonly scaledIngredients = computed(() => {
    const r = this.recipe();
    if (!r) return [];
    const factor = this.scaleFactor();
    return r.ingredients.map((ing) => ({
      ...ing,
      amount: ing.amount !== null ? this.roundSmart(ing.amount * factor) : null,
    }));
  });

  private roundSmart(v: number): number {
    if (v >= 100) return Math.round(v);
    if (v >= 10) return Math.round(v * 10) / 10;
    return Math.round(v * 100) / 100;
  }

  async ngOnInit(): Promise<void> {
    const id = this.id();
    const cached = this.store.findById(id);
    if (cached) {
      this.recipe.set(cached);
      this.portionsOverride.set(cached.servings);
      return;
    }
    this.loading.set(true);
    try {
      const recipe = await firstValueFrom(this.recipesService.loadOne(id));
      this.recipe.set(recipe);
      this.portionsOverride.set(recipe.servings);
    } catch {
      this.notFound.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  setPortions(value: number): void {
    if (value < 1 || value > 100) return;
    this.portionsOverride.set(value);
  }

  decrementPortions(): void {
    const v = this.currentServings();
    if (v > 1) this.portionsOverride.set(v - 1);
  }

  incrementPortions(): void {
    const v = this.currentServings();
    if (v < 100) this.portionsOverride.set(v + 1);
  }

  async toggleFavorite(): Promise<void> {
    const r = this.recipe();
    if (!r) return;
    await this.store.toggleFavorite(r.id);
    const updated = this.store.findById(r.id);
    if (updated) this.recipe.set(updated);
  }

  startEditNotes(current: string | null): void {
    this.notesDraft.set(current ?? '');
    this.editingNotes.set(true);
  }

  cancelEditNotes(): void {
    this.editingNotes.set(false);
    this.notesDraft.set('');
  }

  async saveNotes(): Promise<void> {
    const r = this.recipe();
    if (!r) return;
    const value = this.notesDraft().trim();
    await this.store.update(r.id, { personalNotes: value || null });
    const updated = this.store.findById(r.id);
    if (updated) this.recipe.set(updated);
    this.editingNotes.set(false);
    this.notesDraft.set('');
  }

  async toggleFollowRecipe(): Promise<void> {
    const r = this.recipe();
    if (!r) return;
    await this.store.toggleFollowRecipe(r.id);
    const updated = this.store.findById(r.id);
    if (updated) this.recipe.set(updated);
  }

  async addToShopping(): Promise<void> {
    const r = this.recipe();
    if (!r) return;
    await this.shopping.addFromRecipe(r.id, this.currentServings());
  }

  ratingStars(rating: number | null): boolean[] {
    const value = rating ?? 0;
    return [1, 2, 3, 4, 5].map((i) => i <= value);
  }

  difficultyLabel(value: Difficulty | null): string {
    return value ? this.difficultyLabels[value] : '—';
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
    const r = this.recipe();
    if (!r) {
      return;
    }
    const success = await this.store.delete(r.id);
    if (success) {
      this.router.navigate(['/rezepte']);
    }
  }

  async startCookMode(): Promise<void> {
    this.cookMode.set(true);
    this.cookIngredientsOpen.set(false);
    this.currentCookStep.set(1);
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> } };
      if (nav.wakeLock) {
        this.wakeLock = await nav.wakeLock.request('screen');
      }
    } catch {
      // Wake Lock optional — Modus läuft trotzdem
    }
  }

  async exitCookMode(): Promise<void> {
    this.cookMode.set(false);
    if (this.wakeLock) {
      try { await this.wakeLock.release(); } catch { /* ignore */ }
      this.wakeLock = null;
    }
  }

  toggleCookIngredients(): void {
    this.cookIngredientsOpen.update((v) => !v);
  }

  ngOnDestroy(): void {
    if (this.wakeLock) {
      this.wakeLock.release().catch(() => { /* ignore */ });
    }
  }
}
