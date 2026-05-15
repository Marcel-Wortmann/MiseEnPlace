import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { OllamaService } from './ollama.service';
import { Difficulty, ExtractedRecipeDraft, RecipeIngredient, RecipeStep } from '@shared/interfaces/recipe.interface';

interface RawExtraction {
  title?: string | null;
  description?: string | null;
  durationMinutes?: number | string | null;
  difficulty?: string | null;
  servings?: number | string | null;
  caloriesPerServing?: number | string | null;
  tags?: unknown;
  ingredients?: unknown;
  steps?: unknown;
}

const SYSTEM_PROMPT = `Du bist ein Rezept-Extraktor. Aus dem gegebenen Inhalt (Bild oder Text) extrahierst du ein strukturiertes Rezept als JSON.

KRITISCHE REGEL — KEINE HALLUZINATION:
- Erfinde NIEMALS Zutaten oder Mengen die nicht wörtlich im Text stehen.
- Übernimm ausschließlich Zutaten die im Text explizit genannt sind.
- Wenn der Text mehrere Zutatenblöcke enthält (z.B. "Zutaten Teig", "Zutaten Creme", "Zutaten Sauce"), führe ALLE Zutaten aus ALLEN Blöcken in der Liste auf, in der Reihenfolge wie im Original.
- Wenn dieselbe Zutat in mehreren Blöcken vorkommt (z.B. "2 Zwiebeln" für Klopse + "1 Zwiebel" für Sauce), führe sie ZWEIMAL als getrennte Einträge auf — fasse sie NICHT zusammen.
- Salz und Pfeffer ohne Mengenangabe NUR EINMAL auflisten (auch wenn in mehreren Blöcken erwähnt) mit amount=null, unit=null.
- Wenn keine Menge angegeben ist, setze amount=null und unit=null — erfinde keine Standardmengen.
- Wenn der Text NICHT eindeutig ein Rezept enthält, gib leere Listen zurück.
- In Schritt-Texten KEINE Aufzählung von Zutaten in Klammern einfügen wenn sie im Original nicht steht. Schritte 1:1 wie im Quelltext.

MENGEN — BRUCHZAHLEN PRÄZISE ÜBERNEHMEN:
- "1/2" → 0.5 (NICHT 1)
- "1 1/2" oder "1½" → 1.5 (NICHT 2)
- "3 1/2" oder "3½" → 3.5 (NICHT 4)
- "1/4" → 0.25, "3/4" → 0.75, "2/3" → 0.67
- NIEMALS auf ganze Zahl runden — Bruchzahlen exakt in Dezimal umwandeln.

TITEL:
- Versuche IMMER einen Titel zu erkennen. Auch wenn er nur klein gedruckt oder am Rand steht.
- Bei Buchseiten: Großgeschriebene Überschrift = Titel.
- Wenn wirklich kein Titel im Text steht, leite einen knappen aus den Hauptzutaten ab (z.B. "Klopse in Kapern-Sahne-Sauce").
- Setze title NUR auf null, wenn der Text gar kein Rezept ist.

WEITERE REGELN:
- Antworte AUSSCHLIESSLICH mit gültigem JSON, keine Erklärungen, kein Markdown.
- Alle Texte auf Deutsch.
- Wenn ein Feld nicht erkennbar ist, setze null oder leeres Array.
- Einheiten standardisieren: g, kg, ml, l, EL, TL, Stk, Prise, Msp, Bund, Zehe.
- "1 Glas" → setze amount=1, unit="Glas". Nicht in andere Einheit umrechnen.
- Schwierigkeit: einfach | mittel | schwer (oder null).
- Kalorien pro Portion: nur angeben wenn explizit im Rezept genannt, sonst null.
- Schritte 1:1 aus dem Quelltext übernehmen — keine inhaltliche Umstrukturierung, keine ergänzenden Erklärungen.`;

const JSON_SCHEMA_INSTRUCTION = `Antworte mit folgender JSON-Struktur:
{
  "title": "string | null",
  "description": "string | null (kurzer Einleitungstext, max 2 Sätze)",
  "durationMinutes": "number | null (Zubereitungsdauer in Minuten)",
  "difficulty": "einfach | mittel | schwer | null",
  "servings": "number | null (Anzahl Portionen)",
  "caloriesPerServing": "number | null (kcal pro Portion, falls im Rezept genannt)",
  "tags": ["string"] (Kategorien wie 'Pasta', 'Vegetarisch', 'Dessert'),
  "ingredients": [
    { "name": "string (KURZER Hauptbegriff, max 3 Wörter, ohne Klammern/Erläuterungen — z.B. 'Weizenmehl' statt 'Weizenmehl (Type 405, alternativ Dinkel)', 'Vollmilch' statt 'Vollmilch (3,5% oder 3,8% Fett)', 'Eier' statt 'Eier (Größe M oder L)')", "amount": "number | null", "unit": "string | null" }
  ],
  "steps": [
    { "order": "number (beginnt bei 1)", "text": "string (Anweisung wörtlich aus dem Quelltext)" }
  ]
}`;

@Injectable()
export class RecipeExtractorService {
  private readonly logger = new Logger(RecipeExtractorService.name);

  constructor(private readonly ollama: OllamaService) {}

