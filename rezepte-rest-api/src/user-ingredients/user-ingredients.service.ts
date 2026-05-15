import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserIngredientDto } from './dto/create-user-ingredient.dto';
import { UpdateUserIngredientDto } from './dto/update-user-ingredient.dto';
import { UserIngredient } from '@shared/interfaces/user-ingredient.interface';

export interface UserIngredientMatch {
  id: string;
  name: string;
  kcalPer100g: number;
  proteinPer100g: number | null;
  carbsPer100g: number | null;
  fatPer100g: number | null;
  defaultGramsPerPiece: number | null;
  score: number;
  matchedTerm: string;
}

@Injectable()
export class UserIngredientsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllForUser(userId: string): Promise<UserIngredient[]> {
    const rows = await this.prisma.userIngredient.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
    });
    return rows.map((r) => this.toDomain(r));
  }

  async create(userId: string, dto: CreateUserIngredientDto): Promise<UserIngredient> {
    const row = await this.prisma.userIngredient.create({
      data: {
        userId,
        name: dto.name.trim(),
        aliases: this.cleanAliases(dto.aliases),
        kcalPer100g: dto.kcalPer100g,
        proteinPer100g: dto.proteinPer100g ?? null,
        carbsPer100g: dto.carbsPer100g ?? null,
        fatPer100g: dto.fatPer100g ?? null,
        defaultGramsPerPiece: dto.defaultGramsPerPiece ?? null,
      },
    });
    return this.toDomain(row);
  }

  async update(id: string, userId: string, dto: UpdateUserIngredientDto): Promise<UserIngredient> {
    const existing = await this.prisma.userIngredient.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) {
      throw new NotFoundException('Zutat nicht gefunden');
    }
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.aliases !== undefined) data.aliases = this.cleanAliases(dto.aliases);
    if (dto.kcalPer100g !== undefined) data.kcalPer100g = dto.kcalPer100g;
    if (dto.proteinPer100g !== undefined) data.proteinPer100g = dto.proteinPer100g;
    if (dto.carbsPer100g !== undefined) data.carbsPer100g = dto.carbsPer100g;
    if (dto.fatPer100g !== undefined) data.fatPer100g = dto.fatPer100g;
    if (dto.defaultGramsPerPiece !== undefined) data.defaultGramsPerPiece = dto.defaultGramsPerPiece;
    const row = await this.prisma.userIngredient.update({ where: { id }, data });
    return this.toDomain(row);
  }

  async remove(id: string, userId: string): Promise<void> {
    const existing = await this.prisma.userIngredient.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) {
      throw new NotFoundException('Zutat nicht gefunden');
    }
    await this.prisma.userIngredient.delete({ where: { id } });
  }

  /**
   * Match-Funktion für den CalorieEstimator: prüft ob im Rezept-Zutat-Namen
   * einer der vom User definierten Begriffe (name oder aliases) als
   * EIGENSTÄNDIGES WORT vorkommt — d.h. mit Wort-Grenzen vorne und hinten.
   *
   * Beispiele für User-Zutat "Butter":
   *   "100g Butter"        → MATCH ("Butter" ist eigenes Wort)
   *   "Butter, weich"      → MATCH (Komma ist Wort-Grenze)
   *   "Butter-Schmalz"     → MATCH (Bindestrich ist Wort-Grenze)
   *   "Buttermilch"        → KEIN MATCH (kein Wort-Ende nach "Butter")
   *   "Erdnussbutter"      → KEIN MATCH (kein Wort-Anfang vor "butter")
   *
   * Bei mehreren Treffern gewinnt der mit dem längsten Match-Begriff.
   */
  async matchForRecipe(userId: string, recipeIngredientName: string): Promise<UserIngredientMatch | null> {
    const rows = await this.prisma.userIngredient.findMany({ where: { userId } });
    if (rows.length === 0) return null;
    return this.matchAgainst(rows, recipeIngredientName);
  }

  /**
   * Batch-Variante: lädt alle UserIngredients EINMAL und matcht gegen N Rezeptzutaten.
   * Spart N-1 Datenbankabfragen wenn der CalorieEstimator alle Zutaten eines Rezepts
   * auf einmal verarbeitet.
   */
  async matchManyForRecipe(
    userId: string,
    recipeIngredientNames: string[],
  ): Promise<(UserIngredientMatch | null)[]> {
    const rows = await this.prisma.userIngredient.findMany({ where: { userId } });
    if (rows.length === 0) return recipeIngredientNames.map(() => null);
    return recipeIngredientNames.map((name) => this.matchAgainst(rows, name));
  }

  private matchAgainst(
    rows: Array<{
      id: string;
      name: string;
      aliases: string[];
      kcalPer100g: number;
      proteinPer100g: number | null;
      carbsPer100g: number | null;
      fatPer100g: number | null;
      defaultGramsPerPiece: number | null;
    }>,
    recipeIngredientName: string,
  ): UserIngredientMatch | null {
    const haystack = recipeIngredientName.toLowerCase();
    let best: { row: typeof rows[number]; matchedTerm: string } | null = null;

    for (const row of rows) {
      const candidates = [row.name, ...row.aliases]
        .map((s) => s.toLowerCase().trim())
        .filter((s) => s.length >= 2);
      for (const term of candidates) {
        if (this.isWholeWordMatch(haystack, term)) {
          if (!best || term.length > best.matchedTerm.length) {
            best = { row, matchedTerm: term };
          }
        }
      }
    }

    if (!best) return null;

    return {
      id: best.row.id,
      name: best.row.name,
      kcalPer100g: best.row.kcalPer100g,
      proteinPer100g: best.row.proteinPer100g,
      carbsPer100g: best.row.carbsPer100g,
      fatPer100g: best.row.fatPer100g,
      defaultGramsPerPiece: best.row.defaultGramsPerPiece,
      score: 1.0,
      matchedTerm: best.matchedTerm,
    };
  }

  private isWholeWordMatch(haystack: string, term: string): boolean {
    let from = 0;
    while (from <= haystack.length - term.length) {
      const idx = haystack.indexOf(term, from);
      if (idx === -1) return false;
      const before = idx === 0 ? '' : haystack[idx - 1];
      const after = idx + term.length >= haystack.length ? '' : haystack[idx + term.length];
      if (!this.isWordChar(before) && !this.isWordChar(after)) {
        return true;
      }
      from = idx + 1;
    }
    return false;
  }

  private isWordChar(ch: string): boolean {
    if (!ch) return false;
    return /[a-zäöüß0-9]/i.test(ch);
  }

  private cleanAliases(aliases: string[] | undefined): string[] {
    if (!aliases) return [];
    return aliases
      .map((a) => a.trim())
      .filter((a) => a.length >= 2)
      .slice(0, 20);
  }

  private toDomain(row: {
    id: string;
    name: string;
    aliases: string[];
    kcalPer100g: number;
    proteinPer100g: number | null;
    carbsPer100g: number | null;
    fatPer100g: number | null;
    defaultGramsPerPiece: number | null;
    createdAt: Date;
    updatedAt: Date;
  }): UserIngredient {
    return {
      id: row.id,
      name: row.name,
      aliases: row.aliases,
      kcalPer100g: row.kcalPer100g,
      proteinPer100g: row.proteinPer100g,
      carbsPer100g: row.carbsPer100g,
      fatPer100g: row.fatPer100g,
      defaultGramsPerPiece: row.defaultGramsPerPiece,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
