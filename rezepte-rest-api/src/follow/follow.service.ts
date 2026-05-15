import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Recipe } from '@shared/interfaces';
import { RecipesService } from '../recipes/recipes.service';

export interface PublicUser {
  id: string;
  email: string;
  username: string | null;
  displayName: string | null;
  followerCount: number;
  publicRecipeCount: number;
  isFollowing: boolean;
}

@Injectable()
export class FollowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recipesService: RecipesService,
  ) {}

  async searchByEmail(currentUserId: string, query: string): Promise<PublicUser[]> {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const users = await this.prisma.user.findMany({
      where: {
        OR: [
          { email: { contains: q, mode: 'insensitive' } },
          { username: { contains: q, mode: 'insensitive' } },
        ],
        id: { not: currentUserId },
      },
      take: 20,
      orderBy: { email: 'asc' },
    });
    return this.toPublicBatch(currentUserId, users);
  }

  async listFollowing(currentUserId: string): Promise<PublicUser[]> {
    const follows = await this.prisma.follow.findMany({
      where: { followerId: currentUserId },
      include: { following: true },
      orderBy: { createdAt: 'desc' },
    });
    return this.toPublicBatch(currentUserId, follows.map((f) => f.following));
  }

  async follow(currentUserId: string, targetId: string): Promise<void> {
    if (currentUserId === targetId) throw new BadRequestException('Selbstfolgen nicht erlaubt');
    const target = await this.prisma.user.findUnique({ where: { id: targetId } });
    if (!target) throw new NotFoundException('User nicht gefunden');
    await this.prisma.follow.upsert({
      where: { followerId_followingId: { followerId: currentUserId, followingId: targetId } },
      create: { followerId: currentUserId, followingId: targetId },
      update: {},
    });
  }

  async unfollow(currentUserId: string, targetId: string): Promise<void> {
    await this.prisma.follow.deleteMany({
      where: { followerId: currentUserId, followingId: targetId },
    });
  }

  /** Öffentliche Rezepte aller gefolgten Personen */
  async feed(currentUserId: string): Promise<Recipe[]> {
    const follows = await this.prisma.follow.findMany({
      where: { followerId: currentUserId },
      select: { followingId: true },
    });
    const ids = follows.map((f) => f.followingId);
    if (ids.length === 0) return [];

    const rows = await this.prisma.recipe.findMany({
      where: { userId: { in: ids }, isPrivate: false },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { email: true, displayName: true } } },
      take: 200,
    });
    return rows.map((r) =>
      this.recipesService.rowToDomain(r, { email: r.user.email, displayName: r.user.displayName }),
    );
  }

  async followRecipe(currentUserId: string, recipeId: string): Promise<void> {
    const recipe = await this.prisma.recipe.findUnique({ where: { id: recipeId } });
    if (!recipe) throw new NotFoundException('Rezept nicht gefunden');
    if (recipe.userId === currentUserId) throw new BadRequestException('Eigenes Rezept kann nicht gefolgt werden');
    if (recipe.isPrivate) throw new BadRequestException('Privates Rezept');
    await this.prisma.recipeFollow.upsert({
      where: { userId_recipeId: { userId: currentUserId, recipeId } },
      create: { userId: currentUserId, recipeId },
      update: {},
    });
  }

  async unfollowRecipe(currentUserId: string, recipeId: string): Promise<void> {
    await this.prisma.recipeFollow.deleteMany({
      where: { userId: currentUserId, recipeId },
    });
  }

  /**
   * Batch-Variante: aggregiert followerCount, publicRecipeCount, isFollowing
   * für mehrere User in nur 3 Queries (statt 3 × N).
   */
  private async toPublicBatch(
    currentUserId: string,
    users: { id: string; email: string; username: string | null; displayName: string | null }[],
  ): Promise<PublicUser[]> {
    if (users.length === 0) return [];
    const ids = users.map((u) => u.id);

    const [followerCounts, recipeCounts, myFollows] = await Promise.all([
      this.prisma.follow.groupBy({
        by: ['followingId'],
        where: { followingId: { in: ids } },
        _count: { followingId: true },
      }),
      this.prisma.recipe.groupBy({
        by: ['userId'],
        where: { userId: { in: ids }, isPrivate: false },
        _count: { userId: true },
      }),
      this.prisma.follow.findMany({
        where: { followerId: currentUserId, followingId: { in: ids } },
        select: { followingId: true },
      }),
    ]);

    const followerByUser = new Map(followerCounts.map((r) => [r.followingId, r._count.followingId]));
    const recipesByUser = new Map(recipeCounts.map((r) => [r.userId, r._count.userId]));
    const followingSet = new Set(myFollows.map((f) => f.followingId));

    return users.map((u) => ({
      id: u.id,
      email: u.email,
      username: u.username,
      displayName: u.displayName,
      followerCount: followerByUser.get(u.id) ?? 0,
      publicRecipeCount: recipesByUser.get(u.id) ?? 0,
      isFollowing: followingSet.has(u.id),
    }));
  }

  private async toPublic(
    currentUserId: string,
    user: { id: string; email: string; username: string | null; displayName: string | null },
  ): Promise<PublicUser> {
    const [result] = await this.toPublicBatch(currentUserId, [user]);
    return result;
  }
}
