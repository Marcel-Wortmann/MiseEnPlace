# Style Guide — Internal Apps (egeplast / Marcel)

Verbindliche UI/UX-Vorgaben für alle internen Web-Anwendungen. Single Source of Truth — überschreibt alle anderen Style-Annahmen.

---

## 1. Design-Tokens (CSS Custom Properties)

Tokens werden in `:root` definiert und über Tailwind 4 als utility classes exposed (`bg-page`, `text-ink`, `border-divider` usw.).

### 1.1 Farb-Tokens (Dark Mode default)

```css
:root {
  --color-page: #25201c;          /* App background */
  --color-card: #3d3631;          /* Card / Surface */
  --color-ink: #f8f4ed;           /* Primary text */
  --color-ink-soft: #ddd5c6;      /* Secondary text / Body */
  --color-ink-muted: #a39a8a;     /* Tertiary / Labels */
  --color-divider: #564b3f;       /* Borders, Trennlinien */
  --color-accent: #d4b58c;        /* Primary action (warm tan) */
  --color-accent-softer: rgba(212, 181, 140, 0.12);  /* Hover-Überlagerung */
  --color-danger: #e89e9e;        /* Destruktiv (warm, nicht grell) */
}
```

**Verboten:** kalte Pure-Black/Pure-White (`#000`/`#fff`), grelles Rot (`#ff0000`, `#dc2626` außer Modal-Confirm-Buttons), bunte Material-Palette.

**Mobile-Status-Bar:** `<meta name="theme-color">` setzt `--color-page` (`#25201c`).

### 1.2 Typografie

- System-Font-Stack, kein Webfont.
- Sizes: Tailwind `text-xs` (Labels), `text-sm` (Body sm), `text-base` (Body), `text-lg` (Cook-Mode-Steps), `text-2xl` (Page-Titles).
- **Kein `italic`** außer Edge-Cases (z.B. "Schreibgeschützt"-Hinweis).
- **Kein `text-transform: uppercase`** außer SECTION-Labels (`.section-label`, `letter-spacing: 0.05em`, `text-xs`, `text-ink-muted`).
- Weights: `font-medium` (500), `font-semibold` (600), `font-bold` (700).

### 1.3 Spacing

Tailwind-Skala. Konsistent: `space-y-4` zwischen Cards, `gap-3` in Pills, `p-4`/`p-6` für Cards.

### 1.4 Radien

- Cards: `rounded-3xl` (1.5rem)
- Modals: `rounded-3xl`
- Buttons innen Pill: `rounded-full`
- Schwebende Pille: `border-radius: 9999px`

### 1.5 Shadows

Nur bei schwebenden Elementen (Floating Action Pill, Modals). Warmer Schatten:
```css
box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
```

---

## 2. Komponenten-Klassen

### 2.1 Floating Action Pill (Bottom-Bar-Ersatz)

**Pflicht** für alle Aktions-Bars unten. Kein Bottom-Bar-Style mehr, keine festen Buttons mit `flex: 1`.

```css
.floating-action-pill {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  bottom: max(1rem, env(safe-area-inset-bottom));
  background-color: var(--color-card);
  border: 1px solid var(--color-divider);
  border-radius: 9999px;
  padding: 0.375rem;
  display: flex;
  gap: 0.25rem;
  align-items: center;
  z-index: 30;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  max-width: calc(100vw - 1.5rem);
}
```

**Inner Buttons:**
- `padding: 0.55rem 1rem`, `border-radius: 9999px`, `font-size: 0.875rem`, `font-weight: 500`
- Default: `color: var(--color-ink-soft); background: transparent`
- Hover: `bg: var(--color-page); color: var(--color-ink)`

**Modifier-Klassen:**
- `.pill-icon-only` — quadratisch 2.25rem
- `.pill-primary` — `bg-accent`, `color-page` (Primary-Action wie Speichern, Bearbeiten)
- `.pill-danger` — `color: #e89e9e`, Hover-BG warm-rot transparent
- `.pill-divider` — 1px × 1.25rem `bg-divider`, `margin: 0 0.125rem`

**Layout-Reihenfolge:** Navigation/Zurück → Divider → Sekundär-Aktionen (Icon-Only) → Divider → Primary-Action (mit Label).

### 2.2 Floating Action Pill als Filter-Bar

Listen-Filter nutzen denselben Container. Plus-Button (Primary) links, dann Divider, dann horizontal-scrollbare Filter-Chips:

```html
<div class="floating-action-pill" style="overflow-x: auto;">
  <a class="pill-primary pill-icon-only">+</a>
  <span class="pill-divider"></span>
  <div class="flex items-center gap-1 overflow-x-auto hide-scrollbar"
       style="max-width: calc(100vw - 8rem);">
    <button [class.pill-primary]="active">Alle</button>
    <button [class.pill-primary]="active">Tag1</button>
  </div>
</div>
```

### 2.3 Cards

```css
.card-soft {
  background-color: var(--color-card);
  border-radius: 1.5rem;
  /* kein border, kein shadow — auf bg-page reicht der Kontrast */
}
```

Nutzen: `card-soft p-4` / `p-6`. **Keine** Box-Shadows auf Cards.

### 2.4 Modals (Confirm/Sheet)

Bottom-Sheet auf Mobile, zentriert auf Desktop:

```html
<div class="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
  <div class="absolute inset-0 bg-ink/40 backdrop-blur-sm" (click)="cancel()"></div>
  <div class="relative bg-card rounded-t-3xl sm:rounded-3xl shadow-xl
              w-full max-w-sm mx-0 sm:mx-4 p-6">
    ...
  </div>
</div>
```

