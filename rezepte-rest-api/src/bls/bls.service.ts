import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface BlsHit {
  code: string;
  name: string;
  kcalPer100g: number;
  proteinPer100g: number | null;
  carbsPer100g: number | null;
  fatPer100g: number | null;
  fiberPer100g: number | null;
  /** Score 0..1 — höher = besser passend */
  score: number;
}

/**
 * Diakritika entfernen, lowercase, sonderzeichen weg → "Möhre, gegart" → "moehre gegart"
 */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Synonym-Map: User-Begriff → BLS-Begriff. Erhöht Trefferquote bei alltagstypischen Schreibweisen. */
const SYNONYMS: Record<string, string> = {
  'haehnchenbrust': 'huhn brust',
  'haehnchen': 'huhn',
  'pute': 'truthahn',
  'rinderhack': 'rindfleisch hackfleisch',
  'hack': 'hackfleisch',
  'gehacktes': 'hackfleisch',
  'mehl': 'weizenmehl',
  'olivenoel': 'olivenoel',
  'rapsoel': 'rapsoel',
  'sonnenblumenoel': 'sonnenblumenoel',
  'sahne': 'schlagsahne',
  'creme fraiche': 'creme fraiche',
  'frischkaese': 'frischkaese',
  'parmesan': 'parmesan',
  'mozzarella': 'mozzarella',
  'feta': 'schafskaese',
  'tomatenmark': 'tomatenmark',
  'kartoffel': 'kartoffel',
  'moehre': 'karotte',
  'karotte': 'karotte',
  'zwiebel': 'zwiebel',
  'knoblauch': 'knoblauch',
  'paprika': 'paprika',
  'reis': 'reis',
  'nudel': 'teigwaren',
  'pasta': 'teigwaren',
  'spaghetti': 'teigwaren',
  'penne': 'teigwaren',
  'butter': 'butter',
  'ei': 'huehnerei',
  'eier': 'huehnerei',
  'milch': 'kuhmilch',
  'joghurt': 'joghurt',
  'quark': 'speisequark',
  'lachs': 'lachs',
  'thunfisch': 'thunfisch',
  'zucker': 'zucker',
  'salz': 'speisesalz',
};

@Injectable()
export class BlsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Sucht die ähnlichsten BLS-Einträge zum gegebenen Zutat-Namen.
   * Score-Boost: bevorzugt "rohe" Grundzutaten gegenüber zubereiteten Varianten.
   */
  async search(query: string, limit = 5): Promise<BlsHit[]> {
    const normalized = normalize(query);
    if (!normalized || normalized.length < 2) return [];

    // Synonym-Expansion: User-Begriff durch BLS-Begriff ersetzen wenn Treffer
    const expanded = SYNONYMS[normalized] ?? normalized;
    const tokens = expanded.split(' ').filter((t) => t.length >= 2);
    if (tokens.length === 0) return [];

    const primary = tokens[0];
    const candidates = await this.prisma.bls.findMany({
      where: { searchKey: { contains: primary } },
      take: 200,
    });

    if (candidates.length === 0) {
      const broad = await this.prisma.bls.findMany({
        where: { name: { contains: tokens[0], mode: 'insensitive' } },
        take: 50,
      });
      return broad.slice(0, limit).map((c) => ({
        code: c.code,
        name: c.name,
        kcalPer100g: c.kcalPer100g,
        proteinPer100g: c.proteinPer100g,
        carbsPer100g: c.carbsPer100g,
        fatPer100g: c.fatPer100g,
        fiberPer100g: c.fiberPer100g,
        score: 0.4,
      }));
    }

    const scored = candidates.map((c) => {
      const candidateTokens = c.searchKey.split(' ');
      let matchCount = 0;
      for (const t of tokens) {
        if (candidateTokens.some((ct) => ct.includes(t) || t.includes(ct))) matchCount++;
      }
      // Bonus wenn Kandidat KURZ ist (=> spezifisch wie "Tomate, frisch" statt "Tomatensauce mit Hackfleisch nach Bologneser Art")
      const lengthPenalty = Math.min(1, 30 / candidateTokens.join(' ').length);
      // Bonus für rohe Grundzutaten — wir wollen "Tomate, roh" statt "Tomate, getrocknet, in Öl"
      const rawBonus = /\b(roh|frisch)\b/.test(c.searchKey) ? 0.1 : 0;
      // Penalty für Konserven / Fertigprodukte — bei Standardzutaten meist nicht gemeint
      const processedPenalty = /\b(konserve|tiefgefroren|in oel|geraeuchert|gepoekelt|mariniert)\b/.test(c.searchKey) ? -0.15 : 0;
      const score = (matchCount / tokens.length) * 0.7 + lengthPenalty * 0.3 + rawBonus + processedPenalty;
      return { c, score };
    });

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, limit).map(({ c, score }) => ({
      code: c.code,
      name: c.name,
      kcalPer100g: c.kcalPer100g,
      proteinPer100g: c.proteinPer100g,
      carbsPer100g: c.carbsPer100g,
      fatPer100g: c.fatPer100g,
      fiberPer100g: c.fiberPer100g,
      score: Math.max(0, Math.min(1, score)),
    }));
  }

  async findByCode(code: string): Promise<BlsHit | null> {
    const row = await this.prisma.bls.findUnique({ where: { code } });
    if (!row) return null;
    return {
      code: row.code,
      name: row.name,
      kcalPer100g: row.kcalPer100g,
      proteinPer100g: row.proteinPer100g,
      carbsPer100g: row.carbsPer100g,
      fatPer100g: row.fatPer100g,
      fiberPer100g: row.fiberPer100g,
      score: 1.0,
    };
  }

  async count(): Promise<number> {
    return this.prisma.bls.count();
  }
}
