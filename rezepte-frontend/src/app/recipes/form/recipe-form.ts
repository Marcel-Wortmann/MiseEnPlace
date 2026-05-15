import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  FormArray,
  FormControl,
  FormGroup,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { RecipesStore } from '../../store/Recipes/Recipes.store';
import { RecipesService, CreateRecipePayload } from '../../services/recipes/recipes.service';
import { UploadService } from '../../services/upload/upload.service';
import { AiService } from '../../services/ai/ai.service';
import { NotificationStore } from '../../store/Notification/Notification.store';
import { Difficulty, ExtractedRecipeDraft, Recipe } from '@shared/interfaces';

interface IngredientFormShape {
  name: FormControl<string>;
  amount: FormControl<number | null>;
  unit: FormControl<string | null>;
}

interface StepFormShape {
  text: FormControl<string>;
}

interface RecipeFormShape {
  title: FormControl<string>;
  description: FormControl<string | null>;
  durationMinutes: FormControl<number | null>;
  difficulty: FormControl<Difficulty | null>;
  rating: FormControl<number | null>;
  servings: FormControl<number | null>;
  caloriesPerServing: FormControl<number | null>;
  proteinPerServing: FormControl<number | null>;
  carbsPerServing: FormControl<number | null>;
  fatPerServing: FormControl<number | null>;
  ingredients: FormArray<FormGroup<IngredientFormShape>>;
  steps: FormArray<FormGroup<StepFormShape>>;
  isPrivate: FormControl<boolean>;
}

@Component({
  selector: 'app-recipe-form',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './recipe-form.html',
  styleUrl: './recipe-form.css',
})
export class RecipeFormComponent implements OnInit {
  readonly id = input<string | undefined>(undefined);

  private readonly fb = inject(NonNullableFormBuilder);
  private readonly router = inject(Router);
  private readonly store = inject(RecipesStore);
  private readonly recipesService = inject(RecipesService);
  private readonly uploadService = inject(UploadService);
  private readonly aiService = inject(AiService);
  private readonly notify = inject(NotificationStore);

  readonly difficulties: { value: Difficulty; label: string }[] = [
    { value: 'einfach', label: 'Einfach' },
    { value: 'mittel', label: 'Mittel' },
    { value: 'schwer', label: 'Schwer' },
  ];

  readonly form: FormGroup<RecipeFormShape> = this.fb.group<RecipeFormShape>({
    title: this.fb.control('', { validators: [Validators.required, Validators.maxLength(200)] }),
    description: this.fb.control<string | null>(null),
    durationMinutes: this.fb.control<number | null>(null, { validators: [Validators.min(1)] }),
    difficulty: this.fb.control<Difficulty | null>(null),
    rating: this.fb.control<number | null>(null),
    servings: this.fb.control<number | null>(null, { validators: [Validators.min(1)] }),
    caloriesPerServing: this.fb.control<number | null>(null, { validators: [Validators.min(0)] }),
    proteinPerServing: this.fb.control<number | null>(null, { validators: [Validators.min(0)] }),
    carbsPerServing: this.fb.control<number | null>(null, { validators: [Validators.min(0)] }),
    fatPerServing: this.fb.control<number | null>(null, { validators: [Validators.min(0)] }),
    ingredients: this.fb.array<FormGroup<IngredientFormShape>>([]),
    steps: this.fb.array<FormGroup<StepFormShape>>([]),
    isPrivate: this.fb.control<boolean>(false),
  });

  readonly imagePath = signal<string | null>(null);
  readonly tags = signal<string[]>([]);
  /** Tags die per AI vorgeschlagen wurden — können einzeln entfernt werden */
  readonly autoTags = signal<Set<string>>(new Set());
  readonly tagInput = signal('');
  readonly submitted = signal(false);
  readonly isLoading = signal(false);
  readonly isUploading = signal(false);
  readonly isEditMode = computed(() => !!this.id());

  // AI state
  readonly aiBusy = signal<null | 'image' | 'url' | 'calories'>(null);
  readonly urlModalOpen = signal(false);
  readonly urlInput = signal('');
  readonly suggestingTags = signal(false);

