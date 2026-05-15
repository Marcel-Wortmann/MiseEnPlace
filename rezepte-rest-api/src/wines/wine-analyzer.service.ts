import { Injectable, Logger } from '@nestjs/common';
import { OllamaService } from '../ai/ollama.service';
import { TavilyService } from './tavily.service';
import { WineAnalysisResult, WineType } from '@shared/interfaces/wine.interface';

const SYSTEM_PROMPT = `Du bist ein Wein-Experte für die Analyse von Weinflaschen-Fotos.

REGELN:
- Antworte AUSSCHLIESSLICH mit gültigem JSON, keine Erklärungen.
- Lies das Etikett wortwörtlich. Was nicht klar lesbar ist, MUSS null sein.
- Erfinde NIEMALS Werte. Im Zweifel: null.
- Unterscheide klar zwischen Weingut (Erzeuger), Weinname (Marke/Cuvée) und Geschmacksrichtung. "SAVOURY & RICH", "SMOOTH & FRUITY" sind KEINE Weingüter sondern Beschreibungen.

WICHTIG — Weingut richtig erkennen:
- Weingut = ERZEUGER, NICHT der Importeur, NICHT der Vertrieb.
- Suche nach: "Produced by", "Producer", "Erzeuger", "Weingut", "Bottled by", "Mis en bouteille par", "Embotellado por", "Produzido por", "Produced and bottled by".
- IGNORIERE NIEMALS folgende Felder als Weingut: "Imported by", "Importeur", "Distributed by", "Vertrieb durch", "Importé par".
- Beispiel: Steht "Produced by: Salcuta SRL" und "Imported by: C.I.V. Superunie" → Weingut ist "Salcuta", NICHT "C.I.V. Superunie".

Land:
- Schreib das Land genau wie auf der Flasche steht ("Wine of …", "Produit de …", "Product of …", "Republic of …"), übersetzt ins Deutsche.
- Wenn nicht eindeutig erkennbar, null.
- Bekannte Weinländer u.a. Deutschland, Frankreich, Italien, Spanien, Portugal, Österreich, Schweiz, USA, Argentinien, Chile, Südafrika, Australien, Neuseeland, Moldau, Georgien, Ungarn, Griechenland, Bulgarien, Kroatien, Slowenien, Rumänien, Türkei, Libanon, Israel.
- "Republic of Moldova" oder "Wine of Moldova" → "Moldau".

Jahrgang: nur eine 4-stellige Zahl zwischen 1900 und 2100, gut sichtbar auf dem Etikett. Lot-Nummern, Abfülldaten oder Mindesthaltbarkeit sind KEIN Jahrgang. Wenn unsicher: null.

Wein-Typ aus Etikett, Flaschenform, Farbe ableiten:
- 'rot' = Rotwein
- 'weiss' = Weißwein
- 'rose' = Roséwein
- 'schaumwein' = Sekt, Champagner, Crémant, Prosecco

description und tastingNotes IMMER null lassen — die werden später aus Web-Quellen ergänzt.

Wenn auf dem Foto KEIN Wein zu sehen ist, alle Felder null.`;

const SCHEMA_INSTRUCTION = `Antworte mit folgender JSON-Struktur:
{
  "name": "string | null (vollständiger Weinname, z.B. 'Riesling Trocken')",
  "vintage": "number | null (Jahrgang, 4-stellig)",
  "winery": "string | null (Weingut/Erzeuger)",
  "region": "string | null (Region/Anbaugebiet, z.B. 'Mosel', 'Bordeaux')",
  "country": "string | null (Land auf Deutsch)",
  "grape": "string | null (Rebsorte, z.B. 'Riesling', 'Cabernet Sauvignon')",
  "wineType": "'rot' | 'weiss' | 'rose' | 'schaumwein' | null",
  "description": "string | null (kurze Beschreibung des Weins, 1-2 Sätze, z.B. Stilrichtung/Charakter — nur wenn aus Quellen ableitbar)",
  "tastingNotes": "string | null (Verkostungsnotizen: Aroma, Geschmack, Abgang — nur wenn aus Quellen ableitbar)"
}`;

interface RawAnalysis {
  name?: string | null;
  vintage?: number | string | null;
  winery?: string | null;
  region?: string | null;
  country?: string | null;
  grape?: string | null;
  wineType?: string | null;
  description?: string | null;
  tastingNotes?: string | null;
}

@Injectable()
export class WineAnalyzerService {
  private readonly logger = new Logger(WineAnalyzerService.name);

  constructor(
    private readonly ollama: OllamaService,
    private readonly tavily: TavilyService,
  ) {}

