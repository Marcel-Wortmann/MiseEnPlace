import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormControl, FormGroup, NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { RecipeIdeasStore } from '../../store/RecipeIdeas/RecipeIdeas.store';
import { CreateRecipeIdeaPayload, RecipeIdeasService } from '../../services/recipe-ideas/recipe-ideas.service';
import { UploadService } from '../../services/upload/upload.service';
import { NotificationStore } from '../../store/Notification/Notification.store';
import { RecipeIdea } from '@shared/interfaces';

interface IdeaFormShape {
  title: FormControl<string | null>;
  note: FormControl<string | null>;
}

@Component({
  selector: 'app-recipe-idea-form',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './recipe-idea-form.html',
  styleUrl: './recipe-idea-form.css',
})
export class RecipeIdeaFormComponent implements OnInit {
  readonly id = input<string | undefined>(undefined);

  private readonly fb = inject(NonNullableFormBuilder);
  private readonly router = inject(Router);
  private readonly store = inject(RecipeIdeasStore);
  private readonly ideasService = inject(RecipeIdeasService);
  private readonly uploadService = inject(UploadService);
  private readonly notify = inject(NotificationStore);

  readonly form: FormGroup<IdeaFormShape> = this.fb.group<IdeaFormShape>({
    title: this.fb.control<string | null>(null),
    note: this.fb.control<string | null>(null),
  });

  readonly imagePath = signal<string | null>(null);
  readonly isLoading = signal(false);
  readonly isUploading = signal(false);
  readonly isEditMode = computed(() => !!this.id());

  readonly imageUrl = computed(() => this.uploadService.resolveUrl(this.imagePath()));

  async ngOnInit(): Promise<void> {
    const id = this.id();
    if (!id) {
      return;
    }
    const cached = this.store.findById(id);
    if (cached) {
      this.populateForm(cached);
      return;
    }
    this.isLoading.set(true);
    try {
      const idea = await firstValueFrom(this.ideasService.loadOne(id));
      this.populateForm(idea);
    } catch {
      this.notify.error('Idee konnte nicht geladen werden');
      this.router.navigate(['/ideen']);
    } finally {
      this.isLoading.set(false);
    }
  }

  private populateForm(idea: RecipeIdea): void {
    this.form.patchValue({
      title: idea.title,
      note: idea.note,
    });
    this.imagePath.set(idea.imagePath);
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
    const value = this.form.getRawValue();
    const title = value.title?.trim() || null;
    const note = value.note?.trim() || null;

    if (!title && !note && !this.imagePath()) {
      this.notify.error('Bitte mindestens Titel, Notiz oder Bild angeben');
      return;
    }

    const dto: CreateRecipeIdeaPayload = {
      title,
      note,
      imagePath: this.imagePath(),
    };

    this.isLoading.set(true);
    try {
      const editId = this.id();
      const result = editId
        ? await this.store.update(editId, dto)
        : await this.store.create(dto);

      if (result) {
        this.router.navigate(['/ideen']);
      }
    } finally {
      this.isLoading.set(false);
    }
  }

  cancel(): void {
    this.router.navigate(['/ideen']);
  }
}
