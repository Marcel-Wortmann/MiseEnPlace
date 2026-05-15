import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { OllamaService } from './ollama.service';
import { BlsService, BlsHit } from '../bls/bls.service';
import { UserIngredientsService, UserIngredientMatch } from '../user-ingredients/user-ingredients.service';
import { convertToGrams, ConversionResult } from '../bls/unit-converter';
import { CaloriesEstimate, RecipeIngredient } from '@shared/interfaces/recipe.interface';

/** Schwelle ab der ein BLS-Hit als "sicher" gilt und kein LLM-Disambiguator gebraucht wird. */
const BLS_AUTO_THRESHOLD = 0.75;
/** Schwelle ab der wir einen BLS-Hit überhaupt in Erwägung ziehen. */
const BLS_MIN_THRESHOLD = 0.35;
/** Confidence-Schwelle für die Mengen-Konvertierung — darunter LLM rechnen lassen. */
const GRAM_MIN_CONFIDENCE = 0.5;

interface ResolvedIngredient {
  ingredient: RecipeIngredient;
  /** Quelle: 'vorrat' = User-Vorrat überschreibt alles, 'bls' = aus DB, 'llm' = LLM-geschätzt, 'skipped' = nicht berechenbar */
  source: 'vorrat' | 'bls' | 'llm' | 'skipped';
  grams: number | null;
  gramsSource: ConversionResult['source'] | null;
  matchedTerm?: string;
  blsCode?: string;
  blsName?: string;
  blsScore?: number;
  kcal: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
}

@Injectable()
export class CalorieEstimatorService {
  private readonly logger = new Logger(CalorieEstimatorService.name);

  constructor(
    private readonly ollama: OllamaService,
    private readonly bls: BlsService,
    private readonly userIngredients: UserIngredientsService,
  ) {}

  async estimate(
    userId: string,
    ingredients: RecipeIngredient[],
    servings: number | null | undefined,
    title?: string | null,
  ): Promise<CaloriesEstimate> {
    const cleaned = ingredients
      .filter((i) => i.name && i.name.trim().length > 0)
      .slice(0, 60);

    if (cleaned.length === 0) {
      throw new ServiceUnavailableException(
        'Bitte zuerst mindestens eine Zutat eintragen, bevor Werte geschätzt werden.',
      );
    }

    const portionCount = servings && servings > 0 ? servings : 4;

    // Vorrat-Matches in EINEM Batch laden (ein DB-Roundtrip statt N)
    const vorratMatches = await this.userIngredients.matchManyForRecipe(
      userId,
      cleaned.map((i) => i.name),
    );

    // BLS verfügbar? Wenn nicht → degradierter Pfad: Vorrat + LLM-Fallback
    const blsCount = await this.bls.count();
    if (blsCount === 0) {
      this.logger.warn('BLS leer — nutze Vorrat + LLM-Only-Pfad.');
      return this.estimateWithoutBls(cleaned, vorratMatches, title, portionCount);
    }

    // Hybrid-Pfad: Vorrat-First → BLS → LLM
    const resolved: ResolvedIngredient[] = [];
    const llmCandidates: { index: number; ingredient: RecipeIngredient; blsHits: BlsHit[]; grams: number | null }[] = [];

    for (let i = 0; i < cleaned.length; i++) {
      const ing = cleaned[i];
      const vorrat = vorratMatches[i];
      const conversion = convertToGrams(ing.amount ?? null, ing.unit ?? null, ing.name);
      const grams = conversion && conversion.confidence >= GRAM_MIN_CONFIDENCE ? conversion.grams : null;

      // Pfad A: Vorrat-Match → IMMER nehmen, höchste Priorität
      if (vorrat) {
        // Wenn keine Gramm-Angabe + defaultGramsPerPiece + Stück-Einheit → defaultGrams nutzen
        let effectiveGrams = grams;
        if (effectiveGrams === null && vorrat.defaultGramsPerPiece && ing.amount && ing.amount > 0) {
          const unitNorm = (ing.unit ?? '').toLowerCase().trim();
          if (!unitNorm || unitNorm === 'stk' || unitNorm === 'stück' || unitNorm === 'stueck') {
            effectiveGrams = ing.amount * vorrat.defaultGramsPerPiece;
          }
        }
        if (effectiveGrams !== null) {
          resolved.push(this.applyVorrat(ing, vorrat, effectiveGrams, conversion?.source ?? null));
          continue;
        }
        // Vorrat erkannt, aber Gramm unklar → LLM-Batch mit Vorrat-Hint
        llmCandidates.push({ index: i, ingredient: ing, blsHits: [], grams: null });
        continue;
      }

      // Kein Vorrat-Match → BLS
      const hits = await this.bls.search(ing.name, 5);
      const top = hits[0];

      // Pfad B: BLS-Top-Hit eindeutig + Gramm sicher → DB-Werte direkt
      if (top && top.score >= BLS_AUTO_THRESHOLD && grams !== null) {
        resolved.push(this.applyBls(ing, top, grams, conversion!.source));
        continue;
      }

      // Pfad C: Es gibt mind. einen plausiblen BLS-Kandidaten oder Gramm unsicher → LLM-Batch
      llmCandidates.push({
        index: i,
        ingredient: ing,
        blsHits: top && top.score >= BLS_MIN_THRESHOLD ? hits : [],
        grams,
      });
    }

    if (llmCandidates.length > 0) {
      const llmResults = await this.resolveWithLlm(llmCandidates, vorratMatches, title);
      resolved.push(...llmResults);
    }

    return this.aggregate(resolved, portionCount);
  }

