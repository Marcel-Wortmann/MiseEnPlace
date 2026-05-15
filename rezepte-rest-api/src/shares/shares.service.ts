import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ShareInfo } from '@shared/interfaces/share.interface';

type EntityKind = 'recipe' | 'idea' | 'wine';

@Injectable()
export class SharesService {
  constructor(private readonly prisma: PrismaService) {}

  // ----- Public link tokens -----

  async ensureShareToken(kind: EntityKind, id: string, ownerId: string): Promise<string> {
    const existing = await this.assertOwnerAndLoad(kind, id, ownerId);
    if (existing.shareToken) return existing.shareToken;
    const token = this.generateToken();
    await this.updateShareToken(kind, id, token);
    return token;
  }

  async revokeShareToken(kind: EntityKind, id: string, ownerId: string): Promise<void> {
    await this.assertOwnerAndLoad(kind, id, ownerId);
    await this.updateShareToken(kind, id, null);
  }

  async findByShareToken(kind: EntityKind, token: string) {
    if (kind === 'recipe') {
      return this.prisma.recipe.findUnique({
        where: { shareToken: token },
        include: { user: { select: { email: true, displayName: true } } },
      });
    }
    if (kind === 'idea') {
      return this.prisma.recipeIdea.findUnique({
        where: { shareToken: token },
        include: { user: { select: { email: true, displayName: true } } },
      });
    }
    return this.prisma.wine.findUnique({
      where: { shareToken: token },
      include: { user: { select: { email: true, displayName: true } } },
    });
  }

  // ----- User-to-user sharing -----

  async shareWithUser(kind: EntityKind, id: string, ownerId: string, targetUserId: string): Promise<void> {
    if (ownerId === targetUserId) {
      throw new ConflictException('Du kannst nicht mit dir selbst teilen.');
    }
    await this.assertOwnerAndLoad(kind, id, ownerId);
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) throw new NotFoundException('Nutzer nicht gefunden.');

    try {
      if (kind === 'recipe') {
        await this.prisma.recipeShare.create({ data: { recipeId: id, userId: targetUserId } });
      } else if (kind === 'idea') {
        await this.prisma.recipeIdeaShare.create({ data: { ideaId: id, userId: targetUserId } });
      } else {
        await this.prisma.wineShare.create({ data: { wineId: id, userId: targetUserId } });
      }
    } catch (err) {
      // P2002 = Unique constraint violation → bereits geteilt
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Bereits mit diesem Nutzer geteilt.');
      }
      throw err;
    }
  }

  async unshareWithUser(kind: EntityKind, id: string, ownerId: string, targetUserId: string): Promise<void> {
    await this.assertOwnerAndLoad(kind, id, ownerId);
    if (kind === 'recipe') {
      await this.prisma.recipeShare.deleteMany({ where: { recipeId: id, userId: targetUserId } });
    } else if (kind === 'idea') {
      await this.prisma.recipeIdeaShare.deleteMany({ where: { ideaId: id, userId: targetUserId } });
    } else {
      await this.prisma.wineShare.deleteMany({ where: { wineId: id, userId: targetUserId } });
    }
  }

  async getShareInfo(kind: EntityKind, id: string, ownerId: string): Promise<ShareInfo> {
    const entity = await this.assertOwnerAndLoad(kind, id, ownerId);
    let sharedWith: { userId: string; email: string; displayName: string | null }[] = [];
    if (kind === 'recipe') {
      const rows = await this.prisma.recipeShare.findMany({
        where: { recipeId: id },
        include: { user: { select: { id: true, email: true, displayName: true } } },
      });
      sharedWith = rows.map((r) => ({ userId: r.user.id, email: r.user.email, displayName: r.user.displayName }));
    } else if (kind === 'idea') {
      const rows = await this.prisma.recipeIdeaShare.findMany({
        where: { ideaId: id },
        include: { user: { select: { id: true, email: true, displayName: true } } },
      });
      sharedWith = rows.map((r) => ({ userId: r.user.id, email: r.user.email, displayName: r.user.displayName }));
    } else {
      const rows = await this.prisma.wineShare.findMany({
        where: { wineId: id },
        include: { user: { select: { id: true, email: true, displayName: true } } },
      });
      sharedWith = rows.map((r) => ({ userId: r.user.id, email: r.user.email, displayName: r.user.displayName }));
    }
    return { shareToken: entity.shareToken, sharedWith };
  }

  // ----- helpers -----

  private async assertOwnerAndLoad(
    kind: EntityKind,
    id: string,
    ownerId: string,
  ): Promise<{ id: string; userId: string; shareToken: string | null }> {
    let entity: { id: string; userId: string; shareToken: string | null } | null = null;
    if (kind === 'recipe') {
      entity = await this.prisma.recipe.findUnique({
        where: { id },
        select: { id: true, userId: true, shareToken: true },
      });
    } else if (kind === 'idea') {
      entity = await this.prisma.recipeIdea.findUnique({
        where: { id },
        select: { id: true, userId: true, shareToken: true },
      });
    } else {
      entity = await this.prisma.wine.findUnique({
        where: { id },
        select: { id: true, userId: true, shareToken: true },
      });
    }
    if (!entity) throw new NotFoundException('Eintrag nicht gefunden.');
    if (entity.userId !== ownerId) throw new NotFoundException('Eintrag nicht gefunden.');
    return entity;
  }

  private async updateShareToken(kind: EntityKind, id: string, token: string | null): Promise<void> {
    if (kind === 'recipe') {
      await this.prisma.recipe.update({ where: { id }, data: { shareToken: token } });
    } else if (kind === 'idea') {
      await this.prisma.recipeIdea.update({ where: { id }, data: { shareToken: token } });
    } else {
      await this.prisma.wine.update({ where: { id }, data: { shareToken: token } });
    }
  }

  private generateToken(): string {
    return randomBytes(16).toString('base64url');
  }
}
