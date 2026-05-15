export type RestaurantRating = 'schlecht' | 'okay' | 'gut' | 'sehr_gut';

export interface Restaurant {
  id: string;
  userId: string;
  name: string;
  cuisine: string | null;
  rating: RestaurantRating | null;
  priceLevel: number | null;
  imagePath: string | null;
  notes: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateRestaurantPayload {
  name: string;
  cuisine?: string | null;
  rating?: RestaurantRating | null;
  priceLevel?: number | null;
  imagePath?: string | null;
  notes?: string | null;
  tags?: string[];
}

export type UpdateRestaurantPayload = Partial<CreateRestaurantPayload>;

export interface RestaurantFilter {
  rating: RestaurantRating | null;
  cuisine: string | null;
}