  // Version signals: bump on FormArray reorder/replace so zoneless CD re-renders
  readonly stepsVersion = signal(0);
  readonly ingredientsVersion = signal(0);

  // Computed: forces re-evaluation in templates when versions change
  readonly stepsControls = computed(() => {
    this.stepsVersion();
    return this.steps.controls;
  });
  readonly ingredientsControls = computed(() => {
    this.ingredientsVersion();
    return this.ingredients.controls;
  });

  get ingredients(): FormArray<FormGroup<IngredientFormShape>> {
    return this.form.controls.ingredients;
  }

  get steps(): FormArray<FormGroup<StepFormShape>> {
    return this.form.controls.steps;
  }

  imageUrl = computed(() => this.uploadService.resolveUrl(this.imagePath()));

  async ngOnInit(): Promise<void> {
    const id = this.id();
    if (!id) {
      this.addIngredient();
      this.addStep();
      return;
    }
    const cached = this.store.findById(id);
    if (cached) {
      this.populateForm(cached);
      return;
    }
    this.isLoading.set(true);
    try {
      const recipe = await firstValueFrom(this.recipesService.loadOne(id));
      this.populateForm(recipe);
    } catch {
      this.notify.error('Rezept konnte nicht geladen werden');
      this.router.navigate(['/rezepte']);
    } finally {
      this.isLoading.set(false);
    }
  }

  private populateForm(recipe: Recipe): void {
    this.form.patchValue({
      title: recipe.title,
      description: recipe.description,
      durationMinutes: recipe.durationMinutes,
      difficulty: recipe.difficulty,
      rating: recipe.rating,
      servings: recipe.servings,
      caloriesPerServing: recipe.caloriesPerServing,
      proteinPerServing: recipe.proteinPerServing,
      carbsPerServing: recipe.carbsPerServing,
      fatPerServing: recipe.fatPerServing,
      isPrivate: recipe.isPrivate,
    });
    this.imagePath.set(recipe.imagePath);
    this.tags.set([...recipe.tags]);

    this.ingredients.clear();
    for (const ing of recipe.ingredients) {
      this.ingredients.push(
        this.fb.group<IngredientFormShape>({
          name: this.fb.control(ing.name, { validators: [Validators.required] }),
          amount: this.fb.control<number | null>(ing.amount),
          unit: this.fb.control<string | null>(ing.unit),
        }),
      );
    }
    if (this.ingredients.length === 0) {
      this.addIngredient();
    }

    this.steps.clear();
    for (const step of recipe.steps) {
      this.steps.push(
        this.fb.group<StepFormShape>({
          text: this.fb.control(step.text, { validators: [Validators.required] }),
        }),
      );
    }
    if (this.steps.length === 0) {
      this.addStep();
    }
  }

  addIngredient(): void {
    this.ingredients.push(
      this.fb.group<IngredientFormShape>({
        name: this.fb.control('', { validators: [Validators.required] }),
        amount: this.fb.control<number | null>(null),
        unit: this.fb.control<string | null>(null),
      }),
    );
    this.ingredientsVersion.update((v) => v + 1);
  }

  removeIngredient(index: number): void {
    this.ingredients.removeAt(index);
    this.ingredientsVersion.update((v) => v + 1);
  }

  addStep(): void {
    this.steps.push(
      this.fb.group<StepFormShape>({
        text: this.fb.control('', { validators: [Validators.required] }),
      }),
    );
    this.stepsVersion.update((v) => v + 1);
  }

  removeStep(index: number): void {
    this.steps.removeAt(index);
    this.stepsVersion.update((v) => v + 1);
  }

  moveStepUp(index: number): void {
    if (index === 0) return;
    const ctrl = this.steps.at(index);
    this.steps.removeAt(index);
    this.steps.insert(index - 1, ctrl);
    this.stepsVersion.update((v) => v + 1);
  }

  moveStepDown(index: number): void {
    if (index >= this.steps.length - 1) return;
    const ctrl = this.steps.at(index);
    this.steps.removeAt(index);
    this.steps.insert(index + 1, ctrl);
    this.stepsVersion.update((v) => v + 1);
  }