  /** Vorrats-Match → ResolvedIngredient. User-Werte überschreiben alles. Fehlende Makros bleiben null. */
  private applyVorrat(
    ing: RecipeIngredient,
    match: UserIngredientMatch,
    grams: number,
    gramsSource: ConversionResult['source'] | null,
  ): ResolvedIngredient {
    const factor = grams / 100;
    return {
      ingredient: ing,
      source: 'vorrat',
      grams,
      gramsSource,
      matchedTerm: match.matchedTerm,
      kcal: match.kcalPer100g * factor,
      protein: match.proteinPer100g !== null ? match.proteinPer100g * factor : null,
      carbs: match.carbsPer100g !== null ? match.carbsPer100g * factor : null,
      fat: match.fatPer100g !== null ? match.fatPer100g * factor : null,
    };
  }

  private applyBls(
    ing: RecipeIngredient,
    hit: BlsHit,
    grams: number,
    gramsSource: ConversionResult['source'],
  ): ResolvedIngredient {
    const factor = grams / 100;
    return {
      ingredient: ing,
      source: 'bls',
      grams,
      gramsSource,
      blsCode: hit.code,
      blsName: hit.name,
      blsScore: hit.score,
      kcal: hit.kcalPer100g * factor,
      protein: hit.proteinPer100g !== null ? hit.proteinPer100g * factor : null,
      carbs: hit.carbsPer100g !== null ? hit.carbsPer100g * factor : null,
      fat: hit.fatPer100g !== null ? hit.fatPer100g * factor : null,
    };
  }

