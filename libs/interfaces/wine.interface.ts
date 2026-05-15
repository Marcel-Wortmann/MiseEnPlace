export type WineRating = 'schlecht' | 'okay' | 'gut' | 'sehr_gut';
export type WineType = 'rot' | 'weiss' | 'rose' | 'schaumwein';
export type WineAnalysisStatus = 'pending' | 'analyzed' | 'failed';

export interface Wine {
  id: string;
  imagePath: string;
  imagePathBack: string | null;
  rating: WineRating | null;
  notes: string | null;
  analysisStatus: WineAnalysisStatus;
  analysisError: string | null;

  name: string | null;
  vintage: number | null;
  region: string | null;
  country: string | null;
  grape: string | null;
  winery: string | null;
  wineType: WineType | null;
  description: string | null;
  tastingNotes: string | null;
  needsReview: boolean;

  shareToken: string | null;
  sharedFrom: { email: string; displayName: string | null } | null;

  createdAt: string;
  updatedAt: string;
}

export interface WineAnalysisResult {
  name: string | null;
  vintage: number | null;
  region: string | null;
  country: string | null;
  grape: string | null;
  winery: string | null;
  wineType: WineType | null;
  description: string | null;
  tastingNotes: string | null;
  needsReview: boolean;
}
