export interface RecipeIdea {
  id: string;
  title: string | null;
  note: string | null;
  imagePath: string | null;
  shareToken: string | null;
  sharedFrom: { email: string; displayName: string | null } | null;
  createdAt: string;
  updatedAt: string;
}
