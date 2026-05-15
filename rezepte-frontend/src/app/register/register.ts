import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormControl, FormGroup, NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthStore } from '../store/Auth/Auth.store';
import { NotificationStore } from '../store/Notification/Notification.store';

interface RegisterFormShape {
  email: FormControl<string>;
  username: FormControl<string>;
  password: FormControl<string>;
  displayName: FormControl<string>;
}

@Component({
  selector: 'app-register',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './register.html',
  styleUrl: './register.css',
})
export class RegisterComponent {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly auth = inject(AuthStore);
  private readonly notify = inject(NotificationStore);
  private readonly router = inject(Router);

  readonly form: FormGroup<RegisterFormShape> = this.fb.group<RegisterFormShape>({
    email: this.fb.control('', { validators: [Validators.required, Validators.email] }),
    username: this.fb.control('', { validators: [Validators.required, Validators.minLength(3), Validators.maxLength(30), Validators.pattern(/^[a-z0-9_-]+$/i)] }),
    password: this.fb.control('', { validators: [Validators.required, Validators.minLength(8)] }),
    displayName: this.fb.control(''),
  });

  readonly loading = signal(false);

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.loading.set(true);
    const { email, username, password, displayName } = this.form.getRawValue();
    const ok = await this.auth.register({
      email: email.trim().toLowerCase(),
      username: username.trim().toLowerCase(),
      password,
      displayName: displayName.trim() || undefined,
    });
    this.loading.set(false);
    if (ok) {
      this.notify.success('Konto erstellt', 'Willkommen!');
      this.router.navigate(['/rezepte']);
    } else {
      this.notify.error('Registrierung fehlgeschlagen', 'E-Mail oder Benutzername evtl. schon vergeben.');
    }
  }
}
