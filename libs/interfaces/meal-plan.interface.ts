export type MealSlot = 'fruehstueck' | 'mittag' | 'abend';

export const MEAL_SLOTS: MealSlot[] = ['fruehstueck', 'mittag', 'abend'];

export const MEAL_SLOT_LABELS: Record<MealSlot, string> = {
  fruehstueck: 'Frühstück',
  mittag: 'Mittag',
  abend: 'Abend',
};

export interface MealPlanEntry {
  id: string;
  date: string; // ISO date YYYY-MM-DD
  slot: MealSlot;
  recipeId: string | null;
  recipeTitle: string | null;
  recipeImagePath: string | null;
  customText: string | null;
  /** Pro-Portion-Werte des verlinkten Rezepts (sofern vorhanden) */
  caloriesPerServing: number | null;
  proteinPerServing: number | null;
  carbsPerServing: number | null;
  fatPerServing: number | null;
}

/** Aggregierte Tagesnährwerte für einen Plan-Tag */
export interface DayNutrition {
  date: string;
  totals: { kcal: number; protein: number; carbs: number; fat: number };
  bySlot: Record<MealSlot, { kcal: number; protein: number; carbs: number; fat: number }>;
}

export interface UpsertMealPlanPayload {
  date: string;
  slot: MealSlot;
  recipeId?: string | null;
  customText?: string | null;
}
