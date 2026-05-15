export interface ShoppingListItem {
  id: string;
  name: string;
  amount: number | null;
  unit: string | null;
  sourceRecipeId: string | null;
  sourceRecipeTitle: string | null;
  done: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AddRecipeToShoppingListDto {
  recipeId: string;
  servingsOverride?: number | null;
}

export interface CreateShoppingItemDto {
  name: string;
  amount?: number | null;
  unit?: string | null;
}

export interface UpdateShoppingItemDto {
  name?: string;
  amount?: number | null;
  unit?: string | null;
  done?: boolean;
}