  /**
   * Batch-LLM-Call. Ein Request für alle unsicheren Zutaten.
   * Vorrats-Matches werden im Prompt erwähnt, damit das LLM sie nicht überschreibt.
   */
  private async resolveWithLlm(
    candidates: { index: number; ingredient: RecipeIngredient; blsHits: BlsHit[]; grams: number | null }[],
    vorratMatches: (UserIngredientMatch | null)[],
    title: string | null | undefined,
  ): Promise<ResolvedIngredient[]> {
    const titleInfo = title?.trim() ? title.trim() : '(ohne Titel)';
    const list = candidates
      .map((c, idx) => {
        const amount = c.ingredient.amount ?? '?';
        const unit = c.ingredient.unit ?? '';
        const gramsText = c.grams !== null ? `${Math.round(c.grams)}g` : 'unbekannt';
        const vorrat = vorratMatches[c.index];
        const vorratHint = vorrat
          ? `\n  EIGENE ZUTAT (Vorrat) erkannt: "${vorrat.name}" — ${vorrat.kcalPer100g} kcal/100g`
          : '';
        const optionsText =
          c.blsHits.length > 0
            ? `\n  BLS-Kandidaten:\n${c.blsHits
                .map(
                  (h, i) =>
                    `    [${i}] ${h.code} "${h.name}" — ${h.kcalPer100g} kcal/100g, P:${h.proteinPer100g ?? '?'} K:${h.carbsPer100g ?? '?'} F:${h.fatPer100g ?? '?'}`,
                )
                .join('\n')}`
            : vorratHint
              ? ''
              : '\n  (keine passenden BLS-Einträge)';
        return `${idx}. "${c.ingredient.name}" (Menge: ${amount} ${unit}, geschätzte Gramm: ${gramsText})${vorratHint}${optionsText}`;
      })
      .join('\n\n');

    const prompt = `Rezept: ${titleInfo}

Für die folgenden Zutaten brauche ich Nährwerte. Pro Zutat:
- Wenn EIGENE ZUTAT (Vorrat) erkannt wurde: NICHT überschreiben! Nur die Gramm schätzen, blsIndex=null, kcalPer100g=null lassen — der Code nutzt dann die Vorrats-Werte des Users.
- Wenn BLS-Kandidaten vorhanden: Wähle den passendsten Index. Setze "blsIndex" auf die Nummer.
- Wenn keine Gramm-Angabe da ist: Schätze grams realistisch.
- Wenn KEIN passender BLS-Kandidat existiert: Setze blsIndex=null, schätze kcalPer100g/proteinPer100g/carbsPer100g/fatPer100g selbst (Plausibilität: kcal ≈ protein*4 + carbs*4 + fat*9).

ZUTATEN:
${list}

Antwort als JSON:
{
  "items": [
    {
      "index": 0,
      "blsIndex": 1,
      "grams": 150,
      "kcalPer100g": null,
      "proteinPer100g": null,
      "carbsPer100g": null,
      "fatPer100g": null
    }
  ]
}`;

    const SYSTEM = `Du wählst BLS-Lebensmittel-Einträge aus oder schätzt Nährwerte. Antworte AUSSCHLIESSLICH mit gültigem JSON. Keine Erfindungen — bei BLS-Kandidaten wähle nur aus der gegebenen Liste. Vorrats-Treffer NIEMALS überschreiben.`;

    interface LlmItem {
      index: number;
      blsIndex: number | null;
      grams: number | null;
      kcalPer100g: number | null;
      proteinPer100g: number | null;
      carbsPer100g: number | null;
      fatPer100g: number | null;
    }

    let parsed: { items?: LlmItem[] };
    try {
      const raw = await this.ollama.generate({
        model: this.ollama.textModel,
        system: SYSTEM,
        prompt,
        format: 'json',
        // 1800s damit Position 2/3 in der Queue (sequenziell) nicht durchs
        // Warten austimen — Cold-Start auf Mac Studio kann 90s sein, dann
        // 30s Inferenz pro Item.
        timeoutSec: 1800,
        // 12k Tokens für sehr lange Zutatenlisten mit vollem BLS-Kandidaten-Set.
        maxTokens: 12288,
        tag: 'calorie:disambiguate',
      });
      parsed = this.ollama.parseJson<{ items?: LlmItem[] }>(raw);
    } catch (err) {
      this.logger.warn(`LLM-Disambiguation fehlgeschlagen: ${(err as Error).message}`);
      // Fallback: alle als skipped markieren — außer wo Vorrat erkannt wurde
      return candidates.map((c) => {
        const vorrat = vorratMatches[c.index];
        if (vorrat && c.grams !== null) return this.applyVorrat(c.ingredient, vorrat, c.grams, null);
        return this.skipped(c.ingredient, c.grams);
      });
    }

    const itemsByIndex = new Map<number, LlmItem>();
    for (const it of parsed.items ?? []) {
      if (typeof it.index === 'number') itemsByIndex.set(it.index, it);
    }

    const results: ResolvedIngredient[] = [];
    for (let idx = 0; idx < candidates.length; idx++) {
      const c = candidates[idx];
      const item = itemsByIndex.get(idx);
      const vorrat = vorratMatches[c.index];

      if (!item) {
        if (vorrat && c.grams !== null) {
          results.push(this.applyVorrat(c.ingredient, vorrat, c.grams, null));
        } else {
          results.push(this.skipped(c.ingredient, c.grams));
        }
        continue;
      }

      const grams = item.grams ?? c.grams;
      if (grams === null || grams <= 0) {
        results.push(this.skipped(c.ingredient, null));
        continue;
      }

      // Pfad: Vorrat-Match → Vorrats-Werte mit LLM-geschätzten Gramm
      if (vorrat) {
        results.push(this.applyVorrat(c.ingredient, vorrat, grams, null));
        continue;
      }

      // Pfad: LLM hat einen BLS-Index gewählt → DB-Werte verwenden
      if (item.blsIndex !== null && item.blsIndex !== undefined && c.blsHits[item.blsIndex]) {
        const hit = c.blsHits[item.blsIndex];
        results.push(this.applyBls(c.ingredient, hit, grams, 'spoon'));
        continue;
      }

      // Pfad: LLM hat eigene Werte geschätzt
      if (item.kcalPer100g !== null && item.kcalPer100g !== undefined && item.kcalPer100g > 0) {
        const factor = grams / 100;
        const kcal = item.kcalPer100g * factor;
        if (kcal > 0 && kcal < 50000) {
          results.push({
            ingredient: c.ingredient,
            source: 'llm',
            grams,
            gramsSource: null,
            kcal,
            protein:
              item.proteinPer100g !== null && item.proteinPer100g !== undefined ? item.proteinPer100g * factor : null,
            carbs:
              item.carbsPer100g !== null && item.carbsPer100g !== undefined ? item.carbsPer100g * factor : null,
            fat: item.fatPer100g !== null && item.fatPer100g !== undefined ? item.fatPer100g * factor : null,
          });
          continue;
        }
      }

      results.push(this.skipped(c.ingredient, grams));
    }

    return results;
  }

