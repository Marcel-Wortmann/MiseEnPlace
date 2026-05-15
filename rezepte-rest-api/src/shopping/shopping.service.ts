import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RecipesService } from '../recipes/recipes.service';
import { convertToGrams, normalizeUnit } from '../bls/unit-converter';
import {
  ShoppingListItem,
  CreateShoppingItemDto,
  UpdateShoppingItemDto,
  AddRecipeToShoppingListDto,
} from '@shared/interfaces/shopping.interface';

@Injectable()
export class ShoppingService {
  private readonly logger = new Logger(ShoppingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly recipesService: RecipesService,
  ) {}

  async list(userId: string): Promise<ShoppingListItem[]> {
    const rows = await this.prisma.shoppingListItem.findMany({
      where: { userId },
      orderBy: [{ done: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => this.toDomain(r));
  }

  async addManual(userId: string, dto: CreateShoppingItemDto): Promise<ShoppingListItem> {
    const row = await this.prisma.shoppingListItem.create({
      data: {
        userId,
        name: dto.name.trim(),
        amount: dto.amount ?? null,
        unit: dto.unit?.trim() || null,
      },
    });
    return this.toDomain(row);
  }

  async addRecipe(userId: string, dto: AddRecipeToShoppingListDto): Promise<ShoppingListItem[]> {
    const recipe = await this.recipesService.findOneForUser(dto.recipeId, userId);
    const baseServings = recipe.servings ?? 1;
    const targetServings = dto.servingsOverride ?? baseServings;
    const factor = baseServings > 0 ? targetServings / baseServings : 1;

    // Existing items über ALLE offenen Items matchen — Mehl aus Rezept A + Mehl aus Rezept B
    // landen als ein Eintrag mit summierter Menge.
    const existing = await this.prisma.shoppingListItem.findMany({
      where: { userId, done: false },
    });
    const byKey = new Map<string, typeof existing[number]>();
    for (const item of existing) {
      byKey.set(this.key(item.name, item.unit), item);
    }

    const created: ShoppingListItem[] = [];
    for (const ing of recipe.ingredients) {
      const scaledAmount = ing.amount !== null ? ing.amount * factor : null;
      const k = this.key(ing.name, ing.unit);
      const match = byKey.get(k);
      if (match) {
        const merged = this.mergeAmounts(
          { name: match.name, amount: match.amount, unit: match.unit },
          { name: ing.name, amount: scaledAmount, unit: ing.unit },
        );
        const updated = await this.prisma.shoppingListItem.update({
          where: { id: match.id },
          data: {
            amount: merged.amount,
            unit: merged.unit,
            // sourceRecipeTitle übernehmen wenn match keine Quelle hatte (manuell hinzugefügt)
            sourceRecipeTitle: match.sourceRecipeTitle ?? recipe.title,
            sourceRecipeId: match.sourceRecipeId ?? recipe.id,
          },
        });
        // In-Memory-Map aktualisieren, damit weitere Zutaten desselben Rezepts auch matchen
        byKey.set(k, updated);
        created.push(this.toDomain(updated));
      } else {
        const row = await this.prisma.shoppingListItem.create({
          data: {
            userId,
            name: ing.name,
            amount: scaledAmount,
            unit: ing.unit,
            sourceRecipeId: recipe.id,
            sourceRecipeTitle: recipe.title,
          },
        });
        byKey.set(k, row);
        created.push(this.toDomain(row));
      }
    }
    return created;
  }

  /** Sammelt alle Rezepte aus dem Wochenplan und addiert deren Zutaten zur Liste. */
  async addPlanWeek(userId: string, fromDate: string, toDate: string): Promise<ShoppingListItem[]> {
    const entries = await this.prisma.mealPlanEntry.findMany({
      where: {
        userId,
        date: { gte: new Date(fromDate), lte: new Date(toDate) },
        recipeId: { not: null },
      },
    });
    const recipeIds = Array.from(new Set(entries.map((e) => e.recipeId).filter((id): id is string => !!id)));
    const result: ShoppingListItem[] = [];
    for (const id of recipeIds) {
      try {
        const items = await this.addRecipe(userId, { recipeId: id });
        result.push(...items);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`addPlanWeek: Recipe ${id} übersprungen — ${msg}`);
      }
    }
    return result;
  }

  async update(id: string, userId: string, dto: UpdateShoppingItemDto): Promise<ShoppingListItem> {
    const existing = await this.prisma.shoppingListItem.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) {
      throw new NotFoundException(`Eintrag ${id} nicht gefunden`);
    }
    const row = await this.prisma.shoppingListItem.update({
      where: { id },
      data: {
        name: dto.name?.trim() ?? undefined,
        amount: dto.amount === undefined ? undefined : dto.amount,
        unit: dto.unit === undefined ? undefined : (dto.unit?.trim() || null),
        done: dto.done === undefined ? undefined : dto.done,
      },
    });
    return this.toDomain(row);
  }

  async remove(id: string, userId: string): Promise<void> {
    const existing = await this.prisma.shoppingListItem.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) {
      throw new NotFoundException(`Eintrag ${id} nicht gefunden`);
    }
    await this.prisma.shoppingListItem.delete({ where: { id } });
  }