Confirm-Button bei Destruktiv: `style="background-color: #ef4444"` (Standard-Red für klare Warnung in Modal-Confirm — Ausnahme zur warmen Palette, da vom User klar als „gefährlich" gelesen werden muss).

### 2.5 Section-Label

```css
.section-label {
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-ink-muted);
}
```

Verwendet für ZUTATEN, ZUBEREITUNG, Form-Sektionen.

### 2.6 Inputs

- Underline-Style (kein Border-Box), `border-bottom: 1px solid var(--color-divider)`
- Focus: `border-bottom-color: var(--color-accent)`
- Placeholder: `var(--color-ink-muted)`
- Padding: `padding: 0.75rem 0`

### 2.7 Hide-Scrollbar Utility

```css
.hide-scrollbar { scrollbar-width: none; -ms-overflow-style: none; }
.hide-scrollbar::-webkit-scrollbar { display: none; }
```

---

## 3. Icons

- **Stroke-Icons** (Lucide-Stil), `stroke-width: 2`, `stroke-linecap: round`, `stroke-linejoin: round`
- Sizes: `16` (Pill-Inline), `18` (Pill-Standard), `20` (Page-Header)
- **Inline-SVG**, keine Icon-Library importieren (Tree-Shake-Aufwand zu groß für interne Apps)
- Filled-Icons nur für Status (Stern bei Bewertung)

**Standard-Set (verbindlich):**
- Plus: `<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>`
- Close: `<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>`
- Back: `<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>`
- Edit: `<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>`
- Delete: `<polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/>`
- Share: `<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>`
- Check: `<polyline points="20 6 9 17 4 12"/>`
- Chevron-Down: `<polyline points="6 9 12 15 18 9"/>`
- Chef-Hat (Cooking-Mode): `<path d="M6 13.87A4 4 0 0 1 7.41 6a5.11 5.11 0 0 1 1.05-1.54 5 5 0 0 1 7.08 0A5.11 5.11 0 0 1 16.59 6 4 4 0 0 1 18 13.87V21H6Z"/><line x1="6" y1="17" x2="18" y2="17"/>`
- Spinner: `<path d="M21 12a9 9 0 1 1-6.219-8.56"/>` mit `class="animate-spin"`

---

## 4. Mobile-First & PWA

- **Safe-Area-Insets:** Bottom-Pille nutzt `env(safe-area-inset-bottom)`.
- **`pb-32`** auf `<main>` damit Floating-Pille nichts überdeckt.
- **Tap-Targets** min. 44×44 px (Pill-Icon-Only ist 36px — akzeptiert weil großzügig gepaddet).
- **Wake-Lock** für Kochmodus / langlaufende Use-Cases (`navigator.wakeLock.request('screen')`).
- **Manifest:** `display: standalone`, `theme_color: var(--color-page)`, Icons in 192/512 px.

---

## 5. Interaktionen

### 5.1 Tab-Wechsel per Wischen

Standard auf Listen-Seiten via `appSwipe`-Direktive. Direktive **muss** horizontal-scrollbare Container ignorieren (Filter-Bars), sonst hijackt sie deren Scroll.

```typescript
// In onTouchStart: traverse parent chain, abort if any ancestor has
// overflowX === 'auto'/'scroll' AND scrollWidth > clientWidth
```

### 5.2 Vollbild-Modi (Cooking, Reading, etc.)

- `position: fixed; inset: 0; z-index: 50`
- Header und normale Action-Pille ausblenden
- Einzelner Exit-Button als `pill-primary` mit `z-index: 60`
- Sticky-Sub-Navigation (z.B. einklappbare Zutatenliste): `position: sticky; top: 0`, Hintergrund mit Gradient zu transparent damit's beim Scrollen weich verläuft.

### 5.3 Loading-States

- Skeleton mit `animate-pulse` auf `bg-page`-Elementen
- Spinner: SVG `animate-spin`, `text-accent`
- **Nie** "Loading..." als reiner Text

### 5.4 Notifications/Toasts

Eigene `NotificationStore` (Signal-basiert), Bottom-Sheet-Style auf Mobile, `position: fixed; top: 1rem; right: 1rem` auf Desktop. Auto-Dismiss 5s, manuell schließbar, Error/Success/Info-Varianten.

---

## 6. Formatierung

- **Keine `italic` im UI** außer expliziter Hinweis-Text
- **Keine `uppercase` im UI** außer `section-label`
- Zahlen mit `| number:'1.0-0'` (Angular-Pipe) oder `Intl.NumberFormat('de-DE')`
- Datum: `dd.MM.yyyy` (Angular `| date:'dd.MM.yyyy'`)
- Währung: `1.234,56 €` (de-DE)
- Dezimaltrenner: Komma, **niemals** Punkt

---

## 7. Sprache

- **Primärsprache: Deutsch**, Du-Form (informell, nicht „Sie")
- Englisch nur in Code, Type-Namen, Kommentaren
- Fehlermeldungen: konkret, ohne Tech-Slang. „Rezept konnte nicht gespeichert werden" statt „PATCH /api/recipes/:id failed"
- Buttons: Verb in Imperativ („Speichern", „Löschen", „Abbrechen") — kein „Save"/„Delete"

---

## 8. Anti-Patterns (verboten)

- ❌ Bottom-Bar mit `flex: 1` Buttons über volle Breite
- ❌ Material Design (Cards mit Shadow + Border, FAB-Stil mit Floating-Plus rechts unten)
- ❌ Bunte Tags/Badges in Material-Farben
- ❌ Icon-Library als Dependency
- ❌ Multiple Schriftarten/Webfonts
- ❌ Animationen länger als 300ms
- ❌ Hover-Effekte auf Mobile (Tap-Highlight reicht)
- ❌ Borders auf Cards
- ❌ `text-decoration: underline` außer in Plain-Text-Links
