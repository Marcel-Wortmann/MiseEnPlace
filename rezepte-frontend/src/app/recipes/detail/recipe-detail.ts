import { ChangeDetectionStrategy, Component, OnInit, OnDestroy, computed, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { RecipesStore } from '../../store/Recipes/Recipes.store';
import { RecipesService } from '../../services/recipes/recipes.service';
import { UploadService } from '../../services/upload/upload.service';
import { NotificationStore } from '../../store/Notification/Notification.store';
import { ShoppingStore } from '../../store/Shopping/Shopping.store';
import { ShareModalComponent } from '../../share/share-modal/share-modal';
import { VoiceService, VoiceState } from '../../shared/voice.service';
import { VoiceCommandService } from '../../services/voice/voice-command.service';
import { TtsService } from '../../shared/tts.service';
import { LightboxService } from '../../shared/lightbox';
import { Difficulty, Recipe } from '@shared/interfaces';

@Component({
  selector: 'app-recipe-detail',
  imports: [RouterLink, ShareModalComponent, FormsModule],
  templateUrl: './recipe-detail.html',
  styleUrl: './recipe-detail.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecipeDetailComponent implements OnInit {
  readonly id = input.required<string>();

  readonly store = inject(RecipesStore);
  private readonly router = inject(Router);
  private readonly recipesService = inject(RecipesService);
  private readonly uploadService = inject(UploadService);
  private readonly notify = inject(NotificationStore);
  private readonly shopping = inject(ShoppingStore);
  readonly lightbox = inject(LightboxService);
  readonly voice = inject(VoiceService);
  private readonly voiceCommand = inject(VoiceCommandService);
  private readonly tts = inject(TtsService);

  readonly recipe = signal<Recipe | null>(null);
  readonly loading = signal(false);
  readonly notFound = signal(false);
  readonly showDeleteModal = signal(false);
  readonly showShareModal = signal(false);
  readonly cookMode = signal(false);
  readonly cookIngredientsOpen = signal(false);
  /** Aktueller Schritt im Kochmodus (1-basiert) */
  readonly currentCookStep = signal<number>(1);
  /** Voice-Toast: Antwort vom Backend */
  readonly voiceToast = signal<string | null>(null);
  /** Aktuell wird ein Befehl verarbeitet */
  readonly voiceProcessing = signal(false);
  private voiceToastTimer: ReturnType<typeof setTimeout> | null = null;
  /** User-overridable portion count, default = recipe.servings */
  readonly portionsOverride = signal<number | null>(null);
  readonly editingNotes = signal(false);
  readonly notesDraft = signal('');
  private wakeLock: { release: () => Promise<void> } | null = null;

  constructor() {
    // Voice-Commands abarbeiten
    effect(() => {
      const cmd = this.voice.command();
      if (cmd && this.cookMode()) {
        this.voice.consumeCommand();
        this.handleVoiceCommand(cmd);
      }
    });
  }

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
    // Voice-Erkennung NICHT automatisch starten — User muss Mic-Button tippen
  }

  async exitCookMode(): Promise<void> {
    this.cookMode.set(false);
    this.voice.stop();
    this.tts.cancel();
    this.clearVoiceToast();
    if (this.wakeLock) {
      try { await this.wakeLock.release(); } catch { /* ignore */ }
      this.wakeLock = null;
    }
  }

  private async handleVoiceCommand(command: string): Promise<void> {
    const r = this.recipe();
    if (!r) return;
    this.voiceProcessing.set(true);
    // Mic-Lock: Solange das Backend rechnet, keine weiteren Transcripts auswerten.
    // Verhindert dass User-Selbstgespräche oder TTS-Echo neue Commands feuern.
    this.voice.setProcessing(true);
    this.showVoiceToast(`„${command}"`, 2000);
    try {
      const result = await firstValueFrom(
        this.voiceCommand.send(this.voiceCommand.fromRecipe(r, command, this.currentCookStep())),
      );
      if (result.type === 'navigate' && result.action) {
        this.executeNavigate(result.action);
      } else if (result.type === 'answer' && result.message) {
        this.showVoiceToast(result.message, 12000);
        this.speakWithMicPause(result.message);
      } else {
        this.showVoiceToast(result.message ?? 'Befehl nicht verstanden.', 4000);
      }
    } catch {
      this.showVoiceToast('Konnte den Befehl gerade nicht verarbeiten.', 4000);
    } finally {
      this.voiceProcessing.set(false);
      // Lock erst freigeben wenn TTS NICHT spricht — sonst hört Mic die eigene Stimme.
      // speakWithMicPause kümmert sich um eigenes Lock-Handling.
      if (!this.tts.isSpeaking()) {
        this.voice.setProcessing(false);
      }
    }
  }

  private executeNavigate(action: string): void {
    const r = this.recipe();
    if (!r) return;
    const total = r.steps.length;

    if (action === 'next') {
      const next = Math.min(this.currentCookStep() + 1, total);
      this.currentCookStep.set(next);
      this.showVoiceToast(`Schritt ${next} von ${total}`, 2500);
      const step = r.steps.find((s) => s.order === next);
      if (step) this.speakWithMicPause(step.text);
    } else if (action === 'prev') {
      const prev = Math.max(this.currentCookStep() - 1, 1);
      this.currentCookStep.set(prev);
      this.showVoiceToast(`Schritt ${prev} von ${total}`, 2500);
      const step = r.steps.find((s) => s.order === prev);
      if (step) this.speakWithMicPause(step.text);
    } else if (action === 'repeat') {
      const step = r.steps.find((s) => s.order === this.currentCookStep());
      if (step) {
        this.showVoiceToast(step.text, 12000);
        this.speakWithMicPause(step.text);
      }
    } else if (action === 'ingredients') {
      this.cookIngredientsOpen.set(true);
      this.showVoiceToast('Zutaten geöffnet', 2000);
    } else if (action === 'pause') {
      this.voice.stop();
      this.tts.cancel();
      this.showVoiceToast('Pausiert. Tippe Mikrofon-Symbol zum Fortsetzen.', 5000);
    } else if (action === 'exit') {
      this.tts.cancel();
      this.exitCookMode();
    } else if (action.startsWith('step:')) {
      const n = parseInt(action.slice(5), 10);
      if (Number.isFinite(n) && n >= 1 && n <= total) {
        this.currentCookStep.set(n);
        this.showVoiceToast(`Schritt ${n} von ${total}`, 2500);
        const step = r.steps.find((s) => s.order === n);
        if (step) this.speakWithMicPause(step.text);
      }
    }
  }

  /**
   * Spricht Text. Während TTS läuft, ist das Mikrofon im processing-Lock —
   * Recognition läuft technisch weiter, aber alle Transcripts werden verworfen.
   * Vermeidet Mikrofon-Flackern (start/stop) und verhindert dass TTS sich selbst hört.
   */
  private speakWithMicPause(text: string): void {
    if (!this.tts.isSupported()) {
      // Kein TTS verfügbar → Lock direkt freigeben falls noch gesetzt
      this.voice.setProcessing(false);
      return;
    }
    // Lock setzen (idempotent — handleVoiceCommand hat ihn evtl. schon gesetzt)
    this.voice.setProcessing(true);
    this.tts.speak(text, {
      onEnd: () => {
        // 200ms Puffer damit Audio sicher fertig ist, dann Lock freigeben
        setTimeout(() => this.voice.setProcessing(false), 200);
      },
    });
  }

  private showVoiceToast(message: string, durationMs: number): void {
    this.clearVoiceToast();
    this.voiceToast.set(message);
    this.voiceToastTimer = setTimeout(() => {
      this.voiceToast.set(null);
      this.voiceToastTimer = null;
    }, durationMs);
  }

  private clearVoiceToast(): void {
    if (this.voiceToastTimer) {
      clearTimeout(this.voiceToastTimer);
      this.voiceToastTimer = null;
    }
    this.voiceToast.set(null);
  }

  toggleVoice(): void {
    const s = this.voice.state();
    if (s === 'processing') return; // während Backend rechnet kein Toggle erlauben
    if (s === 'idle' || s === 'unsupported') {
      this.voice.start();
    } else {
      this.voice.stop();
    }
  }

  toggleCookIngredients(): void {
    this.cookIngredientsOpen.update((v) => !v);
  }

  ngOnDestroy(): void {
    this.voice.stop();
    this.clearVoiceToast();
    if (this.wakeLock) {
      this.wakeLock.release().catch(() => { /* ignore */ });
    }
  }
}
