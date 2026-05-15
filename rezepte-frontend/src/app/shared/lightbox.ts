import { Component, computed, effect, inject, Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class LightboxService {
  readonly src = signal<string | null>(null);
  readonly alt = signal<string>('');

  open(src: string, alt = ''): void {
    this.src.set(src);
    this.alt.set(alt);
  }

  close(): void {
    this.src.set(null);
  }
}

@Component({
  selector: 'app-lightbox',
  standalone: true,
  template: `
    @if (lightbox.src(); as src) {
      <div class="fixed inset-0 z-[100] flex items-center justify-center select-none"
           style="background: rgba(0,0,0,0.95);"
           (click)="lightbox.close()">
        <button type="button"
                class="absolute top-4 right-4 w-10 h-10 rounded-full flex items-center justify-center"
                style="background: rgba(255,255,255,0.15); color: white;"
                (click)="lightbox.close(); $event.stopPropagation()"
                aria-label="Schließen">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
        <img [src]="src" [alt]="lightbox.alt()" class="max-w-full max-h-full object-contain"
             (click)="$event.stopPropagation()" />
      </div>
    }
  `,
})
export class LightboxComponent {
  readonly lightbox = inject(LightboxService);

  constructor() {
    // ESC-Key schließt
    effect((onCleanup) => {
      if (this.lightbox.src() === null) return;
      const handler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') this.lightbox.close();
      };
      document.addEventListener('keydown', handler);
      onCleanup(() => document.removeEventListener('keydown', handler));
    });
  }
}
