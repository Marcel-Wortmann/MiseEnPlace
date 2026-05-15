import { HttpInterceptorFn, HttpRequest, HttpHandlerFn, HttpErrorResponse, HttpEvent } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, BehaviorSubject, catchError, filter, switchMap, take, throwError } from 'rxjs';
import { AuthStore } from '../store/Auth/Auth.store';
import { AuthService } from '../services/auth/auth.service';

let isRefreshing = false;
const refreshSubject = new BehaviorSubject<string | null>(null);

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const store = inject(AuthStore);
  const auth = inject(AuthService);
  const router = inject(Router);

  const isAuthPublic =
    req.url.includes('/api/auth/login') ||
    req.url.includes('/api/auth/register') ||
    req.url.includes('/api/auth/refresh') ||
    req.url.includes('/api/auth/logout') ||
    req.url.includes('/api/shares/public/');

  const token = store.accessToken();
  const authedReq = !isAuthPublic && token ? attach(req, token) : req;

  return next(authedReq).pipe(
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse && err.status === 401 && !isAuthPublic) {
        return handle401(req, next, store, auth, router);
      }
      return throwError(() => err);
    }),
  );
};

function attach(req: HttpRequest<unknown>, token: string): HttpRequest<unknown> {
  return req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
}

type AuthStoreInstance = {
  accessToken: () => string | null;
  refreshToken: () => string | null;
  setTokens: (t: { accessToken: string; refreshToken: string }) => void;
  forceLogout: () => void;
};

function handle401(
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
  store: AuthStoreInstance,
  auth: AuthService,
  router: Router,
): Observable<HttpEvent<unknown>> {
  const refreshToken = store.refreshToken();
  if (!refreshToken) {
    store.forceLogout();
    router.navigate(['/login']);
    return throwError(() => new Error('Nicht angemeldet.'));
  }

  if (!isRefreshing) {
    isRefreshing = true;
    refreshSubject.next(null);

    return auth.refresh(refreshToken).pipe(
      switchMap((tokens) => {
        isRefreshing = false;
        store.setTokens(tokens);
        refreshSubject.next(tokens.accessToken);
        return next(attach(req, tokens.accessToken));
      }),
      catchError((err) => {
        isRefreshing = false;
        store.forceLogout();
        router.navigate(['/login']);
        return throwError(() => err);
      }),
    );
  }

  return refreshSubject.pipe(
    filter((t): t is string => t !== null),
    take(1),
    switchMap((newToken) => next(attach(req, newToken))),
  );
}
