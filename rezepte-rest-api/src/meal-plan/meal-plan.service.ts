import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DayNutrition, MealPlanEntry, MealSlot, UpsertMealPlanPayload } from '@shared/interfaces/meal-plan.interface';

@Injectable()
export class MealPlanService {
  constructor(private readonly prisma: PrismaService) {}

  async findRange(userId: string, fromDate: string, toDate: string): Promise<MealPlanEntry[]> {
    const rows = await this.prisma.mealPlanEntry.findMany({
      where: {
        userId,
        date: { gte: new Date(fromDate), lte: new Date(toDate) },
      },
      include: {
        recipe: {
          select: {
            title: true,
            imagePath: true,
            caloriesPerServing: true,
            proteinPerServing: true,
            carbsPerServing: true,
            fatPerServing: true,
          },
        },
      },
      orderBy: [{ date: 'asc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      date: r.date.toISOString().slice(0, 10),
      slot: r.slot as MealSlot,
      recipeId: r.recipeId,
      recipeTitle: r.recipe?.title ?? null,
      recipeImagePath: r.recipe?.imagePath ?? null,
      customText: r.customText,
      caloriesPerServing: r.recipe?.caloriesPerServing ?? null,
      proteinPerServing: r.recipe?.proteinPerServing ?? null,
      carbsPerServing: r.recipe?.carbsPerServing ?? null,
      fatPerServing: r.recipe?.fatPerServing ?? null,
    }));
  }

  /**
   * Aggregiert Nährwerte pro Tag und Tagesabschnitt für den angegebenen Range.
   * Tage ohne Plan-Einträge erscheinen nicht — Frontend ergänzt 0-Defaults.
   */
  async aggregateNutrition(userId: string, fromDate: string, toDate: string): Promise<DayNutrition[]> {
    const entries = await this.findRange(userId, fromDate, toDate);
    const byDate = new Map<string, DayNutrition>();
    for (const e of entries) {
      let day = byDate.get(e.date);
      if (!day) {
        day = {
          date: e.date,
          totals: { kcal: 0, protein: 0, carbs: 0, fat: 0 },
          bySlot: {
            fruehstueck: { kcal: 0, protein: 0, carbs: 0, fat: 0 },
            mittag: { kcal: 0, protein: 0, carbs: 0, fat: 0 },
            abend: { kcal: 0, protein: 0, carbs: 0, fat: 0 },
          },
        };
        byDate.set(e.date, day);
      }
      const slot = day.bySlot[e.slot];
      slot.kcal += e.caloriesPerServing ?? 0;
      slot.protein += e.proteinPerServing ?? 0;
      slot.carbs += e.carbsPerServing ?? 0;
      slot.fat += e.fatPerServing ?? 0;
      day.totals.kcal += e.caloriesPerServing ?? 0;
      day.totals.protein += e.proteinPerServing ?? 0;
      day.totals.carbs += e.carbsPerServing ?? 0;
      day.totals.fat += e.fatPerServing ?? 0;
    }
    // Werte runden auf 1 Nachkomma
    const round = (n: number) => Math.round(n * 10) / 10;
    return Array.from(byDate.values()).map((d) => ({
      date: d.date,
      totals: {
        kcal: Math.round(d.totals.kcal),
        protein: round(d.totals.protein),
        carbs: round(d.totals.carbs),
        fat: round(d.totals.fat),
      },
      bySlot: {
        fruehstueck: {
          kcal: Math.round(d.bySlot.fruehstueck.kcal),
          protein: round(d.bySlot.fruehstueck.protein),
          carbs: round(d.bySlot.fruehstueck.carbs),
          fat: round(d.bySlot.fruehstueck.fat),
        },
        mittag: {
          kcal: Math.round(d.bySlot.mittag.kcal),
          protein: round(d.bySlot.mittag.protein),
          carbs: round(d.bySlot.mittag.carbs),
          fat: round(d.bySlot.mittag.fat),
        },
        abend: {
          kcal: Math.round(d.bySlot.abend.kcal),
          protein: round(d.bySlot.abend.protein),
          carbs: round(d.bySlot.abend.carbs),
          fat: round(d.bySlot.abend.fat),
        },
      },
    }));
  }

  async upsert(userId: string, dto: UpsertMealPlanPayload): Promise<MealPlanEntry> {
    const date = new Date(dto.date);
    const recipeId = dto.recipeId ?? null;
    const customText = dto.customText ?? null;

    // If both are null, treat as delete
    if (!recipeId && !customText) {
      await this.prisma.mealPlanEntry.deleteMany({
        where: { userId, date, slot: dto.slot },
      });
      return {
        id: '', date: dto.date, slot: dto.slot,
        recipeId: null, recipeTitle: null, recipeImagePath: null, customText: null,
        caloriesPerServing: null, proteinPerServing: null, carbsPerServing: null, fatPerServing: null,
      };
    }

    const row = await this.prisma.mealPlanEntry.upsert({
      where: { userId_date_slot: { userId, date, slot: dto.slot } },
      create: { userId, date, slot: dto.slot, recipeId, customText },
      update: { recipeId, customText },
      include: {
        recipe: {
          select: {
            title: true,
            imagePath: true,
            caloriesPerServing: true,
            proteinPerServing: true,
            carbsPerServing: true,
            fatPerServing: true,
          },
        },
      },
    });
    return {
      id: row.id,
      date: row.date.toISOString().slice(0, 10),
      slot: row.slot as MealSlot,
      recipeId: row.recipeId,
      recipeTitle: row.recipe?.title ?? null,
      recipeImagePath: row.recipe?.imagePath ?? null,
      customText: row.customText,
      caloriesPerServing: row.recipe?.caloriesPerServing ?? null,
      proteinPerServing: row.recipe?.proteinPerServing ?? null,
      carbsPerServing: row.recipe?.carbsPerServing ?? null,
      fatPerServing: row.recipe?.fatPerServing ?? null,
    };
  }
}
