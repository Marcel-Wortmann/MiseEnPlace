# Architecture Guide — Internal Apps (egeplast / Marcel)

Verbindliche Architektur-Vorgaben für interne Web-Anwendungen. Stack: **Angular 21 + NestJS 11 + PostgreSQL 16 + Prisma 7 + Docker Compose**.

---

## 1. Monorepo-Struktur

```
projekt/
├── docker-compose.yml
├── .env.example
├── data/                          # Read-only Mounts (BLS, Lookup-Daten)
├── libs/
│   └── interfaces/                # Shared TS Interfaces (Frontend ↔ Backend)
│       ├── index.ts               # Barrel
│       ├── recipe.interface.ts
│       └── ...
├── projekt-rest-api/              # NestJS Backend
│   ├── Dockerfile
│   ├── package.json
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── migrations/
│   ├── prisma.config.ts
│   └── src/
│       ├── main.ts
│       ├── app.module.ts
│       ├── prisma/                # PrismaService (global)
│       ├── auth/                  # Auth-Modul (s.u.)
│       ├── users/
│       ├── shares/                # Sharing-Modul falls relevant
│       ├── upload/
│       ├── ai/                    # Ollama-Integration
│       └── <domain-modules>/
└── projekt-frontend/              # Angular 21
    ├── Dockerfile
    ├── nginx.conf
    ├── package.json
    ├── angular.json
    └── src/
        ├── main.ts
        ├── styles.css             # Globale Tokens + Component-Klassen
        ├── index.html
        ├── manifest.webmanifest
        └── app/
            ├── app.ts / app.html
            ├── app.config.ts      # provideRouter, provideHttpClient, Interceptors
            ├── shared/            # Direktiven, Pipes, Services (Swipe, TabNav...)
            ├── auth/              # Login, Register, Interceptor, Guard
            ├── header/
            ├── notification/      # Toast-System
            ├── services/          # HTTP-Services pro Domain
            ├── store/             # NgRx SignalStore pro Domain
            ├── share/             # Falls Sharing
            └── <domain-features>/
                ├── list/
                ├── form/
                └── detail/
```

**Pfad-Aliase** (`tsconfig.base.json` und `tsconfig.app.json`):
```json
{
  "paths": {
    "@shared/interfaces": ["libs/interfaces/index.ts"],
    "@shared/interfaces/*": ["libs/interfaces/*"]
  }
}
```

Backend importiert Interfaces über denselben Alias — sichergestellt durch `tsconfig-paths` zur Runtime und `tsx` für Migrations-Scripts.

---

## 2. Frontend (Angular 21)

### 2.1 Pflicht-Setup

- **Standalone Components only** — kein NgModule
- **Zoneless Change Detection:** `provideZoneChangeDetection({ eventCoalescing: false })` ENTFERNT, stattdessen `provideExperimentalZonelessChangeDetection()`
- **Signals + NgRx SignalStore** für State (kein klassisches NgRx)
- **Reactive Forms** mit `NonNullableFormBuilder`
- **Tailwind CSS 4** (PostCSS-basierter Setup) + globale `styles.css`
- **PWA** mit manifest + Service Worker (optional je Projekt)

### 2.2 NgRx SignalStore

Pro Domain ein Store unter `src/app/store/<Domain>/<Domain>.store.ts`:

```typescript
import { signalStore, withState, withMethods, withComputed, patchState } from '@ngrx/signals';

interface RecipesState {
  items: Recipe[];
  loading: boolean;
  filter: RecipeFilter;
}

export const RecipesStore = signalStore(
  { providedIn: 'root' },
  withState<RecipesState>({ items: [], loading: false, filter: {} }),
  withComputed((store) => ({
    filtered: computed(() => applyFilter(store.items(), store.filter())),
    count: computed(() => store.items().length),
  })),
  withMethods((store, service = inject(DomainService)) => ({
    async load() {
      patchState(store, { loading: true });
      const items = await firstValueFrom(service.list());
      patchState(store, { items, loading: false });
    },
    findById(id: string) { return store.items().find((i) => i.id === id) ?? null; },
    async delete(id: string): Promise<boolean> { /* ... */ },
  })),
);
```

**Konventionen:**
- `findById` synchron aus Cache, kein Re-Fetch
- `loadOne(id)` als Service-Methode für Detail-Seiten (Cache-Miss)
- Mutations: optimistic update + rollback bei Error
- Notifications via `NotificationStore` aus dem Store heraus

### 2.3 Routing

Alle Routes in `app.config.ts` als `Routes`-Array. Lazy-Loading für große Domains via `loadComponent`:

```typescript
{
  path: 'rezepte/:id',
  loadComponent: () => import('./recipes/detail/recipe-detail').then((m) => m.RecipeDetailComponent),
}
```

