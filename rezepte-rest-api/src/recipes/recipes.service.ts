import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { promises as fs } from 'fs';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { UploadService } from '../upload/upload.service';
import { RecipeExtractorService } from '../ai/recipe-extractor.service';
import { CreateRecipeDto } from './dto/create-recipe.dto';
import { UpdateRecipeDto } from './dto/update-recipe.dto';
import {
  Recipe,
  RecipeIngredient,
  RecipeStep,
  Difficulty,
  RecipeAnalysisStatus,
  ExtractedRecipeDraft,
} from '@shared/interfaces/recipe.interface';

type DbRecipe = Prisma.RecipeGetPayload<{
  include: { user: { select: { email: true; displayName: true } } };
}>;

@Injectable()
export class RecipesService {
  private readonly logger = new Logger(RecipesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
    private readonly extractor: RecipeExtractorService,
  ) {}

  /**
   * Returns recipes owned by the user PLUS recipes shared with them.
   * Items shared with the user have `sharedFrom` set so the frontend can mark them.
   */
  /**
   * Liefert alle Tags die der User selbst verwendet, plus Tags aus Rezepten
   * denen er folgt oder die mit ihm geteilt wurden. Andere User sind ausgeschlossen.
   */
  async getAllTagsForUser(userId: string): Promise<string[]> {
    const [own, shared, followed] = await Promise.all([
      this.prisma.recipe.findMany({ where: { userId }, select: { tags: true } }),
      this.prisma.recipeShare.findMany({ where: { userId }, select: { recipe: { select: { tags: true } } } }),
      this.prisma.recipeFollow.findMany({ where: { userId }, select: { recipe: { select: { tags: true } } } }),
    ]);
    const set = new Set<string>();
    for (const r of own) for (const t of r.tags) set.add(t);
    for (const s of shared) for (const t of s.recipe.tags) set.add(t);
    for (const f of followed) for (const t of f.recipe.tags) set.add(t);
    return Array.from(set);
  }

