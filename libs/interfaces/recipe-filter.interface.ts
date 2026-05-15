import { Difficulty } from './recipe.interface';

export interface RecipeFilter {
  search: string | null;
  maxDurationMinutes: number | null;
  difficulty: Difficulty | null;
  minRating: number | null;
  tags: string[];
  favoritesOnly: boolean;
}

export const EMPTY_RECIPE_FILTER: RecipeFilter = {
  search: null,
  maxDurationMinutes: null,
  difficulty: null,
  minRating: null,
  tags: [],
  favoritesOnly: false,
};