`input.required<string>()` für Route-Params (ab Angular 16+).

### 2.4 HTTP-Services

Ein Service pro REST-Resource unter `src/app/services/<domain>/<domain>.service.ts`. Nur HTTP-Calls — keine Logik, kein State:

```typescript
@Injectable({ providedIn: 'root' })
export class RecipesService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/recipes';

  list(): Observable<Recipe[]> { return this.http.get<Recipe[]>(this.base); }
  loadOne(id: string): Observable<Recipe> { return this.http.get<Recipe>(`${this.base}/${id}`); }
  create(dto: CreateRecipeDto): Observable<Recipe> { return this.http.post<Recipe>(this.base, dto); }
  update(id: string, dto: UpdateRecipeDto): Observable<Recipe> { return this.http.patch<Recipe>(`${this.base}/${id}`, dto); }
  delete(id: string): Observable<void> { return this.http.delete<void>(`${this.base}/${id}`); }
}
```

### 2.5 Auth-Interceptor (Pflicht)

`src/app/auth/auth.interceptor.ts` — funktional (`HttpInterceptorFn`):

- Public-Routes (Login, Register, Refresh, Logout, public Shares) **nicht** authentifizieren
- Bei 401 → Refresh-Token-Flow mit `BehaviorSubject` als Mutex
- Bei Refresh-Failure → `forceLogout()` + Navigate `/login`
- Token-Anhang via `Authorization: Bearer <token>`

Registriert in `app.config.ts`:
```typescript
provideHttpClient(withInterceptors([authInterceptor]))
```

### 2.6 Shared Direktiven

Unter `src/app/shared/`:
- `swipe.directive.ts` — Touch-basierte Swipe-Gesten, **muss** horizontal-scrollbare Ancestors detecten und ignorieren
- `tab-navigation.service.ts` — Singleton mit `TAB_ORDER` und `next()`/`prev()`-Methoden
- Weitere Direktiven kommen hier rein, **nie** ins App-Root

### 2.7 Form-Patterns

```typescript
readonly form = this.fb.group<RecipeFormShape>({
  title: this.fb.control('', { validators: [Validators.required, Validators.maxLength(200)] }),
  ingredients: this.fb.array<FormGroup<IngredientFormShape>>([]),
  steps: this.fb.array<FormGroup<StepFormShape>>([]),
});
```

**Beim Submit:**
- Werte explizit casten (Strings → Numbers via `Number(x)` + `Number.isFinite()`-Check, sonst `null`)
- `FormArray.value` als Source of Truth, kein direktes DOM-Lesen
- Loading-Signal vor/nach API-Call togglen

---

## 3. Backend (NestJS 11)

### 3.1 Pflicht-Setup

- **Express-Adapter** (`@nestjs/platform-express`)
- **`tsx`** statt `ts-node` für Development & Migrations
- **Prisma 7** mit `@prisma/adapter-pg` (PG-native Adapter)
- **CORS:** `origin: true, credentials: false` (intern, kein Cookie-Auth)
- **Global Prefix:** `/api`
- **Validation:** Global `ValidationPipe` mit:
  ```typescript
  whitelist: true,
  forbidNonWhitelisted: false,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
  exceptionFactory: (errors) => { /* flatten + log + throw BadRequestException */ }
  ```
- **`exceptionFactory`** loggt Validation-Errors mit `value=` für besseres Debugging
- **Class-Validator + Class-Transformer** für DTOs

### 3.2 Module-Struktur

Pro Domain ein Modul mit Controller, Service, DTOs:

```
src/recipes/
├── recipes.module.ts
├── recipes.controller.ts
├── recipes.service.ts
└── dto/
    ├── create-recipe.dto.ts
    ├── update-recipe.dto.ts        # extends PartialType(CreateRecipeDto)
    └── recipe-filter.dto.ts
```

### 3.3 DTOs — class-validator-Patterns

**Optionale Felder mit nullable:**
```typescript
@IsOptional()
@ValidateIf((_, value) => value !== null && value !== undefined)
@IsString()
@MaxLength(2000)
description?: string | null;
```

**Strings, die als Numbers ankommen können** (Frontend kann String oder Number senden):
```typescript
@IsOptional()
@ValidateIf((_, value) => value !== null && value !== undefined && value !== '')
@Type(() => Number)
@IsNumber()
amount?: number | null;
```

`@Type(() => Number)` ist **Pflicht** wenn Frontend ggf. Strings sendet — `enableImplicitConversion: true` allein reicht nicht bei `@ValidateIf`.

**Nested Arrays:**
```typescript
@IsArray()
@ValidateNested({ each: true })
@Type(() => RecipeIngredientDto)
ingredients!: RecipeIngredientDto[];
```

