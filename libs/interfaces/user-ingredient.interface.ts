export interface UserIngredient {
  id: string;
  name: string;
  aliases: string[];
  kcalPer100g: number;
  proteinPer100g: number | null;
  carbsPer100g: number | null;
  fatPer100g: number | null;
  defaultGramsPerPiece: number | null;
  createdAt: string;
  updatedAt: string;
}
