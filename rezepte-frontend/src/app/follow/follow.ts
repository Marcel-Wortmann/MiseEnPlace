import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FollowStore } from '../store/Follow/Follow.store';
import { PublicUser, Recipe } from '@shared/interfaces';
import { environment } from '../../environments/environment';

@Component({
  selector: 'app-follow',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './follow.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FollowComponent implements OnInit {
  store = inject(FollowStore);
  private route = inject(ActivatedRoute);

  searchQuery = signal('');
  view = signal<'feed' | 'manage'>('feed');

  feedSearch = signal('');
  feedUserId = signal<string | null>(null);
  feedTag = signal<string | null>(null);

  filteredFeed = computed<Recipe[]>(() => {
    const q = this.feedSearch().trim().toLowerCase();
    const userId = this.feedUserId();
    const tag = this.feedTag();
    return this.store.feed().filter((r) => {
      if (userId && r.sharedFrom) {
        // sharedFrom hat email, wir matchen by email - feedUserId ist user.id, brauchen mapping
      }
      if (userId && this.feedUserEmailById().get(userId) !== r.sharedFrom?.email) return false;
      if (tag && !(r.tags ?? []).includes(tag)) return false;
      if (q) {
        const hay = `${r.title} ${r.description ?? ''} ${(r.tags ?? []).join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  });

  feedUserEmailById = computed(() => {
    const map = new Map<string, string>();
    for (const u of this.store.following()) map.set(u.id, u.email);
    return map;
  });

  feedTags = computed<string[]>(() => {
    const set = new Set<string>();
    for (const r of this.store.feed()) for (const t of (r.tags ?? [])) set.add(t);
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'de'));
  });

  ngOnInit(): void {
    this.store.loadFollowing();
    this.store.loadFeed();

    // ?user=ID -> Filter setzen
    this.route.queryParamMap.subscribe((params) => {
      const u = params.get('user');
      if (u) {
        this.feedUserId.set(u);
        this.view.set('feed');
      }
    });
  }

  imageUrl(path: string | null): string | null {
    if (!path) return null;
    if (path.startsWith("http")) return path;
    return `${environment.apiBaseUrl}${path}?w=480`;
  }

  userInitial(u: PublicUser): string {
    return (u.displayName || u.username || u.email).charAt(0).toUpperCase();
  }

  onSearchInput(value: string): void {
    this.searchQuery.set(value);
    this.store.search(value);
  }

  clearSearch(): void {
    this.searchQuery.set('');
    this.store.clearSearch();
  }

  toggleRecipeFollow(recipe: { id: string; isFollowed: boolean }): void {
    if (recipe.isFollowed) this.store.unfollowRecipe(recipe.id);
    else this.store.followRecipe(recipe.id);
  }

  filterByUser(user: PublicUser): void {
    this.feedUserId.set(user.id);
    this.feedSearch.set('');
    this.feedTag.set(null);
    this.view.set('feed');
  }

  isNew(createdAt: string): boolean {
    const week = 7 * 24 * 60 * 60 * 1000;
    return Date.now() - new Date(createdAt).getTime() < week;
  }

  selectedUserName(): string | null {
    const id = this.feedUserId();
    if (!id) return null;
    const u = this.store.following().find((f) => f.id === id);
    return u ? (u.displayName ?? u.username ?? u.email) : null;
  }

  clearFeedFilters(): void {
    this.feedSearch.set('');
    this.feedUserId.set(null);
    this.feedTag.set(null);
  }

  hasFeedFilter(): boolean {
    return !!(this.feedSearch() || this.feedUserId() || this.feedTag());
  }
}