### 3.4 Service-Patterns

- **Ownership-Check zuerst:** `findUnique({ where: { id } })`, dann `if (!existing || existing.userId !== userId) throw NotFoundException`
- **Selektive Updates:** `Prisma.RecipeUpdateInput` initial leer, dann `if (dto.field !== undefined) data.field = dto.field`
- **JSON-Felder:** `data.ingredients = dto.ingredients as unknown as Prisma.InputJsonValue`
- **Transactions** für Multi-Table-Operations

### 3.5 Auth-Modul

JWT-basiert, immer:

- **Access-Token:** 15min, HS256, payload `{ sub, email, displayName }`
- **Refresh-Token:** 30 Tage, in DB gespeichert (Hash via bcrypt), eigene Tabelle `RefreshToken`
- **Rotation:** bei jedem `/refresh` neuen Refresh-Token ausstellen, alten invalidieren
- **Password-Change:** alle Refresh-Tokens des Users invalidieren
- **`JwtAuthGuard`** als globaler Guard via `APP_GUARD`, mit `@Public()`-Decorator + Reflector für öffentliche Routes
- **`@CurrentUser()`** Custom-Decorator extrahiert `AuthUser` aus `request.user`

### 3.6 Validation-Logging

Backend-Logging für 400er ist **Pflicht** (sonst sind Frontend-Bugs nicht debuggbar):

```typescript
exceptionFactory: (errors: ValidationError[]) => {
  const flat = flattenErrors(errors);
  logger.warn(`Validation failed:\n${flat.join('\n')}`);
  return new BadRequestException({ statusCode: 400, message: flat, error: 'Bad Request' });
}
```

`flattenErrors` rekursiv mit `path`, `constraint`, `value=JSON.stringify(value)`.

### 3.7 AI-Integration (Ollama)

`src/ai/ollama.service.ts` — zentrale Abstraktion für lokale LLM-Calls:

- `OLLAMA_BASE_URL` aus `process.env`, default `http://host.docker.internal:11434`
- Modelle pro Use-Case: `OLLAMA_VISION_MODEL`, `OLLAMA_TEXT_MODEL`
- `generate({ model, system, prompt, images?, format? })` → raw string
- `parseJson<T>(raw)` mit Fallback-Cleanup für `\`\`\`json`-Wrapper