  async clearDone(userId: string): Promise<void> {
    await this.prisma.shoppingListItem.deleteMany({ where: { userId, done: true } });
  }

  async clearAll(userId: string): Promise<void> {
    await this.prisma.shoppingListItem.deleteMany({ where: { userId } });
  }

  /**
   * Key für Einheiten-Familien. Masse: g/kg → "mass"; Volumen: ml/l → "volume";
   * andere normalisierte Einheiten bleiben einzeln; unknown/null → leerer String.
   */
  private key(name: string, unit: string | null): string {
    const cleanName = name.trim().toLowerCase();
    const u = normalizeUnit(unit);
    let family: string;
    if (u === 'g' || u === 'kg') family = 'mass';
    else if (u === 'ml' || u === 'l') family = 'volume';
    else family = u;
    return `${cleanName}|${family}`;
  }

  /**
   * Zwei Einträge derselben Zutat zusammenfassen.
   * Gleiche Einheit: direkt addieren. Masse/Volumen-Familie: konvertieren und ggf. hochskalieren.
   * Heterogene Einheiten: über convertToGrams versuchen. Sonst: Existing behalten.
   */
  private mergeAmounts(
    a: { name: string; amount: number | null; unit: string | null },
    b: { name: string; amount: number | null; unit: string | null },
  ): { amount: number | null; unit: string | null } {
    if (a.amount === null) return { amount: b.amount, unit: b.unit };
    if (b.amount === null) return { amount: a.amount, unit: a.unit };

    const aUnit = normalizeUnit(a.unit);
    const bUnit = normalizeUnit(b.unit);

    if (aUnit === bUnit && aUnit !== 'unknown') {
      return { amount: a.amount + b.amount, unit: a.unit };
    }

    if ((aUnit === 'g' || aUnit === 'kg') && (bUnit === 'g' || bUnit === 'kg')) {
      const aGrams = aUnit === 'kg' ? a.amount * 1000 : a.amount;
      const bGrams = bUnit === 'kg' ? b.amount * 1000 : b.amount;
      const total = aGrams + bGrams;
      if (total >= 1000) return { amount: total / 1000, unit: 'kg' };
      return { amount: total, unit: 'g' };
    }

    if ((aUnit === 'ml' || aUnit === 'l') && (bUnit === 'ml' || bUnit === 'l')) {
      const aMl = aUnit === 'l' ? a.amount * 1000 : a.amount;
      const bMl = bUnit === 'l' ? b.amount * 1000 : b.amount;
      const total = aMl + bMl;
      if (total >= 1000) return { amount: total / 1000, unit: 'l' };
      return { amount: total, unit: 'ml' };
    }

    const aResult = convertToGrams(a.amount, a.unit, a.name);
    const bResult = convertToGrams(b.amount, b.unit, b.name);
    if (aResult && bResult && aResult.confidence >= 0.7 && bResult.confidence >= 0.7) {
      const total = aResult.grams + bResult.grams;
      if (total >= 1000) return { amount: total / 1000, unit: 'kg' };
      return { amount: total, unit: 'g' };
    }

    this.logger.debug(`mergeAmounts: unklar (${a.amount}${a.unit} + ${b.amount}${b.unit} ${a.name}) — behalte Existing`);
    return { amount: a.amount, unit: a.unit };
  }

  private toDomain(row: {
    id: string;
    name: string;
    amount: number | null;
    unit: string | null;
    sourceRecipeId: string | null;
    sourceRecipeTitle: string | null;
    done: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): ShoppingListItem {
    return {
      id: row.id,
      name: row.name,
      amount: row.amount,
      unit: row.unit,
      sourceRecipeId: row.sourceRecipeId,
      sourceRecipeTitle: row.sourceRecipeTitle,
      done: row.done,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
