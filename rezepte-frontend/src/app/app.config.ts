import { ApplicationConfig, LOCALE_ID, provideZonelessChangeDetection, inject, provideAppInitializer } from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling, withPreloading, PreloadAllModules } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { registerLocaleData } from '@angular/common';
import localeDe from '@angular/common/locales/de';

import { routes } from './app.routes';
import { authInterceptor } from './auth/auth.interceptor';
import { ThemeStore } from './store/Theme/Theme.store';

registerLocaleData(localeDe);

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled', anchorScrolling: 'enabled' }),
      withPreloading(PreloadAllModules),
    ),
    provideHttpClient(withInterceptors([authInterceptor])),
    { provide: LOCALE_ID, useValue: 'de-DE' },
    provideAppInitializer(() => {
      const theme = inject(ThemeStore);
      theme.init();
    }),
  ],
};
