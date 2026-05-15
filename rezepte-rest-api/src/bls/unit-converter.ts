/**
 * Konvertiert Haushaltseinheiten (EL, TL, Tasse, Stück …) in Gramm.
 *
 * Tabelle abhängig von der Zutat: 1 EL Mehl = 12g, 1 EL Honig = 21g.
 * Daher: erst Zutat-Familie ermitteln, dann Faktor.
 *
 * Werte sind Mittelwerte aus üblichen Konvertierungstabellen
 * (z. B. dge.de, USDA cooking weights).
 */

export type Unit =
  | 'g'
  | 'kg'
  | 'ml'
  | 'l'
  | 'el'      // Esslöffel
  | 'tl'      // Teelöffel
  | 'tasse'
  | 'prise'
  | 'stueck'
  | 'bund'
  | 'zehe'    // Knoblauchzehe
  | 'scheibe'
  | 'unknown';

const UNIT_ALIASES: Record<string, Unit> = {
  'g': 'g', 'gramm': 'g', 'gr': 'g',
  'kg': 'kg', 'kilo': 'kg', 'kilogramm': 'kg',
  'ml': 'ml', 'milliliter': 'ml',
  'l': 'l', 'liter': 'l',
  'el': 'el', 'esslöffel': 'el', 'esslöffel.': 'el', 'esslöffel,': 'el', 'tbsp': 'el',
  'tl': 'tl', 'teelöffel': 'tl', 'tsp': 'tl',
  'tasse': 'tasse', 'tassen': 'tasse', 'cup': 'tasse', 'cups': 'tasse',
  'prise': 'prise', 'prisen': 'prise',
  'stk': 'stueck', 'stk.': 'stueck', 'stück': 'stueck', 'stueck': 'stueck',
  'bund': 'bund',
  'zehe': 'zehe', 'zehen': 'zehe',
  'scheibe': 'scheibe', 'scheiben': 'scheibe',
};

export function normalizeUnit(raw: string | null | undefined): Unit {
  if (!raw) return 'unknown';
  const cleaned = raw.trim().toLowerCase().replace(/[\.\s,]+/g, '');
  return UNIT_ALIASES[cleaned] ?? 'unknown';
}

/**
 * Faktor "1 [Einheit] dieser Zutat in Gramm".
 *
 * Schlüssel sind Substring-Matches gegen den lowercase Zutat-Namen.
 * Reihenfolge zählt: spezifischere Begriffe ZUERST.
 */
const SPOON_GRAM_TABLE: { match: RegExp; el: number; tl: number; tasse?: number }[] = [
  // Flüssigkeiten / Öle (1 EL = 10g, 1 TL = 5g, 1 Tasse = 240g)
  { match: /öl|olivenöl|sonnenblumenöl|rapsöl/, el: 10, tl: 5, tasse: 240 },
  { match: /essig|balsamico/, el: 15, tl: 5, tasse: 240 },
  // Süß / klebrig
  { match: /honig|sirup|ahornsirup|melasse/, el: 21, tl: 7 },
  { match: /butter|margarine/, el: 14, tl: 5 },
  // Pulver leicht
  { match: /backpulver|natron|hefe.*trocken|trockenhefe/, el: 9, tl: 3 },
  { match: /salz/, el: 18, tl: 6 },
  { match: /zucker.*puder|puderzucker/, el: 8, tl: 2.5, tasse: 120 },
  { match: /zucker|rohrzucker|brauner zucker/, el: 12, tl: 4, tasse: 200 },
  // Mehle & Stärken
  { match: /mehl|stärke|maisstärke|speisestärke/, el: 12, tl: 4, tasse: 120 },
  { match: /haferflocken|cornflakes/, el: 6, tl: 2, tasse: 80 },
  // Nüsse / Saaten
  { match: /samen|kerne|nüsse|mandeln|pistazien|cashew|haselnüsse|walnüsse/, el: 10, tl: 3, tasse: 120 },
  // Reis / Linsen / Bohnen (trocken)
  { match: /reis(?!gericht)|linsen|bohnen/, el: 14, tl: 5, tasse: 200 },
  // Sahne / Joghurt / Milch (1 EL = 15ml ≈ 15g)
  { match: /sahne|crème fraîche|creme fraiche|joghurt|quark|milch|buttermilch/, el: 15, tl: 5, tasse: 240 },
  // Senf, Tomatenmark, Paste
  { match: /senf|tomatenmark|tomatenpaste|currypaste/, el: 16, tl: 5 },
  // Kakao, Kaffee
  { match: /kakao|kaffeepulver|instant.*kaffee/, el: 6, tl: 2 },
  // Kräuter frisch
  { match: /petersilie|basilikum|schnittlauch|dill|koriander.*frisch|minze/, el: 4, tl: 1.5 },
  // Kräuter getrocknet
  { match: /thymian|rosmarin|oregano|getrocknet/, el: 2, tl: 0.7 },
  // Gewürze gemahlen (Pfeffer, Kümmel, Paprika, Zimt, Curry…)
  { match: /pfeffer|kümmel|paprikapulver|zimt|curry|kurkuma|muskat|gewürz/, el: 6, tl: 2 },
  // Reisbrei / dickflüssig
  { match: /joghurt|pesto|mayo|mayonnaise|ketchup/, el: 15, tl: 5 },
];

