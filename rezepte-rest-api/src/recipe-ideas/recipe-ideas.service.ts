import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UploadService } from '../upload/upload.service';
import { CreateRecipeIdeaDto } from './dto/create-recipe-idea.dto';
import { UpdateRecipeIdeaDto } from './dto/update-recipe-idea.dto';
import { RecipeIdea } from '@shared/interfaces/recipe-idea.interface';

type DbIdea = Prisma.RecipeIdeaGetPayload<{
  include: { user: { select: { email: true; displayName: true } } };
}>;

@Injectable()
export class RecipeIdeasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
  ) {}

  async findAllForUser(userId: string): Promise<RecipeIdea[]> {
    const own = await this.prisma.recipeIdea.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { email: true, displayName: true } } },
    });
    const sharedWithMe = await this.prisma.recipeIdeaShare.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        idea: { include: { user: { select: { email: true, displayName: true } } } },
      },
    });
    const ownDomain = own.map((i) => this.toDomain(i, null));
    const sharedDomain = sharedWithMe.map((s) =>
      this.toDomain(s.idea, { email: s.idea.user.email, displayName: s.idea.user.displayName }),
    );
    return [...ownDomain, ...sharedDomain];
  }

  async findOneForUser(id: string, userId: string): Promise<RecipeIdea> {
    const row = await this.prisma.recipeIdea.findUnique({
      where: { id },
      include: { user: { select: { email: true, displayName: true } } },
    });
    if (!row) throw new NotFoundException('Idee nicht gefunden');
    if (row.userId === userId) return this.toDomain(row, null);
    const share = await this.prisma.recipeIdeaShare.findUnique({
      where: { ideaId_userId: { ideaId: id, userId } },
    });
    if (!share) throw new NotFoundException('Idee nicht gefunden');
    return this.toDomain(row, { email: row.user.email, displayName: row.user.displayName });
  }

  async create(userId: string, dto: CreateRecipeIdeaDto): Promise<RecipeIdea> {
    const row = await this.prisma.recipeIdea.create({
      data: {
        userId,
        title: dto.title ?? null,
        note: dto.note ?? null,
        imagePath: dto.imagePath ?? null,
      },
      include: { user: { select: { email: true, displayName: true } } },
    });
    return this.toDomain(row, null);
  }

  async update(id: string, userId: string, dto: UpdateRecipeIdeaDto): Promise<RecipeIdea> {
    const existing = await this.prisma.recipeIdea.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) {
      throw new NotFoundException('Idee nicht gefunden');
    }
    if (dto.imagePath !== undefined && existing.imagePath && dto.imagePath !== existing.imagePath) {
      await this.uploadService.deleteByPath(existing.imagePath);
    }
    const data: Prisma.RecipeIdeaUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.note !== undefined) data.note = dto.note;
    if (dto.imagePath !== undefined) data.imagePath = dto.imagePath;
    const row = await this.prisma.recipeIdea.update({
      where: { id },
      data,
      include: { user: { select: { email: true, displayName: true } } },
    });
    return this.toDomain(row, null);
  }

  async remove(id: string, userId: string): Promise<void> {
    const existing = await this.prisma.recipeIdea.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) {
      throw new NotFoundException('Idee nicht gefunden');
    }
    await this.uploadService.deleteByPath(existing.imagePath);
    await this.prisma.recipeIdea.delete({ where: { id } });
  }

  private toDomain(row: DbIdea, sharedFrom: { email: string; displayName: string | null } | null): RecipeIdea {
    return {
      id: row.id,
      title: row.title,
      note: row.note,
      imagePath: row.imagePath,
      shareToken: row.shareToken ?? null,
      sharedFrom,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
