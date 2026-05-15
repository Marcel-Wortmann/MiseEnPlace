import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormControl, FormGroup, NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthStore } from '../store/Auth/Auth.store';
import { NotificationStore } from '../store/Notification/Notification.store';

interface LoginFormShape {
  email: FormControl<string>;
  password: FormControl<string>;
}

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class LoginComponent {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly auth = inject(AuthStore);
  private readonly notify = inject(NotificationStore);
  private readonly router = inject(Router);

  readonly form: FormGroup<LoginFormShape> = this.fb.group<LoginFormShape>({
    email: this.fb.control('', { validators: [Validators.required, Validators.email] }),
    password: this.fb.control('', { validators: [Validators.required, Validators.minLength(8)] }),
  });

  readonly loading = signal(false);
  readonly totpStep = signal(false);
  readonly totpCode = signal('');
  readonly totpError = signal<string | null>(null);

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.loading.set(true);
    const { email, password } = this.form.getRawValue();
    const result = await this.auth.login({ email: email.trim().toLowerCase(), password });
    this.loading.set(false);
    if ('ok' in result && result.ok) {
      this.notify.success('Willkommen zurück');
      this.router.navigate(['/rezepte']);
    } else if (result.totpRequired) {
      this.totpStep.set(true);
    } else {
      this.notify.error('Anmeldung fehlgeschlagen', 'E-Mail oder Passwort ungültig.');
    }
  }

  async submitTotp(): Promise<void> {
    const code = this.totpCode().trim().replace(/\s/g, '');
    if (code.length < 6) {
      this.totpError.set('Bitte Code eingeben (6 Ziffern oder Recovery-Code).');
      return;
    }
    this.totpError.set(null);
    this.loading.set(true);
    const { email, password } = this.form.getRawValue();
    try {
      const result = await this.auth.login({
        email: email.trim().toLowerCase(),
        password,
        totpCode: code,
      });
      // eslint-disable-next-line no-console
      console.log('[Login] TOTP submit result:', result);
      if ('ok' in result && result.ok) {
        this.notify.success('Willkommen zurück');
        this.router.navigate(['/rezepte']);
      } else {
        // Bleibe explizit im TOTP-Step
        this.totpStep.set(true);
        this.totpError.set('Code ungültig. Bitte erneut versuchen.');
        this.totpCode.set('');
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[Login] TOTP submit error:', err);
      this.totpStep.set(true);
      this.totpError.set('Code ungültig. Bitte erneut versuchen.');
    } finally {
      this.loading.set(false);
    }
  }

  cancelTotp(): void {
    this.totpStep.set(false);
    this.totpCode.set('');
    this.totpError.set(null);
  }
}