  private skipped(ingredient: RecipeIngredient, grams: number | null): ResolvedIngredient {
    return {
      ingredient,
      source: 'skipped',
      grams,
      gramsSource: null,
      kcal: 0,
      protein: null,
      carbs: null,
      fat: null,
    };
  }

  private aggregate(resolved: ResolvedIngredient[], portionCount: number): CaloriesEstimate {
    const vorratCount = resolved.filter((r) => r.source === 'vorrat').length;
    const blsCount = resolved.filter((r) => r.source === 'bls').length;
    const llmCount = resolved.filter((r) => r.source === 'llm').length;
    const skippedCount = resolved.filter((r) => r.source === 'skipped').length;
    this.logger.log(
      `Calorie-Estimate: ${vorratCount} Vorrat, ${blsCount} BLS, ${llmCount} LLM, ${skippedCount} skipped — ${resolved.length} total.`,
    );

    const sum = resolved.reduce(
      (acc, r) => ({
        kcal: acc.kcal + r.kcal,
        protein: acc.protein + (r.protein ?? 0),
        carbs: acc.carbs + (r.carbs ?? 0),
        fat: acc.fat + (r.fat ?? 0),
      }),
      { kcal: 0, protein: 0, carbs: 0, fat: 0 },
    );

    const someProtein = resolved.some((r) => r.protein !== null);
    const someCarbs = resolved.some((r) => r.carbs !== null);
    const someFat = resolved.some((r) => r.fat !== null);

    return {
      caloriesPerServing: Math.round(sum.kcal / portionCount),
      proteinPerServing: someProtein ? Math.round((sum.protein / portionCount) * 10) / 10 : null,
      carbsPerServing: someCarbs ? Math.round((sum.carbs / portionCount) * 10) / 10 : null,
      fatPerServing: someFat ? Math.round((sum.fat / portionCount) * 10) / 10 : null,
    };
  }

