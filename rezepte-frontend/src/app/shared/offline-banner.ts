import { Component, OnDestroy, OnInit, signal } from '@angular/core';

@Component({
  selector: 'app-offline-banner',
  standalone: true,
  template: `
    @if (offline()) {
      <div class="offline-banner">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="1" y1="1" x2="23" y2="23"/>
          <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/>
          <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/>
          <path d="M10.71 5.05A16 16 0 0 1 22.58 9"/>
          <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/>
          <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
          <line x1="12" y1="20" x2="12.01" y2="20"/>
        </svg>
        <span>Offline – zeige zwischengespeicherte Daten</span>
      </div>
    }
  `,
  styles: [`
    .offline-banner {
      position: fixed;
      top: env(safe-area-inset-top, 0);
      left: 0;
      right: 0;
      z-index: 60;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      padding: 0.5rem 1rem;
      font-size: 0.8125rem;
      background-color: var(--color-danger-soft);
      color: var(--color-danger);
      border-bottom: 1px solid var(--color-divider);
    }
  `],
})
export class OfflineBannerComponent implements OnInit, OnDestroy {
  offline = signal(!navigator.onLine);
  private onlineHandler = () => this.offline.set(false);
  private offlineHandler = () => this.offline.set(true);

  ngOnInit(): void {
    window.addEventListener('online', this.onlineHandler);
    window.addEventListener('offline', this.offlineHandler);
  }
  ngOnDestroy(): void {
    window.removeEventListener('online', this.onlineHandler);
    window.removeEventListener('offline', this.offlineHandler);
  }
}
