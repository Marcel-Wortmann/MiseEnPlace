import { Component, computed, inject } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs';
import { HeaderComponent } from './header/header';
import { NotificationComponent } from './notification/notification';
import { OfflineBannerComponent } from './shared/offline-banner';
import { AuthStore } from './store/Auth/Auth.store';
import { SwipeDirective } from './shared/swipe.directive';
import { TabNavigationService } from './shared/tab-navigation.service';
import { LightboxComponent } from './shared/lightbox';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, HeaderComponent, NotificationComponent, SwipeDirective, LightboxComponent, OfflineBannerComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class AppComponent {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthStore);
  readonly tabs = inject(TabNavigationService);

  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.url),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  readonly isPublic = computed(() => this.currentUrl().startsWith('/share/'));
  readonly isAuthPage = computed(() => {
    const u = this.currentUrl();
    return u.startsWith('/login') || u.startsWith('/register');
  });
  readonly showHeader = computed(() => {
    return !this.isPublic() && !this.isAuthPage() && this.auth.isAuthenticated();
  });

  onSwipeLeft(): void {
    if (this.tabs.isOnTabList()) this.tabs.next();
  }

  onSwipeRight(): void {
    if (this.tabs.isOnTabList()) this.tabs.prev();
  }
}