  async analyze(images: string[]): Promise<WineAnalysisResult> {
    const intro =
      images.length > 1
        ? `Hier sind ${images.length} Fotos einer Weinflasche (Vorder- und Rückseite). Nutze BEIDE Bilder zur Identifikation — die Rückseite enthält oft Weingut, Land und weitere Details die vorne fehlen.`
        : `Hier ist ein Foto einer Weinflasche oder eines Wein-Etiketts. Lies das Etikett wortwörtlich.`;

    const prompt = `${intro}

Lies sorgfältig:
- Den großen Markennamen (vorne) → name
- "Wine of …", "Product of …", "Produit de …", "Republic of …" → country
- "Produced by", "Bottled by", "Mis en bouteille par", "Embotellado por", "Produced and bottled by" → winery
- ACHTUNG: "Imported by" / "Importeur" / "Distributed by" ist NIEMALS das Weingut — das ist der Importeur/Vertrieb. NICHT verwenden!
- Wenn Vorder- und Rückseite unterschiedliche Firmen nennen, nimm die unter "Produced/Bottled by", nicht die unter "Imported by".
- 4-stellige Jahreszahl auf dem Etikett (kein Lot-Code, kein Datum) → vintage
- Rebsorte (Merlot, Cabernet, Riesling, …) → grape

Setze Felder auf null wenn nicht klar lesbar. Erfinde NICHTS.

${SCHEMA_INSTRUCTION}`;

    const raw = await this.ollama.generate({
      model: this.ollama.visionModel,
      system: SYSTEM_PROMPT,
      prompt,
      images,
      format: 'json',
      tag: 'wine:stage1',
      stage: '1/2 Vision',
    });

    const parsed = this.ollama.parseJson<RawAnalysis>(raw);
    const stage1 = this.normalize(parsed);

    // Stage 2 nur wenn Stage 1 unvollständig war — sonst sparen wir 2-5 min CPU-Zeit.
    // Ausreichend = Name + Winery + Country + Grape + Description.
    const stage1Complete = !!(stage1.name && stage1.winery && stage1.country && stage1.grape && stage1.description);
    if (stage1Complete) {
      this.logger.log(`Stage 1 vollständig — Stage 2 übersprungen für ${stage1.name}`);
      stage1.needsReview = false;
      return stage1;
    }

    // Stage 2: Tavily-Suche zur Anreicherung + Cross-Check (nutzt Bilder erneut zum Gegenchecken)
    const enriched = await this.enrichWithSearch(stage1, images);

    // Confidence-Heuristik: needsReview wenn essenzielle Felder fehlen
    // oder Stage 2 nicht laufen konnte
    const essentialMissing = !enriched.name || !enriched.winery || !enriched.country || !enriched.grape;
    enriched.needsReview = essentialMissing;

    return enriched;
  }