  async extractFromImage(
    imageBase64: string,
    hints?: { title?: string | null; description?: string | null },
  ): Promise<ExtractedRecipeDraft> {
    const hintBlock =
      hints && (hints.title || hints.description)
        ? `KONTEXT VOM NUTZER (nutze als Orientierung — bestätige nur was du auch im Bild siehst):
${hints.title ? `Titel: ${hints.title}` : ''}
${hints.description ? `Beschreibung: ${hints.description}` : ''}

`
        : '';

    // STAGE 1: Reine OCR-Transkription als PLAIN TEXT.
    // Kein JSON-Schema, weil das Vision-Modell hier zuverlässig stolpert
    // (Markdown, Kommentare, Zeilenumbrüche im JSON-String → Parse-Fehler).
    // Klassifikation text vs dish_photo machen wir hinterher per Heuristik.
    const transcribePrompt = `${hintBlock}Du siehst ein Foto. Es kann ein gedrucktes Rezept, eine handschriftliche Notiz oder ein Foto von einem fertigen Gericht sein.

DEINE EINZIGE AUFGABE:

WENN TEXT IM BILD ZU SEHEN IST (gedrucktes Rezept, handschriftliche Notiz, Screenshot einer Rezeptseite):
- Transkribiere den Text WORT FÜR WORT, exakt wie er im Bild steht.
- Behalte Zeilenumbrüche und Reihenfolge bei.
- Erfinde NICHTS. Ergänze NICHTS. Schreibe NICHTS dazu.
- Wenn ein Wort unleserlich ist, schreibe stattdessen [?].
- Keine Anführungszeichen drumherum, keine Markdown-Syntax, keine Erklärungen.

WENN KEIN TEXT ZU SEHEN IST (nur Foto eines fertigen Gerichts):
- Schreibe als ERSTE ZEILE genau: GERICHT_FOTO
- Danach in 1-2 Sätzen: was liegt auf dem Teller? Sichtbare Zutaten, Garmethode falls erkennbar.
- KEINE Rezept-Spekulation, KEINE Mengenangaben, KEINE Schritte.

Antworte direkt mit dem transkribierten Text bzw. der Beschreibung — nichts davor, nichts danach.`;

    const transcribeRaw = await this.ollama.generate({
      model: this.ollama.visionModel,
      system: 'Du bist ein präziser OCR-Assistent. Du transkribierst Text aus Bildern wörtlich und erfindest niemals Inhalt. Du antwortest mit reinem Text, niemals mit JSON oder Markdown.',
      prompt: transcribePrompt,
      images: [imageBase64],
      // KEIN format: 'json' — wir wollen rohen Text
      tag: 'recipe:image-ocr',
      stage: '1/2 OCR',
    });

    // Klassifikation per Heuristik:
    //   - "GERICHT_FOTO" als erste Zeile → dish_photo
    //   - sonst: text, falls genug Inhalt
    const trimmed = transcribeRaw.trim();
    const isDishPhoto = /^GERICHT_FOTO\b/i.test(trimmed);
    const transcription: { type: 'text' | 'dish_photo'; raw_text: string } = isDishPhoto
      ? { type: 'dish_photo', raw_text: trimmed.replace(/^GERICHT_FOTO[\s:.\-]*/i, '').trim() }
      : { type: 'text', raw_text: trimmed };

    this.logger.debug(
      `OCR-Klassifikation: type=${transcription.type}, raw_text length=${transcription.raw_text.length}`,
    );

    // STAGE 2: Strukturierung
    const isText = transcription.type === 'text' && transcription.raw_text.trim().length > 20;
    if (isText) {
      // Bei lesbarem Text: Text-Pipeline benutzen — verhindert Halluzinations vom Vision-Model
      const draft = await this.extractFromText(transcription.raw_text, undefined, 'recipe:image-text', '2/2 Strukturieren');
      // Hint-Titel/Beschreibung nur ergänzen wenn nicht aus Text gewonnen
      if (hints?.title && !draft.title) draft.title = hints.title;
      if (hints?.description && !draft.description) draft.description = hints.description;
      // servings NICHT zwingen — extractFromText hat die echte Portionsanzahl aus dem Rezept-Text gelesen
      // (z.B. "Für 2 Personen" → servings=2). Nur Default 1 setzen wenn gar nichts erkannt wurde.
      if (!draft.servings || draft.servings <= 0) draft.servings = 1;
      return draft;
    }

    // Fallback: Gericht-Foto — Vision-Model schätzt aus dem Bild
    const visionPrompt = `${hintBlock}Hier ist ein Foto eines fertigen Gerichts.

Schätze Zutaten und Schritte basierend NUR auf dem was du auf dem Teller siehst${hints?.title ? ` und dem oben angegebenen Titel/Beschreibung` : ''}. Markiere im Feld "description" dass es sich um eine Schätzung handelt.

WICHTIG: Mengen IMMER für 1 PORTION angeben. Setze servings=1.

Wenn das Bild kein Gericht zeigt, setze title=null und gib leere Listen zurück.

${JSON_SCHEMA_INSTRUCTION}`;

    const raw = await this.ollama.generate({
      model: this.ollama.visionModel,
      system: SYSTEM_PROMPT,
      prompt: visionPrompt,
      images: [imageBase64],
      format: 'json',
      tag: 'recipe:image',
      stage: 'Schätzen aus Foto',
    });

    const parsed = this.ollama.parseJson<RawExtraction>(raw);
    const draft = this.normalize(parsed);
    draft.servings = 1;
    return this.enrichRecipe(draft);
  }

  async extractFromText(text: string, sourceUrl?: string, tag?: string, stage?: string): Promise<ExtractedRecipeDraft> {
    const trimmed = text.trim();
    if (trimmed.length < 50) {
      throw new BadRequestException(
        'Zu wenig Text zum Extrahieren. Die Webseite enthält möglicherweise kein Rezept.',
      );
    }

    // HTML aggressiv bereinigen falls Roh-HTML reinkommt
    const cleaned = this.cleanHtml(trimmed);

    // Größeres Fenster für vollständige Erfassung mehrerer Zutatenblöcke
    const content = this.extractRecipeBlock(cleaned);
    this.logger.debug(`Extracted content for LLM (${content.length} chars):\n${content.slice(0, 2000)}...`);

    const prompt = `Hier ist der Textinhalt einer Webseite${sourceUrl ? ` (${sourceUrl})` : ''}, die ein Rezept enthält. Extrahiere das Rezept als JSON.

WICHTIG:
- Erfinde NICHTS. Übernimm nur Zutaten und Mengen die wörtlich im Text stehen.
- Wenn der Text mehrere Zutaten-Abschnitte hat (z.B. "Zutaten Rhabarber:", "Zutaten Creme:", "Zutaten Teig:", "Für die Sauce:"), erfasse ALLE und führe sie zusammen in die ingredients-Liste.
- Trenne immer Menge, Einheit und Name. Beispiele:
  • "200 g Mascarpone" → {"amount": 200, "unit": "g", "name": "Mascarpone"}
  • "6 Tête de Moine AOP Rosetten + Deko" → {"amount": 6, "unit": "Stk", "name": "Tête de Moine AOP Rosetten"}
  • "1 Prise Salz" → {"amount": 1, "unit": "Prise", "name": "Salz"}
  • "Saft einer halben Zitrone" → {"amount": 0.5, "unit": null, "name": "Zitronensaft"}
  • "etwas Speisestärke" → {"amount": null, "unit": null, "name": "Speisestärke"}
- Ignoriere Werbung, Kommentare, "Zum Rezept springen"-Buttons, Cookie-Hinweise, Autor-Bio.

TEXT:
${content}

${JSON_SCHEMA_INSTRUCTION}`;

    const raw = await this.ollama.generate({
      model: this.ollama.textModel,
      system: SYSTEM_PROMPT,
      prompt,
      format: 'json',
      timeoutSec: 900,
      tag: tag ?? 'recipe:url',
      stage,
    });

    const parsed = this.ollama.parseJson<RawExtraction>(raw);
    let draft = this.normalize(parsed);
    draft = this.applySourceTextFixes(draft, content);

    // Retry mit erweitertem Window wenn das Ergebnis dürftig ist
    if (draft.ingredients.length < 3 && cleaned.length > content.length) {
      this.logger.log(`First extraction yielded only ${draft.ingredients.length} ingredients — retrying with full content`);
      const fullContent = cleaned.slice(0, 12000);
      const retryPrompt = prompt.replace(content, fullContent);
      const retryRaw = await this.ollama.generate({
        model: this.ollama.textModel,
        system: SYSTEM_PROMPT,
        prompt: retryPrompt,
        format: 'json',
        timeoutSec: 900,
        tag: tag ? `${tag}-retry` : 'recipe:url-retry',
        stage: stage ? `${stage} (retry)` : undefined,
      });
      const retryParsed = this.ollama.parseJson<RawExtraction>(retryRaw);
      let retryDraft = this.normalize(retryParsed);
      retryDraft = this.applySourceTextFixes(retryDraft, fullContent);
      if (retryDraft.ingredients.length > draft.ingredients.length) {
        draft = retryDraft;
      }
    }

    return this.enrichRecipe(draft);
  }