  async findAllForUser(userId: string): Promise<Recipe[]> {
    const [own, sharedWithMe, followed] = await Promise.all([
      this.prisma.recipe.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { email: true, displayName: true } } },
      }),
      this.prisma.recipeShare.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        include: {
          recipe: {
            include: { user: { select: { email: true, displayName: true } } },
          },
        },
      }),
      this.prisma.recipeFollow.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        include: {
          recipe: {
            include: { user: { select: { email: true, displayName: true } } },
          },
        },
      }),
    ]);
    const ownDomain = own.map((r) => this.toDomain(r, null, false));
    const sharedDomain = sharedWithMe.map((s) =>
      this.toDomain(s.recipe, { email: s.recipe.user.email, displayName: s.recipe.user.displayName }, false),
    );
    const followedDomain = followed
      .filter((f) => f.recipe.userId !== userId)
      .map((f) =>
        this.toDomain(f.recipe, { email: f.recipe.user.email, displayName: f.recipe.user.displayName }, true),
      );
    return [...ownDomain, ...sharedDomain, ...followedDomain];
  }

  async findOneForUser(id: string, userId: string): Promise<Recipe> {
    const row = await this.prisma.recipe.findUnique({
      where: { id },
      include: { user: { select: { email: true, displayName: true } } },
    });
    if (!row) throw new NotFoundException(`Rezept ${id} nicht gefunden`);
    if (row.userId === userId) {
      return this.toDomain(row, null, false);
    }
    // Check share
    const share = await this.prisma.recipeShare.findUnique({
      where: { recipeId_userId: { recipeId: id, userId } },
    });
    if (share) {
      return this.toDomain(row, { email: row.user.email, displayName: row.user.displayName }, false);
    }
    // Check recipe-follow
    const recipeFollow = await this.prisma.recipeFollow.findUnique({
      where: { userId_recipeId: { userId, recipeId: id } },
    });
    if (recipeFollow) {
      return this.toDomain(row, { email: row.user.email, displayName: row.user.displayName }, true);
    }
    // Public + follows author? -> OK
    if (!row.isPrivate) {
      const userFollow = await this.prisma.follow.findUnique({
        where: { followerId_followingId: { followerId: userId, followingId: row.userId } },
      });
      if (userFollow) {
        return this.toDomain(row, { email: row.user.email, displayName: row.user.displayName }, false);
      }
    }
    throw new NotFoundException(`Rezept ${id} nicht gefunden`);
  }

  async create(userId: string, dto: CreateRecipeDto): Promise<Recipe> {
    const row = await this.prisma.recipe.create({
      data: {
        userId,
        title: dto.title,
        description: dto.description ?? null,
        personalNotes: dto.personalNotes ?? null,
        imagePath: dto.imagePath ?? null,
        durationMinutes: dto.durationMinutes ?? null,
        difficulty: dto.difficulty ?? null,
        rating: dto.rating ?? null,
        servings: dto.servings ?? null,
        caloriesPerServing: dto.caloriesPerServing ?? null,
        proteinPerServing: dto.proteinPerServing ?? null,
        carbsPerServing: dto.carbsPerServing ?? null,
        fatPerServing: dto.fatPerServing ?? null,
        isPrivate: dto.isPrivate ?? false,
        tags: dto.tags ?? [],
        ingredients: (dto.ingredients ?? []) as unknown as Prisma.InputJsonValue,
        steps: (dto.steps ?? []) as unknown as Prisma.InputJsonValue,
      },
      include: { user: { select: { email: true, displayName: true } } },
    });
    return this.toDomain(row, null, false);
  }

  async createFromImageAsync(
    userId: string,
    imagePath: string,
    hints?: { title?: string | null; description?: string | null },
  ): Promise<Recipe> {
    const row = await this.prisma.recipe.create({
      data: {
        userId,
        title: hints?.title?.trim() || 'Wird analysiert…',
        description: hints?.description?.trim() || null,
        imagePath,
        analysisStatus: 'pending',
      },
      include: { user: { select: { email: true, displayName: true } } },
    });

    setImmediate(() => {
      this.runImageAnalysis(row.id, hints).catch((err) => {
        this.logger.error(`Async image analysis failed for recipe ${row.id}: ${err}`);
      });
    });

    return this.toDomain(row, null, false);
  }

  async createFromUrlAsync(userId: string, url: string, htmlText: string): Promise<Recipe> {
    const row = await this.prisma.recipe.create({
      data: {
        userId,
        title: 'Wird analysiert…',
        analysisStatus: 'pending',
      },
      include: { user: { select: { email: true, displayName: true } } },
    });

    setImmediate(() => {
      this.runUrlAnalysis(row.id, url, htmlText).catch((err) => {
        this.logger.error(`Async URL analysis failed for recipe ${row.id}: ${err}`);
      });
    });

    return this.toDomain(row, null, false);
  }

  async update(id: string, userId: string, dto: UpdateRecipeDto): Promise<Recipe> {
    const existing = await this.prisma.recipe.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) {
      throw new NotFoundException(`Rezept ${id} nicht gefunden`);
    }

    if (
      dto.imagePath !== undefined &&
      existing.imagePath &&
      dto.imagePath !== existing.imagePath
    ) {
      await this.uploadService.deleteByPath(existing.imagePath);
    }

    const data: Prisma.RecipeUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.personalNotes !== undefined) data.personalNotes = dto.personalNotes;
    if (dto.imagePath !== undefined) data.imagePath = dto.imagePath;
    if (dto.durationMinutes !== undefined) data.durationMinutes = dto.durationMinutes;
    if (dto.difficulty !== undefined) data.difficulty = dto.difficulty;
    if (dto.rating !== undefined) data.rating = dto.rating;
    if (dto.servings !== undefined) data.servings = dto.servings;
    if (dto.caloriesPerServing !== undefined) data.caloriesPerServing = dto.caloriesPerServing;
    if (dto.proteinPerServing !== undefined) data.proteinPerServing = dto.proteinPerServing;
    if (dto.carbsPerServing !== undefined) data.carbsPerServing = dto.carbsPerServing;
    if (dto.fatPerServing !== undefined) data.fatPerServing = dto.fatPerServing;
    if (dto.isFavorite !== undefined) data.isFavorite = dto.isFavorite;
    if (dto.isPrivate !== undefined) data.isPrivate = dto.isPrivate;
    if (dto.tags !== undefined) data.tags = dto.tags;
    if (dto.ingredients !== undefined) {
      data.ingredients = dto.ingredients as unknown as Prisma.InputJsonValue;
    }
    if (dto.steps !== undefined) {
      data.steps = dto.steps as unknown as Prisma.InputJsonValue;
    }

    if (existing.analysisStatus && existing.analysisStatus !== 'analyzed') {
      data.analysisStatus = 'analyzed';
      data.analysisError = null;
    }

    const row = await this.prisma.recipe.update({
      where: { id },
      data,
      include: { user: { select: { email: true, displayName: true } } },
    });
    return this.toDomain(row, null, false);
  }

  async remove(id: string, userId: string): Promise<void> {
    const existing = await this.prisma.recipe.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) {
      throw new NotFoundException(`Rezept ${id} nicht gefunden`);
    }
    await this.uploadService.deleteByPath(existing.imagePath);
    await this.prisma.recipe.delete({ where: { id } });
  }

  // ---------- Async analysis runners ----------

  private async runImageAnalysis(
    recipeId: string,
    hints?: { title?: string | null; description?: string | null },
  ): Promise<void> {
    const recipe = await this.prisma.recipe.findUnique({ where: { id: recipeId } });
    if (!recipe || !recipe.imagePath) return;

    this.logger.log(`Starting recipe image analysis for ${recipeId}: ${recipe.imagePath}`);

    let imageBase64: string;
    try {
      const filename = recipe.imagePath.replace(/^.*\//, '');
      const filePath = join(process.cwd(), 'uploads', filename);
      const buffer = await fs.readFile(filePath);
      imageBase64 = buffer.toString('base64');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.markFailed(recipeId, `Bild konnte nicht gelesen werden: ${msg}`);
      return;
    }

    try {
      const draft = await this.extractor.extractFromImage(imageBase64, hints);
      await this.applyDraft(recipeId, draft);
      this.logger.log(`Recipe image analysis complete for ${recipeId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Recipe image analysis failed for ${recipeId}: ${msg}`);
      await this.markFailed(recipeId, msg);
    }
  }

  private async runUrlAnalysis(recipeId: string, url: string, htmlText: string): Promise<void> {
    this.logger.log(`Starting recipe URL analysis for ${recipeId}: ${url}`);
    try {
      const draft = await this.extractor.extractFromText(htmlText, url);
      await this.applyDraft(recipeId, draft);
      this.logger.log(`Recipe URL analysis complete for ${recipeId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Recipe URL analysis failed for ${recipeId}: ${msg}`);
      await this.markFailed(recipeId, msg);
    }
  }

  private async applyDraft(recipeId: string, draft: ExtractedRecipeDraft): Promise<void> {
    const fresh = await this.prisma.recipe.findUnique({ where: { id: recipeId } });
    if (!fresh) return;

    const data: Prisma.RecipeUpdateInput = {
      analysisStatus: 'analyzed',
      analysisError: null,
    };

    const isSet = <T>(v: T | null | undefined): v is T => v !== null && v !== undefined;
    const isEmpty = (v: string | null | undefined): boolean => v === null || v === undefined || v === '';

    if (isSet(draft.title) && (fresh.title === 'Wird analysiert…' || fresh.title === '')) {
      data.title = draft.title;
    }
    if (isSet(draft.description) && isEmpty(fresh.description)) data.description = draft.description;
    if (isSet(draft.durationMinutes) && !isSet(fresh.durationMinutes)) data.durationMinutes = draft.durationMinutes;
    if (isSet(draft.difficulty) && !isSet(fresh.difficulty)) data.difficulty = draft.difficulty;
    if (isSet(draft.servings) && !isSet(fresh.servings)) data.servings = draft.servings;
    if (isSet(draft.caloriesPerServing) && !isSet(fresh.caloriesPerServing)) {
      data.caloriesPerServing = draft.caloriesPerServing;
    }
    if (isSet(draft.proteinPerServing) && !isSet(fresh.proteinPerServing)) {
      data.proteinPerServing = draft.proteinPerServing;
    }
    if (isSet(draft.carbsPerServing) && !isSet(fresh.carbsPerServing)) {
      data.carbsPerServing = draft.carbsPerServing;
    }
    if (isSet(draft.fatPerServing) && !isSet(fresh.fatPerServing)) {
      data.fatPerServing = draft.fatPerServing;
    }
    if (draft.tags.length > 0 && fresh.tags.length === 0) data.tags = draft.tags;

    const validIngredients = draft.ingredients.filter((i) => i.name?.trim());
    const existingIngredients = this.parseIngredients(fresh.ingredients);
    if (validIngredients.length > 0 && existingIngredients.length === 0) {
      data.ingredients = validIngredients as unknown as Prisma.InputJsonValue;
    }

    const validSteps = draft.steps.filter((s) => s.text?.trim());
    const existingSteps = this.parseSteps(fresh.steps);
    if (validSteps.length > 0 && existingSteps.length === 0) {
      data.steps = validSteps as unknown as Prisma.InputJsonValue;
    }

    await this.prisma.recipe.update({ where: { id: recipeId }, data });
  }

  private async markFailed(recipeId: string, error: string): Promise<void> {
    const fresh = await this.prisma.recipe.findUnique({ where: { id: recipeId } });
    if (!fresh) return;
    await this.prisma.recipe.update({
      where: { id: recipeId },
      data: {
        analysisStatus: 'failed',
        analysisError: error,
        title: fresh.title === 'Wird analysiert…' ? 'Unbenanntes Rezept' : fresh.title,
      },
    });
  }

  // ---------- Mapping ----------

  /**
   * Validiert eine RecipeIngredient aus JSON. Filtert defekte Einträge raus
   * (z.B. wenn jemand direkt in DB schreibt) statt das Frontend crashen zu lassen.
   */
  private parseIngredients(raw: unknown): RecipeIngredient[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((i): i is Record<string, unknown> => typeof i === 'object' && i !== null)
      .map((i) => ({
        name: typeof i.name === 'string' ? i.name : '',
        amount: typeof i.amount === 'number' && Number.isFinite(i.amount) ? i.amount : null,
        unit: typeof i.unit === 'string' ? i.unit : null,
      }))
      .filter((i) => i.name.trim().length > 0);
  }

  private parseSteps(raw: unknown): RecipeStep[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
      .map((s, idx) => ({
        order: typeof s.order === 'number' && Number.isFinite(s.order) ? s.order : idx + 1,
        text: typeof s.text === 'string' ? s.text : '',
      }))
      .filter((s) => s.text.trim().length > 0);
  }

  /** Public-Wrapper für FollowService — wandelt einen DB-Row in ein Domain-Objekt. */
  rowToDomain(row: DbRecipe, sharedFrom: { email: string; displayName: string | null } | null): Recipe {
    return this.toDomain(row, sharedFrom, false);
  }

  private toDomain(row: DbRecipe, sharedFrom: { email: string; displayName: string | null } | null, isFollowed: boolean): Recipe {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      personalNotes: row.personalNotes,
      imagePath: row.imagePath,
      durationMinutes: row.durationMinutes,
      difficulty: row.difficulty as Difficulty | null,
      rating: row.rating,
      servings: row.servings,
      caloriesPerServing: row.caloriesPerServing,
      proteinPerServing: row.proteinPerServing,
      carbsPerServing: row.carbsPerServing,
      fatPerServing: row.fatPerServing,
      isFavorite: row.isFavorite,
      isPrivate: row.isPrivate,
      isFollowed,
      tags: row.tags,
      ingredients: this.parseIngredients(row.ingredients),
      steps: this.parseSteps(row.steps),
      analysisStatus: (row.analysisStatus as RecipeAnalysisStatus | null) ?? null,
      analysisError: row.analysisError ?? null,
      shareToken: row.shareToken ?? null,
      sharedFrom,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
