import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  FormControl,
  FormGroup,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { WinesStore } from '../../store/Wines/Wines.store';
import { UploadService } from '../../services/upload/upload.service';
import { NotificationStore } from '../../store/Notification/Notification.store';
import { CreateWinePayload } from '../../services/wines/wines.service';
import { Wine, WineRating, WineType } from '@shared/interfaces';

interface WineFormShape {
  rating: FormControl<WineRating | null>;
  notes: FormControl<string | null>;
  name: FormControl<string | null>;
  vintage: FormControl<number | null>;
  winery: FormControl<string | null>;
  region: FormControl<string | null>;
  country: FormControl<string | null>;
  grape: FormControl<string | null>;
  wineType: FormControl<WineType | null>;
}

@Component({
  selector: 'app-wine-form',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './wine-form.html',
  styleUrl: './wine-form.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WineFormComponent implements OnInit {
  readonly id = input<string | undefined>(undefined);

  private readonly fb = inject(NonNullableFormBuilder);
  private readonly router = inject(Router);
  private readonly store = inject(WinesStore);
  private readonly uploadService = inject(UploadService);
  private readonly notify = inject(NotificationStore);

  readonly ratings: { value: WineRating; label: string }[] = [
    { value: 'schlecht', label: 'Schlecht' },
    { value: 'okay', label: 'Okay' },
    { value: 'gut', label: 'Gut' },
    { value: 'sehr_gut', label: 'Sehr gut' },
  ];

  readonly types: { value: WineType; label: string }[] = [
    { value: 'rot', label: 'Rot' },
    { value: 'weiss', label: 'Weiß' },
    { value: 'rose', label: 'Rosé' },
    { value: 'schaumwein', label: 'Schaumwein' },
  ];

  readonly form: FormGroup<WineFormShape> = this.fb.group<WineFormShape>({
    rating: this.fb.control<WineRating | null>(null),
    notes: this.fb.control<string | null>(null),
    name: this.fb.control<string | null>(null),
    vintage: this.fb.control<number | null>(null, { validators: [Validators.min(1800), Validators.max(2100)] }),
    winery: this.fb.control<string | null>(null),
    region: this.fb.control<string | null>(null),
    country: this.fb.control<string | null>(null),
    grape: this.fb.control<string | null>(null),
    wineType: this.fb.control<WineType | null>(null),
  });

  readonly imagePath = signal<string | null>(null);
  readonly imagePathBack = signal<string | null>(null);
  readonly isUploading = signal<null | 'front' | 'back'>(null);
  readonly isLoading = signal(false);
  readonly submitted = signal(false);
  readonly isEditMode = computed(() => !!this.id());
  readonly imageUrl = computed(() => {
    const p = this.imagePath();
    return p ? this.uploadService.thumbUrl(p, 480) : null;
  });
  readonly imageUrlBack = computed(() => {
    const p = this.imagePathBack();
    return p ? this.uploadService.thumbUrl(p, 480) : null;
  });

  constructor() {
    console.time('WineForm:ctor→view');
    queueMicrotask(() => console.timeEnd('WineForm:ctor→view'));
  }

  ngOnInit(): void {
    console.time('WineForm:ngOnInit');
    const id = this.id();
    if (!id) { console.timeEnd('WineForm:ngOnInit'); return; }
    const cached = this.store.findById(id);
    if (cached) {
      this.populateForm(cached);
      console.timeEnd('WineForm:ngOnInit');
      return;
    }
    this.store.loadAll().then(() => {
      const wine = this.store.findById(id);
      if (wine) this.populateForm(wine);
      console.timeEnd('WineForm:ngOnInit');
    });
  }

  private populateForm(wine: Wine): void {
    this.imagePath.set(wine.imagePath);
    this.imagePathBack.set(wine.imagePathBack);
    this.form.patchValue({
      rating: wine.rating,
      notes: wine.notes,
      name: wine.name,
      vintage: wine.vintage,
      winery: wine.winery,
      region: wine.region,
      country: wine.country,
      grape: wine.grape,
      wineType: wine.wineType,
    });
  }

  async onFileSelected(event: Event, slot: 'front' | 'back'): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    this.isUploading.set(slot);
    try {
      const result = await firstValueFrom(this.uploadService.uploadImage(file));
      if (slot === 'front') {
        this.imagePath.set(result.path);
      } else {
        this.imagePathBack.set(result.path);
      }
    } catch (err) {
      this.notify.error('Bild-Upload fehlgeschlagen', (err as Error).message);
    } finally {
      this.isUploading.set(null);
    }
  }

  removeImage(slot: 'front' | 'back'): void {
    if (slot === 'front') {
      this.imagePath.set(null);
    } else {
      this.imagePathBack.set(null);
    }
  }

  setRating(value: WineRating): void {
    const current = this.form.controls.rating.value;
    this.form.controls.rating.setValue(current === value ? null : value);
  }

  setWineType(value: WineType): void {
    const current = this.form.controls.wineType.value;
    this.form.controls.wineType.setValue(current === value ? null : value);
  }

  cancel(): void {
    const id = this.id();
    if (id) {
      this.router.navigate(['/wein', id]);
    } else {
      this.router.navigate(['/wein']);
    }
  }

  async submitForm(): Promise<void> {
    this.isLoading.set(true);
    this.submitted.set(true);

    try {
      // Mindestens ein Bild muss da sein. Wenn nur Rückseite, verwende sie als Hauptbild.
      let frontPath = this.imagePath();
      let backPath = this.imagePathBack();
      if (!frontPath && backPath) {
        frontPath = backPath;
        backPath = null;
      }

      if (!frontPath) {
        this.notify.error('Bitte Foto hochladen', 'Mindestens ein Bild ist nötig.');
        return;
      }
      if (this.form.invalid) {
        this.form.markAllAsTouched();
        return;
      }

      const value = this.form.getRawValue();
      const dto: CreateWinePayload = {
        imagePath: frontPath,
        imagePathBack: backPath,
        rating: value.rating,
        notes: value.notes?.trim() || null,
        name: value.name?.trim() || null,
        vintage: value.vintage,
        winery: value.winery?.trim() || null,
        region: value.region?.trim() || null,
        country: value.country?.trim() || null,
        grape: value.grape?.trim() || null,
        wineType: value.wineType,
      };

      const id = this.id();
      const wine = id ? await this.store.update(id, dto) : await this.store.create(dto);
      if (wine) this.router.navigate(['/wein', wine.id]);
    } finally {
      this.isLoading.set(false);
    }
  }
}
