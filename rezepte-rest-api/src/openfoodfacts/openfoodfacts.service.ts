import { BadGatewayException, Injectable, Logger, NotFoundException } from '@nestjs/common';

export interface OpenFoodFactsLookup {
  /** Produktname (Brand + Name) */
  name: string;
  /** Marke, falls separat angegeben */
  brand: string | null;
  /** kcal pro 100g */
  kcalPer100g: number | null;
  /** Protein g pro 100g */
  proteinPer100g: number | null;
  /** Kohlenhydrate g pro 100g */
  carbsPer100g: number | null;
  /** Fett g pro 100g */
  fatPer100g: number | null;
  /** Stück-Gewicht, falls aus Verpackung extrahierbar (z.B. "1 Riegel = 35g") */
  gramsPerPiece: number | null;
  /** Original-Barcode */
  barcode: string;
  /** URL zum Produkt auf openfoodfacts.org für Quellenangabe / weitere Infos */
  productUrl: string;
}

@Injectable()
export class OpenFoodFactsService {
  private readonly logger = new Logger(OpenFoodFactsService.name);
  private readonly BASE = 'https://world.openfoodfacts.org/api/v2/product';
  private readonly UA = 'Rezeptbuch/1.0 (self-hosted)';

  /**
   * Schlägt einen Barcode in der Open Food Facts Datenbank nach.
   *
   * Lizenz: Open Database License (ODbL) — Attribution nötig.
   * https://world.openfoodfacts.org/terms-of-use
   */
  async lookup(barcode: string): Promise<OpenFoodFactsLookup> {
    const cleaned = barcode.trim();
    if (!/^\d{8,14}$/.test(cleaned)) {
      throw new BadGatewayException('Barcode hat ungültiges Format (8–14 Ziffern erwartet).');
    }

    const url = `${this.BASE}/${cleaned}.json?fields=product_name,product_name_de,brands,nutriments,quantity,serving_quantity,product_quantity`;

    let data: any;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': this.UA,
        },
      });
      clearTimeout(timeout);
      if (!res.ok) {
        throw new BadGatewayException(`Open Food Facts antwortete mit HTTP ${res.status}.`);
      }
      data = await res.json();
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new BadGatewayException(`Open Food Facts nicht erreichbar: ${msg}`);
    }

    if (!data || data.status !== 1 || !data.product) {
      throw new NotFoundException('Barcode in Open Food Facts nicht gefunden.');
    }

    const p = data.product;
    const nutriments = p.nutriments ?? {};

    // kcal pro 100g — verschiedene Felder probieren
    let kcal: number | null = null;
    const kcalCandidates = [
      nutriments['energy-kcal_100g'],
      nutriments.energy_kcal_100g,
      nutriments['energy-kcal'],
    ];
    for (const c of kcalCandidates) {
      const n = this.parseNumber(c);
      if (n !== null && n > 0 && n < 1500) {
        kcal = Math.round(n);
        break;
      }
    }

    // Wenn kein kcal, aber kJ vorhanden → umrechnen (1 kcal ≈ 4.184 kJ)
    if (kcal === null) {
      const kjCandidates = [
        nutriments['energy-kj_100g'],
        nutriments.energy_kj_100g,
        nutriments.energy_100g,
      ];
      for (const c of kjCandidates) {
        const n = this.parseNumber(c);
        if (n !== null && n > 0 && n < 6500) {
          kcal = Math.round(n / 4.184);
          break;
        }
      }
    }

    // Name + Marke
    const namePart = (p.product_name_de || p.product_name || '').toString().trim();
    const brand = (p.brands || '').toString().split(',')[0]?.trim() || null;
    let name = namePart;
    if (brand && namePart && !namePart.toLowerCase().includes(brand.toLowerCase())) {
      name = `${namePart} (${brand})`;
    } else if (!namePart && brand) {
      name = brand;
    }
    if (!name) name = `Produkt ${cleaned}`;

    // Stück-Gewicht: serving_quantity (in Gramm) ist am verlässlichsten
    let gramsPerPiece: number | null = null;
    const sq = this.parseNumber(p.serving_quantity);
    if (sq !== null && sq > 0 && sq < 5000) {
      gramsPerPiece = Math.round(sq);
    } else {
      // Fallback: product_quantity (Gesamtgewicht der Packung) — nur wenn klein/Riegel-typisch
      const pq = this.parseNumber(p.product_quantity);
      if (pq !== null && pq > 0 && pq < 200) {
        gramsPerPiece = Math.round(pq);
      }
    }

    this.logger.log(`OFF-Lookup ${cleaned}: name="${name}", kcal=${kcal}, g/Stück=${gramsPerPiece}`);

    // Makros: Protein, Kohlenhydrate, Fett pro 100g
    const protein = this.extractNutrient(nutriments, ['proteins_100g']);
    const carbs = this.extractNutrient(nutriments, ['carbohydrates_100g']);
    const fat = this.extractNutrient(nutriments, ['fat_100g']);

    return {
      name,
      brand,
      kcalPer100g: kcal,
      proteinPer100g: protein,
      carbsPer100g: carbs,
      fatPer100g: fat,
      gramsPerPiece,
      barcode: cleaned,
      productUrl: `https://world.openfoodfacts.org/product/${cleaned}`,
    };
  }

  /** Holt einen Makro-Wert aus dem nutriments-Objekt; rundet auf 1 Nachkommastelle. */
  private extractNutrient(nutriments: any, keys: string[]): number | null {
    for (const key of keys) {
      const n = this.parseNumber(nutriments[key]);
      if (n !== null && n >= 0 && n < 200) {
        return Math.round(n * 10) / 10;
      }
    }
    return null;
  }

  private parseNumber(v: unknown): number | null {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const s = String(v).trim().replace(',', '.');
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
}