**Prompt-Engineering-Regeln:**
- Schema-Beispiele inline mit Negativ-Beispielen („z.B. 'Mehl' statt 'Weizenmehl (Type 405, alternativ Dinkel)'")
- `format: 'json'` für strukturierte Outputs
- Self-Consistency für unsichere Outputs: 3 Runs, Median/Majority nehmen

---

## 4. Datenbank (Prisma 7)

### 4.1 Setup

- `prisma.config.ts` (TypeScript-Config) ersetzt `prisma.schema`-Block
- Adapter: `@prisma/adapter-pg`
- `prisma migrate deploy` in Production-Container-Entrypoint
- `prisma db push --accept-data-loss` nur in Dev

### 4.2 Schema-Konventionen

- **UUIDs** als IDs (`@id @default(uuid())`)
- **Timestamps:** `createdAt @default(now())` + `updatedAt @updatedAt`
- **User-Ownership:** alle Domain-Tabellen haben `userId String` mit `@@index([userId])` und `User` relation `onDelete: Cascade`
- **JSON-Felder** für nicht-relationale verschachtelte Daten (Ingredients, Steps in Recipes — wenn nicht eigenständig abfragbar)
- **Prisma-Generated Types** für Frontend exportieren via shared interfaces (DTOs definieren, nicht Prisma-Types raw weitergeben)

### 4.3 Migrations

- Migrations-Naming: `YYYYMMDD_kurzname` (`20260501_add_user_ingredients`)
- **Niemals** Migrations editieren nachdem sie deployed wurden
- Bei Schema-Änderungen lokal: `prisma migrate dev --name <name>`

---

## 5. Docker & Deployment

### 5.1 docker-compose.yml

```yaml
services:
  db:
    image: postgres:16-alpine
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
    volumes: [db-data:/var/lib/postgresql/data]

  backend:
    build: { context: ., dockerfile: projekt-rest-api/Dockerfile }
    depends_on: { db: { condition: service_healthy } }
    extra_hosts: ["host.docker.internal:host-gateway"]   # Ollama auf Host
    ports: ["127.0.0.1:${BACKEND_PORT}:3000"]            # nur localhost
    volumes:
      - uploads-data:/app/uploads
      - ./data:/app/data:ro

  frontend:
    build: { context: ., dockerfile: projekt-frontend/Dockerfile }
    ports: ["127.0.0.1:${FRONTEND_PORT}:80"]
```

**Pflicht:**
- `127.0.0.1:` Bindung — Ports nur via Reverse-Proxy nach außen
- `${POSTGRES_PASSWORD}` und `${JWT_SECRET}` aus `.env`, nie Defaults in Production
- `restart: unless-stopped` für alle Services
- Healthcheck auf DB

### 5.2 Backend-Dockerfile

Multi-Stage:
1. `node:22-alpine` — `npm ci`, `prisma generate`, `nest build`
2. `node:22-alpine` runtime — kopiert `dist`, `node_modules`, `prisma/`, startet via `npm run start:prod`
3. `prisma migrate deploy` als Entrypoint vor App-Start

### 5.3 Frontend-Dockerfile

Multi-Stage:
1. `node:22-alpine` — `npm ci`, `ng build` mit `--configuration=production`
2. `nginx:alpine` — `dist/` nach `/usr/share/nginx/html`, custom `nginx.conf` mit:
   - `try_files $uri $uri/ /index.html` (SPA-Fallback)
   - `/api/` proxy zum Backend-Service
   - Cache-Headers für `assets/*`

### 5.4 Reverse-Proxy

Nginx auf Host (`marcel-wortmann.de`):
- Wildcard-Cert via Let's Encrypt (manueller DNS-Challenge)
- Snippet/conf.d-Architektur (`snippets/ssl-params.conf`, `conf.d/<projekt>.conf`)
- Pro Projekt eigener Subdomain + Port-Range (Convention: 110XX)

### 5.5 Logs & Maintenance

- `docker daemon.json` mit `log-driver: json-file`, `max-size: 10m`, `max-file: 3`
- Builder GC: `defaultKeepStorage: 10GB`
- Weekly Cron: `docker system prune -af --filter "until=168h"`
- Journal capped: 200 MB

---

## 6. Konventionen

### 6.1 Sprache & Naming

- **Code:** Englisch (Variablen, Funktionen, Types, Interfaces)
- **UI-Strings:** Deutsch (siehe `style.md`)
- **Commits:** Englisch, imperativ („Add user-ingredient lookup", nicht „Added")
- **Branch-Names:** `feature/<name>`, `fix/<name>`

### 6.2 TypeScript

- **`strict: true`** in tsconfig
- **Keine `any`** außer in dokumentierten Edge-Cases
- **`unknown`** für externe/User-Daten, dann via Type-Guard verschmälern
- **Kein `enum`** — `as const` Objects + Union-Types
- **Readonly** wo immer möglich (`readonly` properties, `ReadonlyArray`)

### 6.3 File-Naming

- Angular: `kebab-case.ts/.html/.css` (`recipe-list.ts`, `recipe-list.html`)
- Komponenten-Klassen: `PascalCase` (`RecipeListComponent`)
- Interfaces: `PascalCase`, **kein `I`-Prefix** (`Recipe`, nicht `IRecipe`)
- DTOs: `PascalCase` mit Suffix `Dto` (`CreateRecipeDto`)

### 6.4 Error-Handling

- Backend wirft NestJS-Exceptions (`NotFoundException`, `BadRequestException`, `ForbiddenException`)
- Frontend fängt in Service/Store, übergibt an `NotificationStore` mit User-freundlicher Message
- **Niemals** raw HTTP-Errors im UI anzeigen — Mapping über Notification

### 6.5 Tests

- Tests sind **optional** für interne Apps (Aufwand vs. Nutzen)
- Wenn Tests: Vitest für Backend (Unit), Jasmine/Karma für Angular
- **Bekanntes Problem:** Vitest + `@nestjs/testing` Integration-Tests funktionieren nicht zuverlässig (Reflector wird beim 2. App-Bootstrap nicht injected). Workaround: `Test.createTestingModule().overrideProvider(APP_GUARD).useFactory(...)` mit explizitem Reflector — oder Integration-Tests weglassen und auf Unit + manuelles Testen setzen

---

## 7. Anti-Patterns (verboten)

- ❌ NgModule statt Standalone Components
- ❌ Klassisches NgRx mit Actions/Effects/Reducers (nutze SignalStore)
- ❌ `any` in Public APIs
- ❌ Prisma-Types direkt zwischen Frontend und Backend teilen (immer DTOs)
- ❌ Ports im Compose ohne `127.0.0.1:`-Bindung
- ❌ Hardcoded Secrets (DB-Passwort, JWT-Secret) in Code/Compose
- ❌ Migrations editieren nach Deploy
- ❌ Synchroner File-I/O im Backend (außer beim App-Start)
- ❌ HTTP-Calls direkt aus Components (immer über Service)
- ❌ Form-Werte ohne explizite Type-Coercion an Backend senden