  /**
   * Sucht den Rezept-Block per Schlüsselwörtern (Zutaten/Zubereitung) und schneidet
   * gezielt um diesen Bereich. Fallback: erste 5000 Zeichen.
   */
  private extractRecipeBlock(text: string): string {
    const keywords = ['Zutaten', 'Zubereitung', 'Anleitung', 'Ingredients', 'Instructions'];
    // Sammle alle Vorkommen aller Keywords
    const hits: number[] = [];
    for (const kw of keywords) {
      let idx = 0;
      while ((idx = text.indexOf(kw, idx)) !== -1) {
        hits.push(idx);
        idx += kw.length;
      }
    }
    if (hits.length === 0) {
      return text.slice(0, 8000);
    }
    hits.sort((a, b) => a - b);

    // Finde den Cluster mit den meisten Hits innerhalb eines 4000-Zeichen-Fensters
    let bestStart = hits[0];
    let bestCount = 0;
    for (let i = 0; i < hits.length; i++) {
      const windowEnd = hits[i] + 4000;
      let count = 0;
      for (let j = i; j < hits.length && hits[j] < windowEnd; j++) count++;
      if (count > bestCount) {
        bestCount = count;
        bestStart = hits[i];
      }
    }
    const start = Math.max(0, bestStart - 800);
    return text.slice(start, start + 8000);
  }

  /** Public-Wrapper für cleanHtml — wird vom RecipesController genutzt. */
  htmlToText(input: string): string {
    return this.cleanHtml(input);
  }