const PIECE_GRAM_TABLE: { match: RegExp; grams: number }[] = [
  // Gemüse Stück
  { match: /\bzwiebel\b/, grams: 110 },
  { match: /knoblauch.*zehe|\bzehe\b/, grams: 5 },
  { match: /\bkartoffel/, grams: 130 },
  { match: /tomate/, grams: 90 },
  { match: /paprika/, grams: 150 },
  { match: /karotte|möhre/, grams: 80 },
  { match: /zucchini/, grams: 200 },
  { match: /aubergine/, grams: 250 },
  { match: /apfel/, grams: 150 },
  { match: /banane/, grams: 120 },
  { match: /zitrone/, grams: 90 },
  { match: /limette/, grams: 60 },
  { match: /orange/, grams: 180 },
  { match: /\bei\b|eier/, grams: 60 },
  { match: /chilischote|chili/, grams: 8 },
  { match: /lorbeerblatt|lorbeer/, grams: 0.3 },
];

const BUND_GRAM_TABLE: { match: RegExp; grams: number }[] = [
  { match: /petersilie|basilikum|schnittlauch|dill|koriander|minze|kräuter/, grams: 30 },
  { match: /spargel/, grams: 500 },
  { match: /radieschen/, grams: 100 },
  { match: /lauchzwiebel|frühlingszwiebel/, grams: 100 },
];

const SCHEIBE_GRAM_TABLE: { match: RegExp; grams: number }[] = [
  { match: /brot|toast/, grams: 30 },
  { match: /käse/, grams: 25 },
  { match: /wurst|salami|schinken/, grams: 20 },
  { match: /ananas/, grams: 80 },
];

export interface ConversionResult {
  /** Menge in Gramm */
  grams: number;
  /** Wie wurde umgerechnet (für Debugging / Anzeige) */
  source: 'direct' | 'volume' | 'spoon' | 'piece' | 'bund' | 'scheibe' | 'fallback';
  /** Confidence 0..1 — niedrig wenn fallback verwendet wird */
  confidence: number;
}

const PRISE_GRAMS = 0.4;

/**
 * Hauptfunktion: konvertiert (Menge, Einheit, Zutat) in Gramm.
 *
 * Returns null wenn nichts Sinnvolles gerechnet werden kann
 * (z.B. amount=0 oder unbekannte Einheit + unbekannte Zutat).
 */
export function convertToGrams(
  amount: number | null | undefined,
  unitRaw: string | null | undefined,
  ingredientName: string,
): ConversionResult | null {
  if (amount === null || amount === undefined || amount <= 0) return null;

  const unit = normalizeUnit(unitRaw);
  const name = ingredientName.toLowerCase();

  // Direkter Massenangaben
  if (unit === 'g') return { grams: amount, source: 'direct', confidence: 1.0 };
  if (unit === 'kg') return { grams: amount * 1000, source: 'direct', confidence: 1.0 };

  // Volumen (für Flüssigkeiten ~ Wasser-Dichte; bei dichteren Sachen unter spoon-Tabelle)
  if (unit === 'ml') return { grams: amount, source: 'volume', confidence: 0.9 };
  if (unit === 'l') return { grams: amount * 1000, source: 'volume', confidence: 0.9 };

  // Esslöffel / Teelöffel / Tasse — ingredient-spezifisch
  if (unit === 'el' || unit === 'tl' || unit === 'tasse') {
    const row = SPOON_GRAM_TABLE.find((r) => r.match.test(name));
    if (row) {
      const factor = unit === 'el' ? row.el : unit === 'tl' ? row.tl : row.tasse;
      if (factor !== undefined) {
        return { grams: amount * factor, source: 'spoon', confidence: 0.8 };
      }
    }
    // Fallback: generische Werte (wie für Wasser)
    const fallback = unit === 'el' ? 15 : unit === 'tl' ? 5 : 240;
    return { grams: amount * fallback, source: 'spoon', confidence: 0.5 };
  }

  if (unit === 'prise') {
    return { grams: amount * PRISE_GRAMS, source: 'spoon', confidence: 0.6 };
  }

  // Stück
  if (unit === 'stueck') {
    const row = PIECE_GRAM_TABLE.find((r) => r.match.test(name));
    if (row) return { grams: amount * row.grams, source: 'piece', confidence: 0.75 };
    return null; // Ohne Match nicht sinnvoll schätzbar
  }

  if (unit === 'zehe') {
    return { grams: amount * 5, source: 'piece', confidence: 0.9 };
  }

  if (unit === 'bund') {
    const row = BUND_GRAM_TABLE.find((r) => r.match.test(name));
    if (row) return { grams: amount * row.grams, source: 'bund', confidence: 0.7 };
    return { grams: amount * 50, source: 'bund', confidence: 0.4 };
  }

  if (unit === 'scheibe') {
    const row = SCHEIBE_GRAM_TABLE.find((r) => r.match.test(name));
    if (row) return { grams: amount * row.grams, source: 'scheibe', confidence: 0.7 };
    return { grams: amount * 25, source: 'scheibe', confidence: 0.4 };
  }

  // unknown unit: try piece-table heuristic (manchmal kommt "1 Zwiebel" ganz ohne Einheit)
  if (unit === 'unknown') {
    const piece = PIECE_GRAM_TABLE.find((r) => r.match.test(name));
    if (piece) return { grams: amount * piece.grams, source: 'piece', confidence: 0.6 };
  }

  return null;
}
