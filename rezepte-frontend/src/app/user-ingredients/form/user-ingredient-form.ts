import { Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  FormControl, FormGroup, NonNullableFormBuilder,
  ReactiveFormsModule, Validators,
} from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { UserIngredientsStore } from '../../store/UserIngredients/UserIngredients.store';
import { NotificationStore } from '../../store/Notification/Notification.store';
import { UserIngredientsService } from '../../services/user-ingredients/user-ingredients.service';
import { BarcodeScannerComponent } from '../barcode-scanner/barcode-scanner';

interface FormShape {
  name: FormControl<string>;
  aliasesText: FormControl<string>;
  kcalPer100g: FormControl<number | null>;
  defaultGramsPerPiece: FormControl<number | null>;
}

@Component({
  selector: 'app-user-ingredient-form',
  imports: [ReactiveFormsModule, RouterLink, BarcodeScannerComponent],
  templateUrl: './user-ingredient-form.html',
  styleUrl: './user-ingredient-form.css',
})
export class UserIngredientFormComponent {
  /** Wenn gesetzt: Edit-Modus */
  readonly id = input<string>();

  private readonly fb = inject(NonNullableFormBuilder);
  private readonly store = inject(UserIngredientsStore);
  private readonly service = inject(UserIngredientsService);
  private readonly notify = inject(NotificationStore);
  private readonly router = inject(Router);

  readonly form: FormGroup<FormShape> = this.fb.group<FormShape>({
    name: this.fb.control('', { validators: [Validators.required, Validators.minLength(2)] }),
    aliasesText: this.fb.control(''),
    kcalPer100g: this.fb.control<number | null>(null, { validators: [Validators.required, Validators.min(0), Validators.max(2000)] }),
    defaultGramsPerPiece: this.fb.control<number | null>(null, { validators: [Validators.min(0), Validators.max(10000)] }),
  });

  readonly busy = signal(false);
  readonly scanning = signal(false);
  readonly looking = signal(false);
  readonly isEdit = computed(() => !!this.id());
  readonly title = computed(() => this.isEdit() ? 'Zutat bearbeiten' : 'Neue Zutat');

  async ngOnInit(): Promise<void> {
    if (!this.store.loaded()) {
      try { await this.store.load(); } catch { /* ignore */ }
    }
    const id = this.id();
    if (id) {
      const existing = this.store.items().find((i) => i.id === id);
      if (existing) {
        this.form.patchValue({
          name: existing.name,
          aliasesText: existing.aliases.join(', '),
          kcalPer100g: existing.kcalPer100g,
          defaultGramsPerPiece: existing.defaultGramsPerPiece,
        });
      }
    }
  }

  openScanner(): void {
    this.scanning.set(true);
  }

  closeScanner(): void {
    this.scanning.set(false);
  }

  async onBarcodeDetected(barcode: string): Promise<void> {
    this.scanning.set(false);
    this.looking.set(true);
    try {
      const data = await firstValueFrom(this.service.lookupBarcode(barcode));
      // Form vorbefüllen — User kann anschließend nachbearbeiten
      const patch: Partial<{ name: string; kcalPer100g: number | null; defaultGramsPerPiece: number | null }> = {};
      if (data.name) patch.name = data.name;
      if (data.kcalPer100g !== null) patch.kcalPer100g = data.kcalPer100g;
      if (data.gramsPerPiece !== null) patch.defaultGramsPerPiece = data.gramsPerPiece;
      this.form.patchValue(patch);

      if (data.kcalPer100g === null) {
        this.notify.success('Produkt gefunden', 'Kalorien fehlen leider — bitte manuell ergänzen.');
      } else {
        this.notify.success('Produkt gefunden', `${data.name} · ${data.kcalPer100g} kcal/100g`);
      }
    } catch (err) {
      const e = err as { error?: { message?: string }; status?: number };
      const message = e?.error?.message || (err as Error).message;
      if (e?.status === 404) {
        this.notify.error('Barcode nicht gefunden', 'Bitte manuell eingeben.');
      } else {
        this.notify.error('Lookup fehlgeschlagen', message);
      }
    } finally {
      this.looking.set(false);
    }
  }

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    try {
      const v = this.form.getRawValue();
      const aliases = v.aliasesText
        .split(',')
        .map((a) => a.trim())
        .filter((a) => a.length >= 2);
      const payload = {
        name: v.name.trim(),
        aliases,
        kcalPer100g: v.kcalPer100g!,
        defaultGramsPerPiece: v.defaultGramsPerPiece,
      };
      const id = this.id();
      if (id) {
        await this.store.update(id, payload);
        this.notify.success('Zutat aktualisiert');
      } else {
        await this.store.create(payload);
        this.notify.success('Zutat hinzugefügt');
      }
      this.router.navigate(['/vorrat']);
    } catch (err) {
      this.notify.error('Speichern fehlgeschlagen', (err as Error).message);
    } finally {
      this.busy.set(false);
    }
  }
}