  /** Reduziert Roh-HTML auf Text ohne Navigation/Footer/Sidebar/Scripts */
  private cleanHtml(input: string): string {
    // Wenn kein HTML, einfach durchreichen
    if (!input.includes('<')) return input;

    let html = input;
    // Skripte, Styles, Templates, SVGs komplett raus
    html = html.replace(/<script[\s\S]*?<\/script>/gi, ' ');
    html = html.replace(/<style[\s\S]*?<\/style>/gi, ' ');
    html = html.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
    html = html.replace(/<svg[\s\S]*?<\/svg>/gi, ' ');
    // Layout-Bereiche raus die nie Rezept-Inhalt enthalten
    html = html.replace(/<nav[\s\S]*?<\/nav>/gi, ' ');
    html = html.replace(/<header[\s\S]*?<\/header>/gi, ' ');
    html = html.replace(/<footer[\s\S]*?<\/footer>/gi, ' ');
    html = html.replace(/<aside[\s\S]*?<\/aside>/gi, ' ');
    html = html.replace(/<form[\s\S]*?<\/form>/gi, ' ');
    // Kommentar-Bereiche (häufig per id/class markiert)
    html = html.replace(/<(div|section)[^>]*(class|id)\s*=\s*["'][^"']*(comment|sidebar|menu|navigation|footer)[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi, ' ');
    // Soft-Hyphens, Zero-Width-Chars entfernen
    html = html.replace(/[\u00AD\u200B\u200C\u200D\uFEFF]/g, '');
    // HTML-Entities und Tags
    html = html.replace(/<[^>]+>/g, ' ');
    html = html.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    html = html.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
    // Whitespace normalisieren
    html = html.replace(/\s+/g, ' ').trim();
    return html;
  }

  /**
   * Fills in missing meta-fields (description, tags, difficulty, durationMinutes)
   * via a second LLM call, based on the extracted ingredients & steps.
   * Only fields that are still null/empty after extraction are filled.
   * Already-extracted fields are NEVER touched.
   */
  private async enrichRecipe(draft: ExtractedRecipeDraft): Promise<ExtractedRecipeDraft> {
    // Don't enrich if extraction failed (no recipe data)
    if (draft.ingredients.length === 0 && draft.steps.length === 0) {
      return draft;
    }

    // Decide which fields actually need enrichment
    const needs = {
      description: !draft.description,
      tags: draft.tags.length === 0,
      difficulty: !draft.difficulty,
      durationMinutes: !draft.durationMinutes,
    };
    if (!needs.description && !needs.tags && !needs.difficulty && !needs.durationMinutes) {
      return draft; // everything is filled
    }

    const fieldList = Object.entries(needs)
      .filter(([, v]) => v)
      .map(([k]) => k);

    this.logger.log(`Enriching recipe with missing fields: ${fieldList.join(', ')}`);

    const ingredientsText = draft.ingredients
      .map((i) => `- ${i.amount ?? ''} ${i.unit ?? ''} ${i.name}`.trim())
      .join('\n');
    const stepsText = draft.steps.map((s) => `${s.order}. ${s.text}`).join('\n');

    const enrichmentSchema = `{
${needs.description ? `  "description": "string (kurzer Einleitungstext, 1-2 Sätze auf Deutsch)",` : ''}
${needs.tags ? `  "tags": ["string"] (max 5 deutsche Schlagworte: Küche/Diät/Anlass/Hauptzutat, z.B. ['Pasta', 'Vegetarisch', 'Italienisch']),` : ''}
${needs.difficulty ? `  "difficulty": "einfach | mittel | schwer (basierend auf Schrittanzahl & Komplexität)",` : ''}
${needs.durationMinutes ? `  "durationMinutes": "number (geschätzte Gesamtdauer in Minuten)"` : ''}
}`.replace(/^\s*\n/gm, '');

    const prompt = `Hier ist ein Rezept "${draft.title ?? 'Unbenannt'}".

ZUTATEN:
${ingredientsText}

ZUBEREITUNG:
${stepsText}

Ergänze ausschliesslich die folgenden Felder. Antworte mit gültigem JSON, keine Erklärungen.

${enrichmentSchema}`;

    interface EnrichmentResult {
      description?: string | null;
      tags?: unknown;
      difficulty?: string | null;
      durationMinutes?: number | string | null;
    }

    let result: EnrichmentResult;
    try {
      const raw = await this.ollama.generate({
        model: this.ollama.textModel,
        system: 'Du ergänzt fehlende Meta-Informationen zu deutschen Rezepten. Antworte ausschliesslich mit JSON.',
        prompt,
        format: 'json',
        tag: 'recipe:text',
      });
      result = this.ollama.parseJson<EnrichmentResult>(raw);
    } catch (err) {
      this.logger.warn(`Enrichment skipped: ${(err as Error).message}`);
      return draft; // enrichment is best-effort, never fail the whole extraction
    }

    return {
      ...draft,
      description: needs.description ? this.toStr(result.description) ?? null : draft.description,
      tags:
        needs.tags && Array.isArray(result.tags)
          ? result.tags
              .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
              .map((t) => t.trim())
              .slice(0, 5)
          : draft.tags,
      difficulty: needs.difficulty ? this.toDifficulty(result.difficulty) : draft.difficulty,
      durationMinutes: needs.durationMinutes
        ? this.parseNumber(result.durationMinutes)
        : draft.durationMinutes,
    };
  }

  /**
   * Erkennt populäre WordPress Recipe-Card Plugins (WP Recipe Maker, Tasty Recipes,
   * Cooked, Mediavine Create) anhand ihrer CSS-Klassen. Sehr zuverlässig wenn vorhanden.
   */
  parseRecipeCardPlugin(html: string): ExtractedRecipeDraft | null {
    const plugins = [
      {
        name: 'WP Recipe Maker',
        container: /class\s*=\s*["'][^"']*\bwprm-recipe\b[^"']*["']/i,
        title: /class\s*=\s*["'][^"']*\bwprm-recipe-name\b[^"']*["'][^>]*>([\s\S]*?)<\//i,
        ingredient: /class\s*=\s*["'][^"']*\bwprm-recipe-ingredient\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi,
        instruction: /class\s*=\s*["'][^"']*\bwprm-recipe-instruction-text\b[^"']*["'][^>]*>([\s\S]*?)<\//gi,
      },
      {
        name: 'Tasty Recipes',
        container: /class\s*=\s*["'][^"']*\btasty-recipes\b[^"']*["']/i,
        title: /class\s*=\s*["'][^"']*\btasty-recipes-title\b[^"']*["'][^>]*>([\s\S]*?)<\//i,
        ingredient: /class\s*=\s*["'][^"']*\btasty-recipes-ingredients\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:ul|div)>/i,
        instruction: /class\s*=\s*["'][^"']*\btasty-recipes-instructions\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:ol|div)>/i,
      },
      {
        name: 'Cooked',
        container: /class\s*=\s*["'][^"']*\bcooked-recipe\b[^"']*["']/i,
        title: /class\s*=\s*["'][^"']*\bcooked-recipe-title\b[^"']*["'][^>]*>([\s\S]*?)<\//i,
        ingredient: /class\s*=\s*["'][^"']*\bcooked-ingredient\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi,
        instruction: /class\s*=\s*["'][^"']*\bcooked-direction\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi,
      },
    ];

    for (const p of plugins) {
      if (!p.container.test(html)) continue;

      const stripTags = (s: string) =>
        s.replace(/<[^>]+>/g, ' ').replace(/[­​‌‍﻿]/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

      const titleMatch = html.match(p.title);
      const title = titleMatch ? stripTags(titleMatch[1]) : null;
      if (!title) continue;

      // Zutaten: bei WPRM/Cooked sind das mehrere <li>-Matches; bei Tasty ein Block
      const ingredients: string[] = [];
      if (p.name === 'Tasty Recipes') {
        const block = html.match(p.ingredient as RegExp);
        if (block) {
          const items = [...block[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)];
          for (const m of items) {
            const t = stripTags(m[1]);
            if (t.length > 1 && t.length < 200) ingredients.push(t);
          }
        }
      } else {
        for (const m of html.matchAll(p.ingredient as RegExp)) {
          const t = stripTags(m[1]);
          if (t.length > 1 && t.length < 200) ingredients.push(t);
        }
      }
      if (ingredients.length < 2) continue;

      // Schritte
      const steps: { order: number; text: string }[] = [];
      if (p.name === 'Tasty Recipes') {
        const block = html.match(p.instruction as RegExp);
        if (block) {
          const items = [...block[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)];
          items.forEach((m, i) => {
            const t = stripTags(m[1]);
            if (t) steps.push({ order: i + 1, text: t });
          });
        }
      } else {
        const matches = [...html.matchAll(p.instruction as RegExp)];
        matches.forEach((m, i) => {
          const t = stripTags(m[1]);
          if (t) steps.push({ order: i + 1, text: t });
        });
      }

      this.logger.log(`${p.name} plugin found (${ingredients.length} ingredients, ${steps.length} steps), skipping LLM`);

      return this.normalize({
        title,
        description: null,
        durationMinutes: null,
        difficulty: null,
        servings: null,
        caloriesPerServing: null,
        tags: [],
        ingredients: this.parseIngredientLines(ingredients),
        steps,
      });
    }

    return null;
  }

  /**
   * Heuristik: Suche direkt <hN>Zutaten</hN>...<ul>...</ul> und <hN>Zubereitung</hN>...<ol>...</ol>.
   * Komplett ohne LLM, daher keine Halluzinationen — nur 1:1-Übernahme aus HTML.
   * Liefert null wenn das Pattern nicht eindeutig matcht.
   */
  parseHeuristic(html: string): ExtractedRecipeDraft | null {
    // Soft-Hyphens (U+00AD), Zero-Width Spaces und ihre HTML-Entities entfernen — sonst greift kein Header-Match
    // bei silbentrennenden Sites wie foodistas (Zuta­ten statt Zutaten)
    html = html
      .replace(/&shy;|&#173;|&#xAD;/gi, '')
      .replace(/[\u00AD\u200B\u200C\u200D\uFEFF]/g, '');
    // Sammle ALLE Zutaten-Blöcke (mehrere Sektionen z.B. "Zutaten Teig" + "Zutaten Creme")
    // Versuch 1: <hN>Zutaten...</hN> gefolgt von <ul>
    // Versuch 2: <p><strong>Zutaten...</strong></p> oder <strong>Zutaten...</strong> gefolgt von <ul>
    const ingHeaderRe = /<(?:h[1-6]|p|strong|b|div)[^>]*>([^<]*?(?:zutaten|ingredients|für die|für den|für das|für eine|glasur|topping|marinade|garnitur|teig|füllung|sauce|soße|dressing|crème|creme)[^<]*?)<\/(?:h[1-6]|p|strong|b|div)>([\s\S]*?)(?=<(?:h[1-6]|p|strong|b|div)[^>]*>(?:[^<]*?(?:zutaten|ingredients|zubereitung|anleitung|instructions|für die|für den|für das|für eine|glasur|topping|marinade|garnitur|teig|füllung|sauce|soße))|<h[1-6]|<\/article|<\/main|$)/gi;
    const allIngredients: string[] = [];
    for (const m of html.matchAll(ingHeaderRe)) {
      const section = m[2];
      // Finde alle <ul>-Blöcke in dieser Sektion (nicht nur den ersten)
      const listMatches = [...section.matchAll(/<ul[\s\S]*?<\/ul>/gi)];
      for (const listMatch of listMatches) {
        const items = [...listMatch[0].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)];
        for (const li of items) {
          const text = li[1].replace(/<[^>]+>/g, ' ').replace(/[­​‌‍﻿]/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
          if (text.length > 1 && text.length < 200) allIngredients.push(text);
        }
      }
    }
    if (allIngredients.length < 2) return null;

    // Schritte: <ol> nach Zubereitung/Anleitung-Header (auch <strong>/<p>)
    const stepHeaderRe = /<(?:h[1-6]|p|strong|b|div)[^>]*>([^<]*?(?:zubereitung|anleitung|instructions)[^<]*?)<\/(?:h[1-6]|p|strong|b|div)>([\s\S]*?)(?=<h[1-6]|<\/article|<\/main|$)/i;
    const stepMatch = html.match(stepHeaderRe);
    const steps: { order: number; text: string }[] = [];
    if (stepMatch) {
      const section = stepMatch[2];
      const listMatch = section.match(/<ol[\s\S]*?<\/ol>/i);
      if (listMatch) {
        const items = [...listMatch[0].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)];
        items.forEach((li, i) => {
          const text = li[1].replace(/<[^>]+>/g, ' ').replace(/[­​‌‍﻿]/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
          if (text) steps.push({ order: i + 1, text });
        });
      }
    }
    if (steps.length === 0) return null;

    // Titel: erstes <h1> oder <title>
    const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : null;
    if (!title) return null;

    this.logger.log(`Heuristic recipe found (${allIngredients.length} ingredients, ${steps.length} steps), skipping LLM`);

    const ingredients: RecipeIngredient[] = this.parseIngredientLines(allIngredients);

    return this.normalize({
      title,
      description: null,
      durationMinutes: null,
      difficulty: null,
      servings: null,
      caloriesPerServing: null,
      tags: [],
      ingredients,
      steps,
    });
  }

  /**
   * Try schema.org/Recipe JSON-LD first — it's structured & reliable.
   * Returns null if no JSON-LD recipe found.
   */
  parseJsonLd(html: string): ExtractedRecipeDraft | null {
    const scriptRegex = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    const matches = [...html.matchAll(scriptRegex)];
    for (const match of matches) {
      try {
        const json = JSON.parse(match[1].trim());
        const recipe = this.findRecipeInJsonLd(json);
        if (recipe) {
          this.logger.log('JSON-LD recipe found, skipping LLM');
          return this.normalizeJsonLd(recipe);
        }
      } catch {
        // ignore malformed JSON-LD blocks
      }
    }
    return null;
  }

  /**
   * Try schema.org Microdata (itemtype="...Recipe", itemprop="ingredients"/"recipeIngredient"/"recipeInstructions").
   * Häufig in WordPress-Plugins wie "All in One Schema.org Rich Snippets".
   */
  parseMicrodata(html: string): ExtractedRecipeDraft | null {
    // Suche Recipe-Block per itemtype
    const recipeMatch = html.match(/<[^>]+itemtype\s*=\s*["'][^"']*\/Recipe["'][^>]*>([\s\S]*?)(?=<[^>]+itemtype\s*=\s*["'][^"']*\/(?:Recipe|Article|BlogPosting)|$)/i);
    if (!recipeMatch) return null;
    const block = recipeMatch[1];

    const getProp = (prop: string): string[] => {
      const re = new RegExp(`<[^>]+itemprop\\s*=\\s*["']${prop}["'][^>]*>([\\s\\S]*?)<\\/[a-z]+>`, 'gi');
      const out: string[] = [];
      for (const m of block.matchAll(re)) {
        const text = m[1].replace(/<[^>]+>/g, ' ').replace(/[­​‌‍﻿]/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
        if (text) out.push(text);
      }
      return out;
    };

    const name = getProp('name')[0] ?? null;
    const description = getProp('description')[0] ?? null;
    const ingRaw = getProp('recipeIngredient').concat(getProp('ingredients'));
    const stepsRaw = getProp('recipeInstructions').concat(getProp('instructions'));

    if (!name || ingRaw.length === 0) return null;

    this.logger.log(`Microdata recipe found (${ingRaw.length} ingredients), skipping LLM`);

    const ingredients = this.parseIngredientLines(ingRaw);
    const steps = stepsRaw.map((text, i) => ({ order: i + 1, text }));

    return this.normalize({
      title: name,
      description: description ? this.shortenDescription(description) : null,
      durationMinutes: null,
      difficulty: null,
      servings: null,
      caloriesPerServing: null,
      tags: [],
      ingredients,
      steps,
    });
  }

  /** Heuristik: "200 g Mehl" -> {amount: 200, unit: "g", name: "Mehl"} */
  private normalizeUnit(u: string): string {
    const map: Record<string, string> = {
      'stück': 'Stk', 'pck': 'Pck', 'pck.': 'Pck', 'päckchen': 'Pck',
      'tlöff': 'TL', 'elöff': 'EL',
    };
    return map[u.toLowerCase()] ?? u;
  }

  private findRecipeInJsonLd(node: unknown): Record<string, unknown> | null {
    if (!node) return null;
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = this.findRecipeInJsonLd(item);
        if (found) return found;
      }
      return null;
    }
    if (typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      const type = obj['@type'];
      const isRecipe =
        type === 'Recipe' || (Array.isArray(type) && type.includes('Recipe'));
      if (isRecipe) return obj;
      if (obj['@graph']) return this.findRecipeInJsonLd(obj['@graph']);
    }
    return null;
  }

  private normalizeJsonLd(r: Record<string, unknown>): ExtractedRecipeDraft {
    const ingredients = this.parseJsonLdIngredients(r['recipeIngredient']);
    const steps = this.parseJsonLdSteps(r['recipeInstructions']);
    const duration = this.parseIsoDuration(r['totalTime'] ?? r['cookTime'] ?? r['prepTime']);
    const servings = this.parseNumber(r['recipeYield']);
    const tags = this.parseStringList(r['recipeCategory'], r['recipeCuisine'], r['keywords']);
    const description = typeof r['description'] === 'string' ? this.shortenDescription(r['description'] as string) : null;

    const nutrition = r['nutrition'] as Record<string, unknown> | undefined;
    const calRaw = nutrition?.['calories'];
    const caloriesPerServing = this.parseNumber(calRaw);
    const proteinPerServing = this.parseFloatNum(nutrition?.['proteinContent']);
    const carbsPerServing = this.parseFloatNum(nutrition?.['carbohydrateContent']);
    const fatPerServing = this.parseFloatNum(nutrition?.['fatContent']);

    return {
      title: typeof r['name'] === 'string' ? (r['name'] as string).trim() : null,
      description,
      durationMinutes: duration,
      difficulty: null,
      servings,
      caloriesPerServing,
      proteinPerServing,
      carbsPerServing,
      fatPerServing,
      tags,
      ingredients,
      steps,
    };
  }

  private parseFloatNum(raw: unknown): number | null {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
    if (typeof raw === 'string') {
      const m = raw.match(/(\d+(?:[.,]\d+)?)/);
      if (m) {
        const num = Number.parseFloat(m[1].replace(',', '.'));
        return Number.isFinite(num) ? num : null;
      }
    }
    return null;
  }

  private parseJsonLdIngredients(raw: unknown): RecipeIngredient[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((s): s is string => typeof s === 'string')
      .map((line) => this.parseIngredientLine(line));
  }

  private parseJsonLdSteps(raw: unknown): RecipeStep[] {
    if (!raw) return [];
    const lines: string[] = [];
    const collect = (item: unknown): void => {
      if (typeof item === 'string') {
        lines.push(item);
      } else if (Array.isArray(item)) {
        item.forEach(collect);
      } else if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        const type = obj['@type'];
        if (type === 'HowToSection' && Array.isArray(obj['itemListElement'])) {
          (obj['itemListElement'] as unknown[]).forEach(collect);
        } else if (typeof obj['text'] === 'string') {
          lines.push(obj['text'] as string);
        } else if (typeof obj['name'] === 'string') {
          lines.push(obj['name'] as string);
        }
      }
    };
    collect(raw);
    return lines
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .map((text, i) => ({ order: i + 1, text }));
  }

  private parseIngredientLines(lines: string[]): RecipeIngredient[] {
    const out: RecipeIngredient[] = [];
    for (const line of lines) {
      // "X ml A + Y ml B" → splitten
      const split = line.split(/\s+\+\s+(?=\d)/);
      for (const part of split) {
        out.push(this.parseIngredientLine(part));
      }
    }
    return out;
  }

  private parseIngredientLine(line: string): RecipeIngredient {
    let cleaned = line.trim().replace(/\s+/g, ' ');
    // Soft-Hyphens (U+00AD) und Zero-Width Spaces entfernen — kommt vor bei silbentrennenden Sites wie foodistas
    cleaned = cleaned.replace(/[\u00AD\u200B\u200C\u200D\uFEFF]/g, '');
    // HTML-Entities decoden (für robust)
    cleaned = cleaned
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&auml;/g, 'ä').replace(/&ouml;/g, 'ö').replace(/&uuml;/g, 'ü')
      .replace(/&Auml;/g, 'Ä').replace(/&Ouml;/g, 'Ö').replace(/&Uuml;/g, 'Ü')
      .replace(/&szlig;/g, 'ß')
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
      .replace(/\s+/g, ' ');
    // Entferne führendes "ca." / "ca "
    cleaned = cleaned.replace(/^ca\.?\s+/i, '');
    // Entferne führendes "etwas " / "ein wenig "
    const isVague = /^(etwas|ein wenig|eine prise|nach geschmack|n\.b\.)\b/i.test(cleaned);
    if (isVague) {
      return { name: cleaned, amount: null, unit: null };
    }

    // Entferne führendes Bullet/Spiegelstrich
    cleaned = cleaned.replace(/^[•\-\*]\s*/, '');

    // Spezialfälle: "Saft einer halben Zitrone", "Saft von 2 Zitronen"
    if (/^Saft (einer|eines|von) /i.test(cleaned)) {
      return { name: cleaned, amount: null, unit: null };
    }

    // Bruchzahlen ½, ¼, ¾
    const fracMap: Record<string, string> = { '½': '0.5', '¼': '0.25', '¾': '0.75', '⅓': '0.333', '⅔': '0.667' };
    cleaned = cleaned.replace(/[½¼¾⅓⅔]/g, (c) => fracMap[c] ?? c);

    // Format "1/2 Zitrone" → 0.5
    const fracRe = /^(\d+)\s*\/\s*(\d+)\s+(.+)$/;
    const fracMatch = cleaned.match(fracRe);
    if (fracMatch) {
      const amount = parseInt(fracMatch[1], 10) / parseInt(fracMatch[2], 10);
      return this.parseAfterAmount(amount, fracMatch[3]);
    }

    // Bereiche "2-3 Äpfel", "200–250 g Mehl" → erste Zahl nehmen
    cleaned = cleaned.replace(/^(\d+(?:[.,]\d+)?)\s*[-–—]\s*\d+(?:[.,]\d+)?\s+/, '$1 ');

    // Standard: "<amount> [unit] <name>"
    const match = cleaned.match(/^(\d+(?:[.,]\d+)?)\s*(.*)$/);
    if (match) {
      const amount = parseFloat(match[1].replace(',', '.'));
      const rest = match[2];
      return this.parseAfterAmount(Number.isFinite(amount) ? amount : null, rest);
    }
    return { name: cleaned, amount: null, unit: null };
  }

  private parseAfterAmount(amount: number | null, rest: string): RecipeIngredient {
    const trimmed = rest.trim();
    // Erweiterte Unit-Map mit deutschen + englischen + Aliasen
    const unitMap: Record<string, string> = {
      'g': 'g', 'gramm': 'g',
      'kg': 'kg', 'kilo': 'kg', 'kilogramm': 'kg',
      'mg': 'mg',
      'ml': 'ml', 'milliliter': 'ml',
      'cl': 'cl', 'centiliter': 'cl',
      'l': 'l', 'liter': 'l',
      'el': 'EL', 'esslöffel': 'EL', 'tablespoon': 'EL', 'tbsp': 'EL', 'eßl': 'EL',
      'tl': 'TL', 'teelöffel': 'TL', 'teaspoon': 'TL', 'tsp': 'TL',
      'stk': 'Stk', 'stück': 'Stk', 'st': 'Stk', 'pcs': 'Stk', 'piece': 'Stk',
      'prise': 'Prise', 'prisen': 'Prise',
      'tasse': 'Tasse', 'tassen': 'Tasse', 'cup': 'Tasse', 'cups': 'Tasse',
      'bund': 'Bund',
      'pkg': 'Pkg', 'packung': 'Pkg', 'pck': 'Pkg', 'pack': 'Pkg', 'paket': 'Pkg',
      'dose': 'Dose', 'dosen': 'Dose',
      'glas': 'Glas', 'gläser': 'Glas',
      'zehe': 'Zehe', 'zehen': 'Zehe',
      'blatt': 'Blatt', 'blätter': 'Blatt',
      'msp': 'Msp', 'messerspitze': 'Msp',
      'schuss': 'Schuss',
      'spritzer': 'Spritzer',
    };

    // Unit-Token extrahieren (1. Wort)
    const unitMatch = trimmed.match(/^([a-zA-ZäöüÄÖÜß]+)\.?\s+(.+)$/);
    if (unitMatch) {
      const unitKey = unitMatch[1].toLowerCase();
      const mapped = unitMap[unitKey];
      if (mapped) {
        return { name: unitMatch[2].trim(), amount, unit: mapped };
      }
    }

    // Keine Unit gefunden - alles ist Name
    return { name: trimmed, amount, unit: null };
  }

  private parseIsoDuration(raw: unknown): number | null {
    if (typeof raw !== 'string') return null;
    // ISO 8601 duration: PT15M, PT1H30M, PT2H
    const m = raw.match(/^PT(?:(\d+)H)?(?:(\d+)M)?$/);
    if (!m) {
      const num = parseInt(raw, 10);
      return Number.isFinite(num) && num > 0 ? num : null;
    }
    const hours = parseInt(m[1] ?? '0', 10);
    const minutes = parseInt(m[2] ?? '0', 10);
    const total = hours * 60 + minutes;
    return total > 0 ? total : null;
  }

  private parseNumber(raw: unknown): number | null {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'number') return Number.isFinite(raw) ? Math.round(raw) : null;
    if (typeof raw === 'string') {
      const m = raw.match(/(\d+(?:[.,]\d+)?)/);
      if (m) {
        const num = parseFloat(m[1].replace(',', '.'));
        return Number.isFinite(num) ? Math.round(num) : null;
      }
    }
    return null;
  }

  /**
   * Parst Mengenangaben für Zutaten als Float (NICHT runden — sonst werden 1.5 EL zu 2 EL).
   * Erkennt zusätzlich Bruchzahlen-Strings als Sicherheitsnetz, falls das LLM trotz Anweisung
   * "1 1/2" statt 1.5 zurückgibt.
   *
   *   3.5 → 3.5
   *   "1 1/2" → 1.5
   *   "1½" → 1.5
   *   "1/2" → 0.5
   *   "¼" → 0.25
   *   "250" → 250
   *   "0,75" → 0.75
   */
  private parseAmount(raw: unknown): number | null {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'number') {
      return Number.isFinite(raw) && raw >= 0 ? raw : null;
    }
    if (typeof raw !== 'string') return null;

    // Unicode-Bruchzeichen normalisieren
    const unicodeFractions: Record<string, number> = {
      '½': 0.5, '⅓': 0.333, '⅔': 0.667,
      '¼': 0.25, '¾': 0.75,
      '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8,
      '⅙': 0.167, '⅚': 0.833,
      '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
    };

    const cleaned = raw.trim().replace(',', '.');

    // "1½" oder "1 ½" → 1.5
    const mixedUnicode = cleaned.match(/^(\d+)\s*([½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])/);
    if (mixedUnicode) {
      const whole = parseInt(mixedUnicode[1], 10);
      const frac = unicodeFractions[mixedUnicode[2]];
      if (frac !== undefined) return whole + frac;
    }

    // Pures Unicode-Bruchzeichen
    const fracOnly = cleaned.match(/^([½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])/);
    if (fracOnly && unicodeFractions[fracOnly[1]] !== undefined) {
      return unicodeFractions[fracOnly[1]];
    }

    // "1 1/2" → 1.5
    const mixed = cleaned.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)/);
    if (mixed) {
      const whole = parseInt(mixed[1], 10);
      const num = parseInt(mixed[2], 10);
      const den = parseInt(mixed[3], 10);
      if (den > 0) return whole + num / den;
    }

    // "1/2" → 0.5
    const fracMatch = cleaned.match(/^(\d+)\s*\/\s*(\d+)/);
    if (fracMatch) {
      const num = parseInt(fracMatch[1], 10);
      const den = parseInt(fracMatch[2], 10);
      if (den > 0) return num / den;
    }

    // Standard-Float
    const numMatch = cleaned.match(/^(\d+(?:\.\d+)?)/);
    if (numMatch) {
      const n = parseFloat(numMatch[1]);
      return Number.isFinite(n) && n >= 0 ? n : null;
    }
    return null;
  }

  private parseStringList(...inputs: unknown[]): string[] {
    const out = new Set<string>();
    for (const input of inputs) {
      if (typeof input === 'string') {
        input.split(',').forEach((s) => {
          const trimmed = s.trim();
          if (trimmed) out.add(trimmed);
        });
      } else if (Array.isArray(input)) {
        for (const item of input) {
          if (typeof item === 'string' && item.trim()) out.add(item.trim());
        }
      }
    }
    return [...out].slice(0, 10);
  }

  private shortenDescription(text: string): string | null {
    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (!cleaned) return null;
    if (cleaned.length <= 280) return cleaned;
    return cleaned.slice(0, 277) + '...';
  }

  /**
   * Post-Processing nach LLM-Extraktion: Korrigiert systematische Fehler
   * die das Modell trotz Prompt-Regeln macht.
   *
   * - Bruchzahl-Korrektur: wenn der Quelltext "3½ EL" oder "1 1/2 EL" enthält
   *   und das LLM "4 EL" / "2 EL" extrahiert hat, korrigiere zurück zu 3.5 / 1.5.
   * - Klammer-Cleanup: "(Hack, Brötchen, Eier...)" aus Schritten entfernen wenn
   *   nicht im Originaltext.
   * - Klammer in Zutat-Namen: "Hack (Rind/Schwein)" → "Hack" — aber nur wenn
   *   die Klammer kein wichtiges Detail enthält das Mengen-relevant ist.
   * - Titel-Fallback: wenn null und es gibt Schritte, leite einen aus den
   *   ersten Hauptzutaten ab.
   */
  private applySourceTextFixes(
    draft: ExtractedRecipeDraft,
    sourceText: string,
  ): ExtractedRecipeDraft {
    if (!sourceText || sourceText.length < 20) return draft;

    // 1. Bruchzahl-Korrektur in Zutaten
    const fixedIngredients = draft.ingredients.map((ing) => {
      if (ing.amount === null || ing.amount === undefined) return ing;

      // Suche im Quelltext nach Bruchzahl-Patterns für diese Zutat
      const corrected = this.detectFractionInSource(ing, sourceText);
      if (corrected !== null && Math.abs(corrected - ing.amount) > 0.01) {
        this.logger.debug(
          `Bruchzahl-Fix: "${ing.name}" ${ing.amount}${ing.unit ?? ''} → ${corrected}${ing.unit ?? ''} (aus Quelltext)`,
        );
        return { ...ing, amount: corrected };
      }
      return ing;
    });

    // 2. Klammer-Cleanup in Zutat-Namen
    const cleanedIngredients = fixedIngredients.map((ing) => {
      const cleanedName = this.cleanIngredientName(ing.name);
      return cleanedName !== ing.name ? { ...ing, name: cleanedName } : ing;
    });

    // 3. Halluzinierte Klammer-Aufzählungen aus Schritten entfernen
    const fixedSteps = draft.steps.map((step) => {
      const cleanedText = this.cleanStepText(step.text, sourceText);
      return cleanedText !== step.text ? { ...step, text: cleanedText } : step;
    });

    // 4. Titel-Fallback
    let title = draft.title;
    if (!title && cleanedIngredients.length >= 2) {
      title = this.deriveTitle(cleanedIngredients, draft.steps);
      if (title) {
        this.logger.debug(`Titel aus Zutaten abgeleitet: "${title}"`);
      }
    }

    return {
      ...draft,
      title,
      ingredients: cleanedIngredients,
      steps: fixedSteps,
    };
  }

  /**
   * Sucht im Quelltext nach Bruchzahl-Mustern für die gegebene Zutat.
   * Returns korrekte Dezimalzahl, oder null wenn nichts Verwertbares gefunden.
   *
   * Erkennt:
   *   "3½ EL Mehl", "3 ½ EL Mehl", "3 1/2 EL Mehl"
   *   "½ TL Salz", "1/2 TL Salz"
   */
  private detectFractionInSource(
    ing: { name: string; unit: string | null },
    sourceText: string,
  ): number | null {
    if (!ing.name) return null;
    // Erstes Wort vom Zutaten-Namen — robust gegen leichte Abweichungen
    const firstWord = ing.name.split(/[\s,(]/)[0];
    if (firstWord.length < 3) return null;

    const escaped = firstWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$1');

    // Pattern: optional ganze Zahl, dann Bruch (½, ¼, ¾, ⅓, ⅔ oder x/y), optional Einheit, dann Zutaten-Name
    // Erlaube bis zu 30 Zeichen zwischen Menge und Zutaten-Name (Einheit, Adjektive etc.)
    const fracChars = '½¼¾⅓⅔⅛⅜⅝⅞';
    const patterns: RegExp[] = [
      // "3½ EL Mehl" oder "3 ½ EL Mehl"
      new RegExp(`(\\d+)\\s*([${fracChars}])\\s*[\\w./\\s]{0,30}?\\b${escaped}`, 'i'),
      // "½ TL Salz" (nur Bruch ohne Ganze)
      new RegExp(`(?<![\\d.,])([${fracChars}])\\s*[\\w./\\s]{0,30}?\\b${escaped}`, 'i'),
      // "3 1/2 EL Mehl"
      new RegExp(`(\\d+)\\s+(\\d)\\s*/\\s*(\\d)\\s*[\\w./\\s]{0,30}?\\b${escaped}`, 'i'),
      // "1/2 TL Salz" (nur Bruch x/y ohne Ganze)
      new RegExp(`(?<![\\d.,])(\\d)\\s*/\\s*(\\d)\\s*[\\w./\\s]{0,30}?\\b${escaped}`, 'i'),
    ];

    const fracMap: Record<string, number> = {
      '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 0.333, '⅔': 0.667, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
    };

    // Pattern 1: Ganzzahl + Unicode-Bruch
    let m = sourceText.match(patterns[0]);
    if (m && fracMap[m[2]] !== undefined) {
      return parseInt(m[1], 10) + fracMap[m[2]];
    }
    // Pattern 2: nur Unicode-Bruch
    m = sourceText.match(patterns[1]);
    if (m && fracMap[m[1]] !== undefined) {
      return fracMap[m[1]];
    }
    // Pattern 3: Ganzzahl + Bruch x/y
    m = sourceText.match(patterns[2]);
    if (m) {
      const denom = parseInt(m[3], 10);
      if (denom > 0) return parseInt(m[1], 10) + parseInt(m[2], 10) / denom;
    }
    // Pattern 4: nur Bruch x/y
    m = sourceText.match(patterns[3]);
    if (m) {
      const denom = parseInt(m[2], 10);
      if (denom > 0) return parseInt(m[1], 10) / denom;
    }

    return null;
  }

  /**
   * Bereinigt Zutaten-Namen: entfernt Klammer-Zusätze die das LLM trotz
   * Prompt-Regel "ohne Klammern" mitschleppt.
   *
   *   "Hack (Rind/Schwein)" → "Hack"
   *   "Mehl (Type 405)" → "Mehl"
   *   "Salz, fein" → "Salz" (Komma-Annotation auch raus)
   */
  private cleanIngredientName(name: string): string {
    let cleaned = name
      .replace(/\s*\([^)]*\)\s*/g, ' ')
      .replace(/\s*,\s*[a-zäöüß][^,]*$/i, '');
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    return cleaned || name;
  }

  /**
   * Erkennt halluzinierte Klammer-Aufzählungen in Schritt-Texten:
   * Wenn der Schritt eine Klammer mit ≥3 Komma-getrennten Begriffen enthält,
   * die so im Quelltext NICHT vorkommt, ist das eine LLM-Halluzination — entfernen.
   *
   *   Original: "Aus den Zutaten für die Klopse die Klopse mischen und formen."
   *   LLM-Output: "Aus den Zutaten für die Klopse (Hack, altes Brötchen, Zwiebel, Eier, Salz, Pfeffer, Petersilie) die Klopse mischen und formen."
   *   → Klammer raus, weil so nicht im Quelltext.
   */
  private cleanStepText(text: string, sourceText: string): string {
    return text.replace(/\s*\(([^)]+)\)/g, (full, inner: string) => {
      // Nur Klammern mit ≥2 Kommas (= ≥3 Items) prüfen
      if ((inner.match(/,/g) ?? []).length < 2) return full;
      // Ist der Klammer-Inhalt so im Quelltext zu finden?
      const escaped = inner.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$1');
      const re = new RegExp(escaped.replace(/\s+/g, '\\s+'), 'i');
      if (re.test(sourceText)) return full; // existiert im Original → ok
      // Halluziniert → wegschneiden
      return '';
    }).replace(/\s+/g, ' ').trim();
  }

  /**
   * Leitet einen Titel aus den ersten 1-2 Hauptzutaten ab.
   * Heuristik: erste Zutat mit Menge ≥ 100g oder erstes Stück = Hauptzutat.
   */
  private deriveTitle(
    ingredients: RecipeIngredient[],
    steps: RecipeStep[],
  ): string | null {
    // Hauptzutat: erste mit nennenswerter Menge
    const main = ingredients.find(
      (i) =>
        i.amount !== null &&
        i.amount !== undefined &&
        ((i.unit === 'g' && i.amount >= 100) ||
          (i.unit === 'kg' && i.amount >= 0.1) ||
          (i.unit === 'Stk' && i.amount >= 1)),
    );
    if (!main) return null;

    // Suche in den Schritten nach einem charakteristischen Verb/Substantiv
    const stepText = steps.map((s) => s.text).join(' ').toLowerCase();
    const dishHints: Record<string, string> = {
      'klops': 'Klopse',
      'klöß': 'Klöße',
      'kuchen': 'Kuchen',
      'suppe': 'Suppe',
      'salat': 'Salat',
      'auflauf': 'Auflauf',
      'pfanne': 'Pfannengericht',
      'eintopf': 'Eintopf',
      'sauce': 'Sauce',
      'soße': 'Soße',
    };
    for (const [hint, label] of Object.entries(dishHints)) {
      if (stepText.includes(hint)) {
        return `${main.name} ${label === 'Klopse' || label === 'Klöße' ? 'in Sauce' : 'mit ' + label}`.replace(/\s+/g, ' ').trim();
      }
    }

    return `Rezept mit ${main.name}`;
  }

  private normalize(raw: RawExtraction): ExtractedRecipeDraft {
    const title = this.toStr(raw.title);
    const description = this.toStr(raw.description);
    const durationMinutes = this.parseNumber(raw.durationMinutes);
    const difficulty = this.toDifficulty(raw.difficulty);
    const servings = this.parseNumber(raw.servings);
    const caloriesPerServing = this.parseNumber(raw.caloriesPerServing);
    const proteinPerServing = this.parseFloatNum((raw as Record<string, unknown>)['proteinPerServing']);
    const carbsPerServing = this.parseFloatNum((raw as Record<string, unknown>)['carbsPerServing']);
    const fatPerServing = this.parseFloatNum((raw as Record<string, unknown>)['fatPerServing']);

    const tags = Array.isArray(raw.tags)
      ? raw.tags
          .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
          .map((t) => t.trim())
          .slice(0, 10)
      : [];

    const ingredients: RecipeIngredient[] = Array.isArray(raw.ingredients)
      ? raw.ingredients
          .map((i) => this.normalizeIngredient(i))
          .filter((i): i is RecipeIngredient => i !== null)
      : [];

    // Salz/Pfeffer ohne Mengenangabe NUR EINMAL behalten — auch wenn das LLM sie aus mehreren
    // Rezeptblöcken doppelt aufführt (Klopse + Sauce). Mit-Mengen-Einträge bleiben unangetastet.
    const dedupedIngredients = this.dedupeUnitlessSpices(ingredients);

    const stepsRaw: RecipeStep[] = Array.isArray(raw.steps)
      ? raw.steps
          .map((s, idx) => this.normalizeStep(s, idx))
          .filter((s): s is RecipeStep => s !== null)
      : [];
    // Re-number in case the model skipped numbers
    const steps = stepsRaw.map((s, idx) => ({ ...s, order: idx + 1 }));

    return {
      title,
      description,
      durationMinutes,
      difficulty,
      servings,
      caloriesPerServing,
      proteinPerServing,
      carbsPerServing,
      fatPerServing,
      tags,
      ingredients: dedupedIngredients,
      steps,
    };
  }

  /**
   * Entfernt doppelte mengenlose Salz/Pfeffer-Einträge.
   * "Salz" ohne amount/unit + "Salz" ohne amount/unit → nur einmal behalten.
   * "Salz, 1 TL" + "Salz" ohne Menge → beide bleiben (verschiedene Verwendung).
   */
  private dedupeUnitlessSpices(ingredients: RecipeIngredient[]): RecipeIngredient[] {
    const result: RecipeIngredient[] = [];
    const seenUnitless = new Set<string>();
    const SPICE_NAMES = /^(salz|pfeffer|salz und pfeffer|salz & pfeffer)$/i;

    for (const ing of ingredients) {
      const isUnitless = ing.amount === null && ing.unit === null;
      const isSpice = SPICE_NAMES.test(ing.name.trim());

      if (isUnitless && isSpice) {
        const key = ing.name.trim().toLowerCase();
        if (seenUnitless.has(key)) continue;
        seenUnitless.add(key);
      }

      result.push(ing);
    }
    return result;
  }

  private normalizeIngredient(raw: unknown): RecipeIngredient | null {
    if (!raw || typeof raw !== 'object') return null;
    const obj = raw as Record<string, unknown>;
    const name = this.toStr(obj['name']);
    if (!name) return null;
    return {
      name,
      amount: this.parseAmount(obj['amount']),
      unit: this.toStr(obj['unit']),
    };
  }

  private normalizeStep(raw: unknown, idx: number): RecipeStep | null {
    if (!raw) return null;
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      return trimmed ? { order: idx + 1, text: trimmed } : null;
    }
    if (typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      const text = this.toStr(obj['text']);
      if (!text) return null;
      const orderRaw = this.parseNumber(obj['order']);
      return { order: orderRaw ?? idx + 1, text };
    }
    return null;
  }

  private toStr(v: unknown): string | null {
    if (typeof v !== 'string') return null;
    const trimmed = v.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private toDifficulty(v: unknown): Difficulty | null {
    if (typeof v !== 'string') return null;
    const lower = v.trim().toLowerCase();
    if (lower === 'einfach' || lower === 'mittel' || lower === 'schwer') return lower;
    if (lower === 'leicht') return 'einfach';
    if (lower === 'schwierig') return 'schwer';
    return null;
  }
}