  /**
   * Fallback wenn BLS-DB leer ist: Vorrat-Treffer direkt nutzen, Rest per LLM-Self-Consistency.
   */
  private async estimateWithoutBls(
    ingredients: RecipeIngredient[],
    vorratMatches: (UserIngredientMatch | null)[],
    title: string | null | undefined,
    portionCount: number,
  ): Promise<CaloriesEstimate> {
    const resolved: ResolvedIngredient[] = [];
    const remaining: RecipeIngredient[] = [];

    for (let i = 0; i < ingredients.length; i++) {
      const ing = ingredients[i];
      const vorrat = vorratMatches[i];
      const conversion = convertToGrams(ing.amount ?? null, ing.unit ?? null, ing.name);
      const grams = conversion && conversion.confidence >= GRAM_MIN_CONFIDENCE ? conversion.grams : null;
      if (vorrat && grams !== null) {
        resolved.push(this.applyVorrat(ing, vorrat, grams, conversion!.source));
      } else {
        remaining.push(ing);
      }
    }

    if (remaining.length === 0) {
      return this.aggregate(resolved, portionCount);
    }

    const titleInfo = title?.trim() ? title.trim() : '(ohne Titel)';
    const ingredientList = remaining
      .map((i) => {
        const amount = i.amount !== null && i.amount !== undefined ? `${i.amount}` : '?';
        const unit = i.unit ?? '';
        return `- ${amount} ${unit} ${i.name}`.trim();
      })
      .join('\n');

    const prompt = `Schätze GESAMT-Nährwerte für die folgenden Zutaten (rechne mit Gesamtmenge, NICHT pro Portion).

Rezept: ${titleInfo}
Zutaten:
${ingredientList}

Plausibilitäts-Check: kcal ≈ protein*4 + carbs*4 + fat*9.
Antworte JSON:
{ "totalKcal": <int>, "totalProtein": <num>, "totalCarbs": <num>, "totalFat": <num> }`;

    const SYSTEM = `Du bist Ernährungsberater. Antworte AUSSCHLIESSLICH mit gültigem JSON.`;

    const runs: { kcal: number; protein: number; carbs: number; fat: number }[] = [];
    for (let i = 0; i < 3; i++) {
      try {
        const raw = await this.ollama.generate({
          model: this.ollama.textModel,
          system: SYSTEM,
          prompt,
          format: 'json',
          tag: 'calorie:llm-only',
        });
        const parsed = this.ollama.parseJson<{
          totalKcal?: number | string | null;
          totalProtein?: number | string | null;
          totalCarbs?: number | string | null;
          totalFat?: number | string | null;
        }>(raw);
        const kcal = this.parseNumber(parsed.totalKcal);
        const protein = this.parseFloat(parsed.totalProtein);
        const carbs = this.parseFloat(parsed.totalCarbs);
        const fat = this.parseFloat(parsed.totalFat);
        if (kcal !== null && kcal > 0 && kcal < 50000) {
          runs.push({ kcal, protein: protein ?? 0, carbs: carbs ?? 0, fat: fat ?? 0 });
        }
      } catch (err) {
        this.logger.warn(`LLM-Run ${i + 1} fehlgeschlagen: ${(err as Error).message}`);
      }
    }

    if (runs.length === 0 && resolved.length === 0) {
      throw new ServiceUnavailableException('KI konnte keine plausible Schätzung liefern.');
    }

    const median = (arr: number[]): number => {
      const sorted = [...arr].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    };

    // Resolved (Vorrat) und LLM-Median addieren
    const llmKcal = runs.length > 0 ? median(runs.map((r) => r.kcal)) : 0;
    const llmProtein = runs.length > 0 && runs.some((r) => r.protein > 0) ? median(runs.map((r) => r.protein)) : null;
    const llmCarbs = runs.length > 0 && runs.some((r) => r.carbs > 0) ? median(runs.map((r) => r.carbs)) : null;
    const llmFat = runs.length > 0 && runs.some((r) => r.fat > 0) ? median(runs.map((r) => r.fat)) : null;

    const vorratSum = resolved.reduce(
      (acc, r) => ({
        kcal: acc.kcal + r.kcal,
        protein: acc.protein + (r.protein ?? 0),
        carbs: acc.carbs + (r.carbs ?? 0),
        fat: acc.fat + (r.fat ?? 0),
      }),
      { kcal: 0, protein: 0, carbs: 0, fat: 0 },
    );

    const totalKcal = llmKcal + vorratSum.kcal;
    const someProtein = resolved.some((r) => r.protein !== null) || llmProtein !== null;
    const someCarbs = resolved.some((r) => r.carbs !== null) || llmCarbs !== null;
    const someFat = resolved.some((r) => r.fat !== null) || llmFat !== null;

    return {
      caloriesPerServing: Math.round(totalKcal / portionCount),
      proteinPerServing: someProtein ? Math.round(((vorratSum.protein + (llmProtein ?? 0)) / portionCount) * 10) / 10 : null,
      carbsPerServing: someCarbs ? Math.round(((vorratSum.carbs + (llmCarbs ?? 0)) / portionCount) * 10) / 10 : null,
      fatPerServing: someFat ? Math.round(((vorratSum.fat + (llmFat ?? 0)) / portionCount) * 10) / 10 : null,
    };
  }

  private parseFloat(raw: unknown): number | null {
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
}