  /**
   * Sucht im Web nach dem identifizierten Wein. Cross-checkt identifizierte Werte
   * gegen die Snippets und ergänzt fehlende Felder. Befüllt description/tastingNotes
   * ausschließlich aus Web-Quellen — niemals halluziniert vom Vision-Modell.
   * Gibt die Bilder ans Modell weiter, damit es Web-Vorschläge gegen das echte Etikett prüfen kann.
   */
  private async enrichWithSearch(wine: WineAnalysisResult, images: string[]): Promise<WineAnalysisResult> {
    if (!this.tavily.enabled) return wine;
    if (!wine.name && !wine.winery) return wine;

    const queryParts = [wine.winery, wine.name, wine.grape, wine.vintage?.toString()].filter(Boolean);
    if (queryParts.length === 0) return wine;
    const query = queryParts.join(' ');

    const snippets = await this.tavily.searchWine(query);
    if (!snippets) return wine;

    const knownJson = JSON.stringify({
      name: wine.name,
      vintage: wine.vintage,
      winery: wine.winery,
      region: wine.region,
      country: wine.country,
      grape: wine.grape,
      wineType: wine.wineType,
    }, null, 2);

    const enrichPrompt = `Hier sind Web-Such-Ergebnisse zu einem Wein:

${snippets}

Vom Etikett identifiziert (kann Fehler enthalten):
${knownJson}

STRENGE REGELN:
1. name (Markenname/Cuvée) und vintage NIEMALS überschreiben wenn vom Etikett vorhanden — übernimm 1:1.
2. winery/country/region/grape: nur ändern wenn die Web-Quellen den NEUEN Wert MEHRFACH und EINDEUTIG nennen. Bei Zweifel Etikett-Wert behalten.
3. Felder aus Web füllen NUR wenn der Wein-Name in der Quelle wörtlich vorkommt. Sonst null.
4. description/tastingNotes: NUR aus Web-Quellen die exakt diesen Wein beschreiben. Bei Zweifel null. Niemals erfinden, niemals aus generischen Sortenbeschreibungen ableiten.
5. "SAVOURY & RICH" o.ä. Geschmacksbezeichnungen sind KEIN Weingut.
6. Wenn Web-Quellen einen anderen Wein/Cuvée beschreiben als auf dem Etikett: ALLE description/tastingNotes verwerfen, null setzen.
7. Im Zweifel IMMER null statt Erfindung.

Antworte mit dem korrigierten vollständigen JSON-Objekt — alle Felder, auch unveränderte:

${SCHEMA_INSTRUCTION}`;

    try {
      const raw = await this.ollama.generate({
        model: this.ollama.textModel,
        system: SYSTEM_PROMPT,
        prompt: enrichPrompt,
        format: 'json',
        timeoutSec: 600,
        tag: 'wine:stage2',
        stage: '2/2 Anreichern',
      });
      const parsed = this.ollama.parseJson<RawAnalysis>(raw);
      const enriched = this.normalize(parsed);

      // name & vintage: Etikett hat Vorrang (steht klar lesbar drauf)
      // winery/region/country/grape/wineType: Web-Korrektur erlaubt
      // description/tastingNotes: ausschließlich aus Web
      return {
        name: wine.name ?? enriched.name,
        vintage: wine.vintage ?? enriched.vintage,
        winery: enriched.winery ?? wine.winery,
        region: enriched.region ?? wine.region,
        country: enriched.country ?? wine.country,
        grape: enriched.grape ?? wine.grape,
        wineType: enriched.wineType ?? wine.wineType,
        description: enriched.description,
        tastingNotes: enriched.tastingNotes,
        needsReview: false,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Wine enrichment failed: ${msg}`);
      return wine;
    }
  }

  private normalize(raw: RawAnalysis): WineAnalysisResult {
    return {
      name: this.toStr(raw.name),
      vintage: this.parseVintage(raw.vintage),
      winery: this.cleanWinery(this.toStr(raw.winery)),
      region: this.toStr(raw.region),
      country: this.toStr(raw.country),
      grape: this.toStr(raw.grape),
      wineType: this.toWineType(raw.wineType),
      description: this.toStr(raw.description),
      tastingNotes: this.toStr(raw.tastingNotes),
      needsReview: false,
    };
  }

  /** Filtert offensichtliche Geschmacksrichtungen oder Importeure aus dem Weingut-Feld. */
  private cleanWinery(winery: string | null): string | null {
    if (!winery) return null;
    const lower = winery.toLowerCase();
    const tasteDescriptors = [
      'savoury', 'savory', 'rich', 'smooth', 'fruity', 'sweet', 'dry', 'crisp',
      'bold', 'mellow', 'fresh', 'elegant', 'medium', 'light', 'full', 'bodied',
    ];
    // Wenn Weingut komplett aus Geschmacksdescriptoren besteht, verwerfen
    const tokens = lower.replace(/[&,]/g, ' ').split(/\s+/).filter(Boolean);
    const allDescriptors = tokens.every((t) => tasteDescriptors.includes(t));
    if (allDescriptors) return null;

    // Importeure / Distributoren sind kein Weingut
    const importerHints = [
      'imported by', 'importeur', 'imported', 'distributed by', 'distribution',
      'vertrieb', 'importé par', 'importer', 'superunie', 'ges.m.b.h. import',
    ];
    if (importerHints.some((h) => lower.includes(h))) return null;

    return winery;
  }

  private toStr(v: unknown): string | null {
    if (typeof v !== 'string') return null;
    const trimmed = v.trim();
    return trimmed.length > 0 && trimmed.toLowerCase() !== 'null' ? trimmed : null;
  }

  private parseVintage(v: unknown): number | null {
    if (typeof v === 'number' && v >= 1800 && v <= 2100) return Math.round(v);
    if (typeof v === 'string') {
      const m = v.match(/(\d{4})/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n >= 1800 && n <= 2100) return n;
      }
    }
    return null;
  }

  private toWineType(v: unknown): WineType | null {
    if (typeof v !== 'string') return null;
    const lower = v.trim().toLowerCase();
    if (lower === 'rot' || lower === 'red') return 'rot';
    if (lower === 'weiss' || lower === 'weiß' || lower === 'white') return 'weiss';
    if (lower === 'rose' || lower === 'rosé' || lower === 'rosé') return 'rose';
    if (lower === 'schaumwein' || lower === 'sekt' || lower === 'champagner' || lower === 'champagne' || lower === 'sparkling') return 'schaumwein';
    return null;
  }
}
