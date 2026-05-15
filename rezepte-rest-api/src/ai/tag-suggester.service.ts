import { Injectable, Logger } from '@nestjs/common';
import { OllamaService } from './ollama.service';

export interface SuggestTagsInput {
  title: string;
  description?: string | null;
  ingredients: { name: string }[];
  steps: { text: string }[];
  existingTags: string[];
  durationMinutes?: number | null;
}

const STANDARD_TAGS = [
  'Vegetarisch',
  'Vegan',
  'Basis',
  'Schnell',
  'Gesund',
  'Süß',
  'Herzhaft',
  'Backen',
  'Suppe',
  'Salat',
  'Pasta',
  'Asiatisch',
  'Italienisch',
  'Frühstück',
  'Dessert',
  'Snack',
  'Hauptgericht',
  'Beilage',
];

const SYSTEM_PROMPT = `Du tagst Rezepte konservativ. Wähle 2-4 Tags, NIE mehr als 5.

WICHTIGE REGELN:
- Tags müssen INHALTLICH PASSEN — im Zweifel weniger Tags ausgeben
- "Süß" NUR wenn Zucker, Honig, Sirup, Schokolade, Süßstoff oder süßes Obst (Banane, Apfel etc.) als HAUPTZUTAT vorkommt — nicht bei Pfannkuchen-Grundteig ohne Zucker
- "Herzhaft" NUR bei deutlich pikanten Rezepten mit Gewürzen, Käse, Fleisch — NICHT bei neutralen Grundrezepten
- "Frühstück" NUR wenn explizit für morgens (Müsli, Porridge, Rührei, Granola) — neutrale Teige/Saucen NICHT als Frühstück taggen
- "Vegetarisch" NUR wenn keine Fleisch/Fisch-Zutat
- "Vegan" NUR wenn keine tierischen Produkte (auch keine Milch, Eier, Honig)
- "Basis" = Grundrezept zum Erweitern (Pfannkuchen-Teig, Pizzateig, Bechamel, Crêpes)
- Tags dürfen sich NICHT widersprechen (nicht süß+herzhaft gleichzeitig)
- Bei Unsicherheit: Tag WEGLASSEN

Antworte NUR als JSON: { "tags": ["Tag1", "Tag2"] }`;

@Injectable()
export class TagSuggesterService {
  private readonly logger = new Logger(TagSuggesterService.name);

  constructor(private readonly ollama: OllamaService) {}

  async suggest(input: SuggestTagsInput): Promise<string[]> {
    // Deterministische Auto-Tags zuerst (immer aktiv, keine LLM-Kosten)
    const auto = this.deterministicTags(input);
    return auto;
  }