  setRating(value: number): void {
    const current = this.form.controls.rating.value;
    this.form.controls.rating.setValue(current === value ? null : value);
  }

  setDifficulty(value: Difficulty): void {
    const current = this.form.controls.difficulty.value;
    this.form.controls.difficulty.setValue(current === value ? null : value);
  }

  ratingStars(): boolean[] {
    const value = this.form.controls.rating.value ?? 0;
    return [1, 2, 3, 4, 5].map((i) => i <= value);
  }

  onTagInput(event: Event): void {
    this.tagInput.set((event.target as HTMLInputElement).value);
  }

  onTagKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      this.commitTag();
    }
  }

  commitTag(): void {
    const value = this.tagInput().trim();
    if (!value) return;
    if (!this.tags().includes(value)) {
      this.tags.update((arr) => [...arr, value]);
      // User-eingegeben → kein Auto-Tag mehr
      this.autoTags.update((s) => {
        s.delete(value);
        return new Set(s);
      });
    }
    this.tagInput.set('');
  }

  removeTag(tag: string): void {
    this.tags.update((arr) => arr.filter((t) => t !== tag));
    this.autoTags.update((s) => {
      s.delete(tag);
      return new Set(s);
    });
  }

  async suggestTags(): Promise<void> {
    const title = (this.form.controls.title.value ?? '').trim();
    if (!title) return;
    try {
      const ingredients = this.ingredients.controls
        .map((c) => ({ name: (c.controls.name.value ?? '').trim() }))
        .filter((i) => i.name.length > 0);
      const steps = this.steps.controls
        .map((c) => ({ text: (c.controls.text.value ?? '').trim() }))
        .filter((s) => s.text.length > 0);
      const duration = this.form.controls.durationMinutes.value;
      const result = await firstValueFrom(
        this.recipesService.suggestTags({
          title,
          description: this.form.controls.description.value || null,
          ingredients,
          steps,
          durationMinutes: typeof duration === 'number' ? duration : null,
        }),
      );
      this.tags.update((current) => {
        const existing = new Set(current);
        const newAuto = new Set(this.autoTags());
        for (const t of result.tags) {
          if (!existing.has(t)) {
            existing.add(t);
            newAuto.add(t);
          }
        }
        this.autoTags.set(newAuto);
        return Array.from(existing);
      });
    } catch {
      // Fehler stillschweigend — Auto-Tags sind nice-to-have
    }
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.isUploading.set(true);
    try {
      const result = await firstValueFrom(this.uploadService.uploadImage(file));
      this.imagePath.set(result.path);
      this.notify.success('Bild hochgeladen');
    } catch (err) {
      this.notify.error('Bild-Upload fehlgeschlagen', (err as Error).message);
    } finally {
      this.isUploading.set(false);
      input.value = '';
    }
  }

  removeImage(): void {
    this.imagePath.set(null);
  }

  async submitForm(): Promise<void> {
    this.submitted.set(true);

    if (this.form.invalid) {
      this.notify.error('Bitte Pflichtfelder ausfüllen');
      return;
    }

    // Auto-Tags ermitteln (überschreibt manuell gesetzte — gewünschtes Verhalten)
    await this.suggestTags();

    const value = this.form.getRawValue();
    const dto: CreateRecipePayload = {
      title: value.title.trim(),
      description: value.description?.trim() || null,
      imagePath: this.imagePath() || null,
      durationMinutes: value.durationMinutes,
      difficulty: value.difficulty,
      rating: value.rating,
      servings: value.servings,
      caloriesPerServing: value.caloriesPerServing,
      proteinPerServing: value.proteinPerServing,
      carbsPerServing: value.carbsPerServing,
      fatPerServing: value.fatPerServing,
      isPrivate: value.isPrivate,
      tags: this.tags(),
      ingredients: value.ingredients.map((i) => {
        const rawAmount = i.amount;
        const num = typeof rawAmount === 'number' ? rawAmount : Number(rawAmount);
        return {
          name: i.name.trim(),
          amount: Number.isFinite(num) && num > 0 ? num : null,
          unit: i.unit?.trim() || null,
        };
      }),
      steps: value.steps.map((s, idx) => ({
        order: idx + 1,
        text: s.text.trim(),
      })),
    };

    this.isLoading.set(true);
    try {
      const editId = this.id();
      const result = editId
        ? await this.store.update(editId, dto)
        : await this.store.create(dto);

      if (result) {
        this.router.navigate(['/rezepte', result.id]);
      }
    } finally {
      this.isLoading.set(false);
    }
  }

  cancel(): void {
    const editId = this.id();
    if (editId) {
      this.router.navigate(['/rezepte', editId]);
    } else {
      this.router.navigate(['/rezepte']);
    }
  }

  isInvalid(controlName: keyof RecipeFormShape): boolean {
    const ctrl = this.form.controls[controlName];
    return ctrl.invalid && (ctrl.touched || this.submitted());
  }

  isIngredientNameInvalid(index: number): boolean {
    const ctrl = this.ingredients.at(index).controls.name;
    return ctrl.invalid && (ctrl.touched || this.submitted());
  }

  isStepTextInvalid(index: number): boolean {
    const ctrl = this.steps.at(index).controls.text;
    return ctrl.invalid && (ctrl.touched || this.submitted());
  }

  // ============ AI ============

  async onAiImageSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    this.aiBusy.set('image');
    try {
      const v = this.form.value;
      const recipe = await this.store.createFromImage(file, {
        title: v.title?.trim() || null,
        description: v.description?.trim() || null,
      });
      if (recipe) {
        await this.router.navigate(['/rezepte']);
      }
    } finally {
      this.aiBusy.set(null);
    }
  }

  openUrlModal(): void {
    this.urlInput.set('');
    this.urlModalOpen.set(true);
  }

  closeUrlModal(): void {
    if (this.aiBusy() === 'url') return;
    this.urlModalOpen.set(false);
  }

  onUrlInput(event: Event): void {
    this.urlInput.set((event.target as HTMLInputElement).value);
  }

  async submitUrl(): Promise<void> {
    const url = this.urlInput().trim();
    if (!url) return;

    this.aiBusy.set('url');
    try {
      const result = await firstValueFrom(this.recipesService.createFromUrl(url));
      if (result.mode === 'sync') {
        // JSON-LD found: fill form, user can edit, manual save
        this.applyDraft(result.draft);
        this.urlModalOpen.set(false);
        this.notify.success('Rezept aus URL extrahiert', 'Bitte vor dem Speichern prüfen.');
      } else {
        // Async path: skeleton recipe was created, redirect to list
        this.urlModalOpen.set(false);
        await this.store.loadAll();
        this.notify.success('Rezept wird analysiert', 'KI läuft im Hintergrund.');
        await this.router.navigate(['/rezepte']);
      }
    } catch (err) {
      this.notify.error('URL-Import fehlgeschlagen', (err as Error).message);
    } finally {
      this.aiBusy.set(null);
    }
  }

  async estimateCalories(): Promise<void> {
    const value = this.form.getRawValue();
    const ingredients = value.ingredients
      .map((i) => ({
        name: i.name.trim(),
        amount: i.amount,
        unit: i.unit?.trim() || null,
      }))
      .filter((i) => i.name.length > 0);

    if (ingredients.length === 0) {
      this.notify.error('Keine Zutaten', 'Bitte zuerst Zutaten eintragen.');
      return;
    }

    this.aiBusy.set('calories');
    try {
      const result = await firstValueFrom(
        this.aiService.estimateCalories({
          ingredients,
          servings: value.servings,
          title: value.title || null,
        }),
      );
      this.form.controls.caloriesPerServing.setValue(result.caloriesPerServing);
      if (result.proteinPerServing !== null) this.form.controls.proteinPerServing.setValue(result.proteinPerServing);
      if (result.carbsPerServing !== null) this.form.controls.carbsPerServing.setValue(result.carbsPerServing);
      if (result.fatPerServing !== null) this.form.controls.fatPerServing.setValue(result.fatPerServing);
      this.notify.success(`Geschätzt: ${result.caloriesPerServing} kcal/Portion`);
    } catch (err) {
      this.notify.error('Kalorien-Schätzung fehlgeschlagen', (err as Error).message);
    } finally {
      this.aiBusy.set(null);
    }
  }

  /**
   * Apply an AI-extracted draft to the form. Only fills empty fields,
   * never overwrites manually entered values — except ingredients/steps
   * which are replaced if the form is empty.
   */
  private applyDraft(draft: ExtractedRecipeDraft): void {
    if (!draft.title && draft.ingredients.length === 0 && draft.steps.length === 0) {
      this.notify.error('Kein Rezept erkannt', 'Die KI konnte keine Rezeptdaten extrahieren.');
      return;
    }

    const ctrls = this.form.controls;

    if (draft.title && !ctrls.title.value.trim()) {
      ctrls.title.setValue(draft.title);
    }
    if (draft.description && !ctrls.description.value?.trim()) {
      ctrls.description.setValue(draft.description);
    }
    if (draft.durationMinutes !== null && ctrls.durationMinutes.value === null) {
      ctrls.durationMinutes.setValue(draft.durationMinutes);
    }
    if (draft.difficulty !== null && ctrls.difficulty.value === null) {
      ctrls.difficulty.setValue(draft.difficulty);
    }
    if (draft.servings !== null && ctrls.servings.value === null) {
      ctrls.servings.setValue(draft.servings);
    }
    if (draft.proteinPerServing !== null && ctrls.proteinPerServing.value === null) {
      ctrls.proteinPerServing.setValue(draft.proteinPerServing);
    }
    if (draft.carbsPerServing !== null && ctrls.carbsPerServing.value === null) {
      ctrls.carbsPerServing.setValue(draft.carbsPerServing);
    }
    if (draft.fatPerServing !== null && ctrls.fatPerServing.value === null) {
      ctrls.fatPerServing.setValue(draft.fatPerServing);
    }
    if (draft.caloriesPerServing !== null && ctrls.caloriesPerServing.value === null) {
      ctrls.caloriesPerServing.setValue(draft.caloriesPerServing);
    }

    // Tags: merge, dedupe
    if (draft.tags.length > 0) {
      const current = new Set(this.tags());
      for (const tag of draft.tags) {
        if (!current.has(tag)) current.add(tag);
      }
      this.tags.set([...current]);
    }

    // Ingredients: replace if form is "empty" (single empty row)
    if (draft.ingredients.length > 0 && this.formIngredientsEmpty()) {
      const validIngredients = draft.ingredients.filter(
        (i) => i.name && i.name.trim().length > 0,
      );
      if (validIngredients.length > 0) {
        this.ingredients.clear();
        for (const ing of validIngredients) {
          this.ingredients.push(
            this.fb.group<IngredientFormShape>({
              name: this.fb.control(ing.name.trim(), { validators: [Validators.required] }),
              amount: this.fb.control<number | null>(ing.amount),
              unit: this.fb.control<string | null>(ing.unit),
            }),
          );
        }
        this.ingredientsVersion.update((v) => v + 1);
      }
    }

    // Steps: replace if form is "empty"
    if (draft.steps.length > 0 && this.formStepsEmpty()) {
      const validSteps = draft.steps.filter((s) => s.text && s.text.trim().length > 0);
      if (validSteps.length > 0) {
        this.steps.clear();
        for (const step of validSteps) {
          this.steps.push(
            this.fb.group<StepFormShape>({
              text: this.fb.control(step.text.trim(), { validators: [Validators.required] }),
            }),
          );
        }
        this.stepsVersion.update((v) => v + 1);
      }
    }
  }

  private formIngredientsEmpty(): boolean {
    return this.ingredients.controls.every(
      (g) => !g.controls.name.value.trim() && g.controls.amount.value === null,
    );
  }

  private formStepsEmpty(): boolean {
    return this.steps.controls.every((g) => !g.controls.text.value.trim());
  }
}
