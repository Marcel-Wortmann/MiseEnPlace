export interface PublicUser {
  id: string;
  email: string;
  username: string | null;
  displayName: string | null;
  followerCount: number;
  publicRecipeCount: number;
  isFollowing: boolean;
}
