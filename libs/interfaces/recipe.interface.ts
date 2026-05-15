export type Difficulty = 'einfach' | 'mittel' | 'schwer';
export type RecipeAnalysisStatus = 'pending' | 'analyzed' | 'failed';

export interface RecipeIngredient {
  name: string;
  amount: number | null;
  unit: string | null;
}

export interface RecipeStep {
  order: number;
  text: string;
}

export interface Recipe {
  id: string;
  title: string;
  description: string | null;
  personalNotes: string | null;
  imagePath: string | null;
  durationMinutes: number | null;
  difficulty: Difficulty | null;
  rating: number | null;
  servings: number | null;
  caloriesPerServing: number | null;
  proteinPerServing: number | null;
  carbsPerServing: number | null;
  fatPerServing: number | null;
  isFavorite: boolean;
  isPrivate: boolean;
  isFollowed: boolean;
  tags: string[];
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
  analysisStatus: RecipeAnalysisStatus | null;
  analysisError: string | null;
  shareToken: string | null;
  sharedFrom: { email: string; displayName: string | null } | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Result from AI-driven extraction (image OCR, URL import).
 */
export interface ExtractedRecipeDraft {
  title: string | null;
  description: string | null;
  durationMinutes: number | null;
  difficulty: Difficulty | null;
  servings: number | null;
  caloriesPerServing: number | null;
  proteinPerServing: number | null;
  carbsPerServing: number | null;
  fatPerServing: number | null;
  tags: string[];
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
}

export interface CaloriesEstimate {
  caloriesPerServing: number;
  proteinPerServing: number | null;
  carbsPerServing: number | null;
  fatPerServing: number | null;
}
