import { Injectable, computed, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs';

const TAB_ORDER = ['/rezepte', '/plan', '/ideen', '/vorrat', '/wein', '/restaurants', '/gefolgt'] as const;

@Injectable({ providedIn: 'root' })
export class TabNavigationService {
  private readonly router = inject(Router);

  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.url),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  /** Aktueller Tab-Index, oder -1 wenn nicht auf einer Tab-Liste */
  readonly currentTabIndex = computed(() => {
    const url = this.currentUrl();
    const exact = url === '/' ? '/rezepte' : url;
    return TAB_ORDER.findIndex((t) => exact === t);
  });

  /** True nur wenn wir DIREKT auf einer der Tab-Listen sind (nicht in /rezepte/123) */
  readonly isOnTabList = computed(() => this.currentTabIndex() >= 0);

  next(): void {
    const idx = this.currentTabIndex();
    if (idx < 0 || idx >= TAB_ORDER.length - 1) return;
    this.router.navigate([TAB_ORDER[idx + 1]]);
  }

  prev(): void {
    const idx = this.currentTabIndex();
    if (idx <= 0) return;
    this.router.navigate([TAB_ORDER[idx - 1]]);
  }
}
