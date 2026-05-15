/**
 * Marker fields added to entities returned through "/shared-with-me" endpoints
 * (so the frontend can render them as cards with a "shared" badge).
 */
export interface SharedMeta {
  sharedByEmail: string;
  sharedByDisplayName: string | null;
  sharedAt: string;
}

export interface ShareInfo {
  shareToken: string | null;
  sharedWith: { userId: string; email: string; displayName: string | null }[];
}