  /**
   * Regelbasierte Tags: schnell, deterministisch, keine Halluzination.
   * Decken die häufigsten Use-Cases ab — vegetarisch, vegan, schnell, dessert, low-carb, saisonal.
   */
  private deterministicTags(input: SuggestTagsInput): string[] {
    const tags = new Set<string>();
    const ingredients = input.ingredients.map((i) => i.name.toLowerCase()).join(' | ');
    const allText = `${input.title} ${input.description ?? ''} ${ingredients}`.toLowerCase();

    /**
     * Wortgrenzen-Match. Verhindert Substring-Treffer wie "ei" in "Petersilie"
     * oder "fisch" in "Frischkäse". \b funktioniert mit ä/ö/ü/ß nicht zuverlässig,
     * daher manuelle Lookarounds auf Nicht-Buchstaben. Erlaubt deutsche Plurale
     * (-e, -en, -er, -s) am Wortende.
     */
    const hasWord = (word: string): boolean => {
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(^|[^a-zäöüß])${escaped}(?:e|en|er|s)?($|[^a-zäöüß])`, 'i');
      return re.test(allText);
    };
    const hasAny = (words: string[]): boolean => words.some(hasWord);

    const meatWords = [
      'fleisch', 'rind', 'schwein', 'lamm', 'kalb', 'huhn', 'hähnchen', 'pute', 'truthahn',
      'speck', 'schinken', 'salami', 'wurst', 'bratwurst', 'mett', 'hack', 'gehacktes',
      'prosciutto', 'pancetta', 'bacon', 'chorizo', 'leberkäse', 'leber',
    ];
    const fishWords = [
      'fisch', 'lachs', 'thunfisch', 'forelle', 'kabeljau', 'dorsch', 'hering', 'makrele',
      'garnele', 'shrimp', 'krabbe', 'tintenfisch', 'hummer', 'muschel', 'sardine', 'anchovis',
      'rogen', 'kaviar',
    ];
    const dairyEggsWords = [
      'milch', 'sahne', 'joghurt', 'quark', 'butter', 'käse', 'mascarpone', 'parmesan',
      'mozzarella', 'feta', 'frischkäse', 'ei', 'eier', 'eigelb', 'eiweiß',
    ];

    const containsMeat = hasAny(meatWords);
    const containsFish = hasAny(fishWords);
    const containsDairyEggs = hasAny(dairyEggsWords);

    if (!containsMeat && !containsFish) tags.add('Vegetarisch');
    if (!containsMeat && !containsFish && !containsDairyEggs) tags.add('Vegan');

    // Süß / Dessert
    const sweetWords = ['zucker', 'schokolade', 'kakao', 'honig', 'sirup', 'vanille', 'sahne', 'creme', 'tiramisu', 'kuchen', 'kekse', 'pudding', 'eis', 'pancake', 'pfannkuchen', 'crepes'];
    const dessertContext = ['dessert', 'nachspeise', 'nachtisch', 'süßspeise', 'tiramisu', 'kuchen'];
    if (hasAny(dessertContext) || sweetWords.filter(hasWord).length >= 2) {
      tags.add('Süß');
    }

    // Schnell / Aufwendig
    if (input.durationMinutes !== null && input.durationMinutes !== undefined) {
      if (input.durationMinutes <= 30) tags.add('Schnell');
      else if (input.durationMinutes >= 90) tags.add('Aufwendig');
    }

    // Low-Carb (keine typischen Carb-Hauptzutaten)
    const carbWords = ['nudel', 'pasta', 'reis', 'kartoffel', 'brot', 'mehl', 'teig', 'baguette', 'brötchen', 'spätzle', 'gnocchi', 'couscous', 'bulgur'];
    if (!hasAny(carbWords)) tags.add('Low-Carb');

    // Saisonal — Monatsabgleich
    const month = new Date().getMonth() + 1;
    const seasonal: { name: string; ingredients: string[]; months: number[] }[] = [
      { name: 'Saisonal', ingredients: ['spargel'], months: [4, 5, 6] },
      { name: 'Saisonal', ingredients: ['rhabarber'], months: [4, 5, 6] },
      { name: 'Saisonal', ingredients: ['erdbeer'], months: [5, 6, 7] },
      { name: 'Saisonal', ingredients: ['kürbis'], months: [9, 10, 11] },
      { name: 'Saisonal', ingredients: ['pilz', 'steinpilz', 'pfifferling', 'champignon'], months: [9, 10, 11] },
      { name: 'Saisonal', ingredients: ['bärlauch'], months: [3, 4] },
      { name: 'Saisonal', ingredients: ['feldsalat'], months: [10, 11, 12, 1, 2] },
      { name: 'Saisonal', ingredients: ['grünkohl'], months: [11, 12, 1, 2] },
    ];
    if (seasonal.some((s) => s.months.includes(month) && hasAny(s.ingredients))) {
      tags.add('Saisonal');
    }

    // Hauptbestandteile als Tags
    const mainCategories: Record<string, string[]> = {
      'Pasta': ['nudel', 'pasta', 'spaghetti', 'penne', 'lasagne', 'tagliatelle'],
      'Suppe': ['suppe', 'eintopf', 'brühe'],
      'Salat': ['salat'],
      'Auflauf': ['auflauf', 'gratin', 'überbacken'],
      'Grill': ['grill', 'gegrillt'],
      'Ofen': ['ofen', 'gebacken'],
    };
    for (const [tag, words] of Object.entries(mainCategories)) {
      if (hasAny(words)) tags.add(tag);
    }

    return Array.from(tags).slice(0, 6);
  }

  async suggestRestaurant(input: { name: string; cuisine?: string | null; notes?: string | null; existingTags: string[] }): Promise<string[]> {
    const STANDARD = [
      'Vegetarisch', 'Vegan', 'Günstig', 'Imbiss', 'Fine Dining', 'Asiatisch',
      'Italienisch', 'Pizza', 'Burger', 'Sushi', 'Frühstück', 'Bar', 'Café',
      'Schnell', 'Familienfreundlich', 'Lieferdienst', 'Bio', 'Take-away',
    ];
    const allowedSet = new Set([...STANDARD, ...input.existingTags]);
    const allowed = Array.from(allowedSet);

    const SYSTEM = `Du tagst Restaurants konservativ. Wähle 2-4 passende Tags, NIE mehr als 5.

REGELN:
- Bevorzuge Tags aus der vorgegebenen Liste
- "Vegetarisch"/"Vegan" NUR wenn das Restaurant explizit dafür bekannt ist
- "Günstig" NUR bei klarem Hinweis (Imbiss, Döner, Mensa) — nicht raten
- "Imbiss" für schnelles Essen zum Mitnehmen (Döner, Pizzeria-To-Go, Pommesbude)
- "Fine Dining" NUR bei explizitem Hinweis auf Sterne/gehobene Küche
- Im Zweifel Tag WEGLASSEN

Antworte NUR als JSON: { "tags": ["Tag1", "Tag2"] }`;

    const userPrompt = `RESTAURANT: ${input.name}
${input.cuisine ? `KÜCHE: ${input.cuisine}\n` : ''}${input.notes ? `NOTIZEN: ${input.notes}\n` : ''}
VORGEGEBENE TAGS: ${allowed.join(', ')}

Wähle max 5 Tags.`;

    try {
      const raw = await this.ollama.generate({
        model: this.ollama.textModel,
        system: SYSTEM,
        prompt: userPrompt,
        format: 'json',
        timeoutSec: 120,
        tag: 'tag-suggest',
      });
      const parsed = this.ollama.parseJson<{ tags?: unknown }>(raw);
      const tags = Array.isArray(parsed.tags) ? parsed.tags.filter((t): t is string => typeof t === 'string') : [];
      const lowerMap = new Map(allowed.map((t) => [t.toLowerCase(), t]));
      const normalized = tags
        .map((t) => lowerMap.get(t.trim().toLowerCase()) ?? t.trim())
        .filter((t) => t.length > 0 && t.length <= 30);
      return Array.from(new Set(normalized)).slice(0, 5);
    } catch (err) {
      this.logger.warn(`Restaurant-Tag-Vorschlag fehlgeschlagen: ${err instanceof Error ? err.message : err}`);
      return [];
    }
  }
}
