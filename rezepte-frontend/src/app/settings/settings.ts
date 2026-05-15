import { Component, computed, inject, signal, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { FormControl, FormGroup, NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { AuthStore } from '../store/Auth/Auth.store';
import { ThemeStore, ThemeMode } from '../store/Theme/Theme.store';
import { NotificationStore } from '../store/Notification/Notification.store';
import { AuthService } from '../services/auth/auth.service';
import { AdminService, OllamaQueueEntry } from '../services/admin/admin.service';

interface ProfileFormShape {
  displayName: FormControl<string>;
  username: FormControl<string>;
}

interface PasswordFormShape {
  currentPassword: FormControl<string>;
  newPassword: FormControl<string>;
}

@Component({
  selector: 'app-settings',
  imports: [ReactiveFormsModule],
  templateUrl: './settings.html',
  styleUrl: './settings.css',
})
export class SettingsComponent implements OnInit, OnDestroy {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly auth = inject(AuthStore);
  readonly theme = inject(ThemeStore);
  private readonly authService = inject(AuthService);
  private readonly adminService = inject(AdminService);
  private readonly notify = inject(NotificationStore);
  private readonly router = inject(Router);

  readonly user = computed(() => this.auth.user());

  readonly profileForm: FormGroup<ProfileFormShape> = this.fb.group<ProfileFormShape>({
    displayName: this.fb.control(this.auth.user()?.displayName ?? ''),
    username: this.fb.control(this.auth.user()?.username ?? ''),
  });

  readonly passwordForm: FormGroup<PasswordFormShape> = this.fb.group<PasswordFormShape>({
    currentPassword: this.fb.control('', { validators: [Validators.required] }),
    newPassword: this.fb.control('', { validators: [Validators.required, Validators.minLength(8)] }),
  });

  readonly themeOptions: { value: ThemeMode; label: string }[] = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Hell' },
    { value: 'dark', label: 'Dunkel' },
  ];

  readonly profileBusy = signal(false);
  readonly passwordBusy = signal(false);
  readonly showDeleteModal = signal(false);
  readonly deleteBusy = signal(false);

  // 2FA-State
  readonly totpEnabled = computed(() => !!this.auth.user()?.totpEnabled);
  readonly totpSetupOpen = signal(false);
  readonly totpQrUrl = signal<string | null>(null);
  readonly totpSecret = signal<string | null>(null);
  readonly totpCode = signal('');
  readonly totpBusy = signal(false);
  readonly totpRecoveryCodes = signal<string[] | null>(null);
  readonly totpDisableOpen = signal(false);
  readonly totpDisablePassword = signal('');
  readonly secretCopied = signal(false);

  // Admin
  readonly isAdmin = computed(() => !!this.auth.user()?.isAdmin);
  readonly ollamaQueue = signal<OllamaQueueEntry[]>([]);
  readonly ollamaQueueNow = signal<number>(Date.now());
  readonly ollamaQueueError = signal<string | null>(null);
  private ollamaPollTimer: ReturnType<typeof setInterval> | null = null;
  readonly ollamaPolling = signal(false);

  ngOnInit(): void {
    if (this.isAdmin()) {
      this.refreshOllamaQueue();
    }
  }

  ngOnDestroy(): void {
    this.stopOllamaPoll();
  }

  startOllamaPoll(): void {
    if (this.ollamaPollTimer) return;
    this.refreshOllamaQueue();
    this.ollamaPollTimer = setInterval(() => this.refreshOllamaQueue(), 2000);
    this.ollamaPolling.set(true);
  }

  stopOllamaPoll(): void {
    if (this.ollamaPollTimer) {
      clearInterval(this.ollamaPollTimer);
      this.ollamaPollTimer = null;
      this.ollamaPolling.set(false);
    }
  }

  async refreshOllamaQueue(): Promise<void> {
    try {
      const res = await firstValueFrom(this.adminService.ollamaQueue());
      this.ollamaQueue.set(res.entries);
      this.ollamaQueueNow.set(res.now);
      this.ollamaQueueError.set(null);
    } catch (err) {
      this.ollamaQueueError.set((err as Error).message);
    }
  }

  formatDuration(ms: number): string {
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    const remSec = sec % 60;
    return `${min}m ${remSec}s`;
  }

  /** Verbleibende Zeit für laufenden Eintrag, oder geschätzte Gesamtzeit für wartenden. */
  etaLabel(e: OllamaQueueEntry): string | null {
    if (e.etaMs === null) return null;
    if (e.status === 'running' && e.startedAt) {
      const elapsed = this.ollamaQueueNow() - e.startedAt;
      const remaining = e.etaMs - elapsed;
      if (remaining > 0) return `~${this.formatDuration(remaining)}`;
      return 'überzogen';
    }
    if (e.status === 'waiting') {
      return `~${this.formatDuration(e.etaMs)}`;
    }
    return null;
  }

  async cancelOllamaEntry(id: number): Promise<void> {
    try {
      await firstValueFrom(this.adminService.cancelOllamaEntry(id));
      this.refreshOllamaQueue();
    } catch (err) {
      this.notify.error('Abbruch fehlgeschlagen', (err as Error).message);
    }
  }

  readonly cancelAllBusy = signal(false);

  async cancelAllOllama(): Promise<void> {
    if (!confirm('Alle laufenden und wartenden Ollama-Tasks abbrechen und Models entladen?')) return;
    this.cancelAllBusy.set(true);
    try {
      const res = await firstValueFrom(this.adminService.cancelAllOllama());
      this.notify.success('Queue geleert', `${res.cancelled} abgebrochen, Models werden im Hintergrund entladen`);
      this.refreshOllamaQueue();
    } catch (err) {
      this.notify.error('Abbruch fehlgeschlagen', (err as Error).message);
    } finally {
      this.cancelAllBusy.set(false);
    }
  }

  async copySecret(secret: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(secret);
      this.secretCopied.set(true);
      setTimeout(() => this.secretCopied.set(false), 2000);
    } catch {
      this.notify.error('Kopieren fehlgeschlagen', 'Bitte manuell markieren und kopieren.');
    }
  }

  setTheme(mode: ThemeMode): void {
    this.theme.setMode(mode);
  }

  async saveProfile(): Promise<void> {
    if (this.profileForm.invalid) return;
    this.profileBusy.set(true);
    try {
      const { displayName, username } = this.profileForm.getRawValue();
      const updated = await firstValueFrom(this.authService.updateProfile(displayName.trim() || null, username.trim() || null));
      this.auth.setUser(updated);
      this.notify.success('Profil aktualisiert');
    } catch (err) {
      this.notify.error('Aktualisieren fehlgeschlagen', (err as Error).message);
    } finally {
      this.profileBusy.set(false);
    }
  }

  async changePassword(): Promise<void> {
    if (this.passwordForm.invalid) {
      this.passwordForm.markAllAsTouched();
      return;
    }
    this.passwordBusy.set(true);
    try {
      const { currentPassword, newPassword } = this.passwordForm.getRawValue();
      await firstValueFrom(this.authService.changePassword(currentPassword, newPassword));
      this.notify.success('Passwort geändert', 'Bitte neu anmelden.');
      this.passwordForm.reset();
      // Force re-login since refresh tokens were invalidated
      await this.auth.logout();
      this.router.navigate(['/login']);
    } catch (err) {
      this.notify.error('Passwort konnte nicht geändert werden', (err as Error).message);
    } finally {
      this.passwordBusy.set(false);
    }
  }

  async logout(): Promise<void> {
    await this.auth.logout();
    this.router.navigate(['/login']);
  }

  openDelete(): void { this.showDeleteModal.set(true); }
  cancelDelete(): void { this.showDeleteModal.set(false); }

  async confirmDelete(): Promise<void> {
    this.deleteBusy.set(true);
    try {
      await firstValueFrom(this.authService.deleteAccount());
      await this.auth.logout();
      this.notify.success('Konto gelöscht');
      this.router.navigate(['/register']);
    } catch (err) {
      this.notify.error('Löschen fehlgeschlagen', (err as Error).message);
    } finally {
      this.deleteBusy.set(false);
      this.showDeleteModal.set(false);
    }
  }

  async openTotpSetup(): Promise<void> {
    this.totpBusy.set(true);
    try {
      const res = await firstValueFrom(this.authService.totpSetup());
      this.totpQrUrl.set(res.qrDataUrl);
      this.totpSecret.set(res.secret);
      this.totpSetupOpen.set(true);
      this.totpCode.set('');
    } catch (err) {
      this.notify.error('Setup fehlgeschlagen', (err as Error).message);
    } finally {
      this.totpBusy.set(false);
    }
  }

  async confirmTotpEnable(): Promise<void> {
    const code = this.totpCode().trim();
    if (code.length !== 6) {
      this.notify.error('Code ungültig', '6-stelligen Code aus der App eingeben.');
      return;
    }
    this.totpBusy.set(true);
    try {
      const res = await firstValueFrom(this.authService.totpEnable(code));
      this.totpRecoveryCodes.set(res.recoveryCodes);
      const user = this.auth.user();
      if (user) this.auth.setUser({ ...user, totpEnabled: true });
      this.notify.success('2FA aktiviert');
    } catch (err) {
      this.notify.error('Aktivierung fehlgeschlagen', (err as Error).message);
    } finally {
      this.totpBusy.set(false);
    }
  }

  closeTotpSetup(): void {
    this.totpSetupOpen.set(false);
    this.totpQrUrl.set(null);
    this.totpSecret.set(null);
    this.totpCode.set('');
    this.totpRecoveryCodes.set(null);
  }

  openTotpDisable(): void {
    this.totpDisablePassword.set('');
    this.totpDisableOpen.set(true);
  }

  cancelTotpDisable(): void {
    this.totpDisableOpen.set(false);
    this.totpDisablePassword.set('');
  }

  async confirmTotpDisable(): Promise<void> {
    const password = this.totpDisablePassword();
    if (!password) return;
    this.totpBusy.set(true);
    try {
      await firstValueFrom(this.authService.totpDisable(password));
      const user = this.auth.user();
      if (user) this.auth.setUser({ ...user, totpEnabled: false });
      this.notify.success('2FA deaktiviert');
      this.totpDisableOpen.set(false);
      this.totpDisablePassword.set('');
    } catch (err) {
      this.notify.error('Deaktivieren fehlgeschlagen', (err as Error).message);
    } finally {
      this.totpBusy.set(false);
    }
  }
}
