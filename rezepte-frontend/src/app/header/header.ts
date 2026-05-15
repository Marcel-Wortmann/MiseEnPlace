import { Component, ElementRef, computed, effect, inject, signal, ViewChild, OnInit } from '@angular/core';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs';
import { AuthStore } from '../store/Auth/Auth.store';
import { ShoppingStore } from '../store/Shopping/Shopping.store';

@Component({
  selector: 'app-header',
  imports: [RouterLink],
  templateUrl: './header.html',
  styleUrl: './header.css',
})
export class HeaderComponent implements OnInit {
  private readonly router = inject(Router);
  readonly auth = inject(AuthStore);
  readonly shopping = inject(ShoppingStore);

  @ViewChild('tabNav') tabNav?: ElementRef<HTMLElement>;

  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map((event) => (event as NavigationEnd).urlAfterRedirects),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  constructor() {
    // Effekt feuert bei jedem URL-Wechsel — scrollt aktiven Tab in den sichtbaren Bereich
    effect(() => {
      this.currentUrl();
      // Erst nach Rendering der neuen Tab-Active-Klasse messen
      requestAnimationFrame(() => this.scrollActiveTabIntoView());
    });
  }

  async ngOnInit(): Promise<void> {
    if (this.auth.isAuthenticated() && this.shopping.totalCount() === 0) {
      await this.shopping.load();
    }
  }

  private scrollActiveTabIntoView(): void {
    const nav = this.tabNav?.nativeElement;
    if (!nav) return;
    const active = nav.querySelector<HTMLElement>('.tab-active');
    if (!active) return;
    // Mittig scrollen — egal ob Tab links oder rechts vom Sichtbereich liegt
    const target = active.offsetLeft - nav.clientWidth / 2 + active.clientWidth / 2;
    const max = nav.scrollWidth - nav.clientWidth;
    const clamped = Math.max(0, Math.min(target, max));
    nav.scrollTo({ left: clamped, behavior: 'smooth' });
  }

  readonly isRecipesTab = computed(() => {
    const url = this.currentUrl();
    return url === '/' || url.startsWith('/rezepte');
  });
  readonly isIdeasTab = computed(() => this.currentUrl().startsWith('/ideen'));
  readonly isWinesTab = computed(() => this.currentUrl().startsWith('/wein'));
  readonly isRestaurantsTab = computed(() => this.currentUrl().startsWith('/restaurants'));
  readonly isPlanTab = computed(() => this.currentUrl().startsWith('/plan'));
  readonly isFollowTab = computed(() => this.currentUrl().startsWith('/gefolgt'));
  readonly isVorratTab = computed(() => this.currentUrl().startsWith('/vorrat'));

  readonly menuOpen = signal(false);

  readonly initial = computed(() => {
    const u = this.auth.user();
    if (!u) return '?';
    return (u.displayName || u.email).charAt(0).toUpperCase();
  });

  navigateToCreate(): void {
    if (this.isWinesTab()) this.router.navigate(['/wein/neu']);
    else if (this.isIdeasTab()) this.router.navigate(['/ideen/neu']);
    else if (this.isRestaurantsTab()) this.router.navigate(['/restaurants/neu']);
    else if (this.isVorratTab()) this.router.navigate(['/vorrat/neu']);
    else this.router.navigate(['/rezepte/neu']);
  }

  toggleMenu(): void {
    this.menuOpen.update((v) => !v);
  }

  closeMenu(): void {
    this.menuOpen.set(false);
  }

  async logout(): Promise<void> {
    this.menuOpen.set(false);
    await this.auth.logout();
    this.router.navigate(['/login']);
  }
}
