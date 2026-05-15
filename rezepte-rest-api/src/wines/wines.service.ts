import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { promises as fs } from 'fs';
import { join } from 'path';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WineAnalyzerService } from './wine-analyzer.service';
import { UploadService } from '../upload/upload.service';
import { CreateWineDto } from './dto/create-wine.dto';
import { UpdateWineDto } from './dto/update-wine.dto';
import { Wine, WineAnalysisStatus, WineRating, WineType } from '@shared/interfaces/wine.interface';

type DbWine = Prisma.WineGetPayload<{
  include: { user: { select: { email: true; displayName: true } } };
}>;

@Injectable()
export class WinesService {
  private readonly logger = new Logger(WinesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly analyzer: WineAnalyzerService,
    private readonly uploadService: UploadService,
  ) {}

  async findAllForUser(userId: string): Promise<Wine[]> {
    const [own, sharedWithMe] = await Promise.all([
      this.prisma.wine.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { email: true, displayName: true } } },
      }),
      this.prisma.wineShare.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        include: {
          wine: { include: { user: { select: { email: true, displayName: true } } } },
        },
      }),
    ]);
    const ownDomain = own.map((w) => this.toDomain(w, null));
    const sharedDomain = sharedWithMe.map((s) =>
      this.toDomain(s.wine, { email: s.wine.user.email, displayName: s.wine.user.displayName }),
    );
    return [...ownDomain, ...sharedDomain];
  }

  async findByIdForUser(id: string, userId: string): Promise<Wine> {
    const row = await this.prisma.wine.findUnique({
      where: { id },
      include: { user: { select: { email: true, displayName: true } } },
    });
    if (!row) throw new NotFoundException('Wein nicht gefunden');
    if (row.userId === userId) return this.toDomain(row, null);
    const share = await this.prisma.wineShare.findUnique({
      where: { wineId_userId: { wineId: id, userId } },
    });
    if (!share) throw new NotFoundException('Wein nicht gefunden');
    return this.toDomain(row, { email: row.user.email, displayName: row.user.displayName });
  }

  async create(userId: string, dto: CreateWineDto): Promise<Wine> {
    const row = await this.prisma.wine.create({
      data: {
        userId,
        imagePath: dto.imagePath,
        imagePathBack: dto.imagePathBack ?? null,
        rating: dto.rating ?? null,
        notes: dto.notes ?? null,
        analysisStatus: 'pending',
        name: dto.name ?? null,
        vintage: dto.vintage ?? null,
        region: dto.region ?? null,
        country: dto.country ?? null,
        grape: dto.grape ?? null,
        winery: dto.winery ?? null,
        wineType: dto.wineType ?? null,
      },
      include: { user: { select: { email: true, displayName: true } } },
    });

    setImmediate(() => {
      this.runAnalysis(row.id).catch((err) => {
        this.logger.error(`Async analysis failed for wine ${row.id}: ${err}`);
      });
    });

    return this.toDomain(row, null);
  }

  async update(id: string, userId: string, dto: UpdateWineDto): Promise<Wine> {
    const existing = await this.prisma.wine.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) {
      throw new NotFoundException('Wein nicht gefunden');
    }

    // Alte Bilder löschen, wenn der Pfad geändert wird (analog Recipe-Service).
    // Vorder- und Rückseite getrennt behandeln.
    if (
      dto.imagePath !== undefined &&
      existing.imagePath &&
      dto.imagePath !== existing.imagePath
    ) {
      await this.uploadService.deleteByPath(existing.imagePath);
    }
    if (
      dto.imagePathBack !== undefined &&
      existing.imagePathBack &&
      dto.imagePathBack !== existing.imagePathBack
    ) {
      await this.uploadService.deleteByPath(existing.imagePathBack);
    }

    const data: Record<string, unknown> = {};
    if (dto.imagePath !== undefined) data.imagePath = dto.imagePath;
    if (dto.imagePathBack !== undefined) data.imagePathBack = dto.imagePathBack;
    if (dto.rating !== undefined) data.rating = dto.rating;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.vintage !== undefined) data.vintage = dto.vintage;
    if (dto.region !== undefined) data.region = dto.region;
    if (dto.country !== undefined) data.country = dto.country;
    if (dto.grape !== undefined) data.grape = dto.grape;
    if (dto.winery !== undefined) data.winery = dto.winery;
    if (dto.wineType !== undefined) data.wineType = dto.wineType;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.tastingNotes !== undefined) data.tastingNotes = dto.tastingNotes;

    // User-Korrekturen löschen das Review-Flag — er hat die Daten bestätigt
    const editedAnyField =
      dto.name !== undefined ||
      dto.vintage !== undefined ||
      dto.region !== undefined ||
      dto.country !== undefined ||
      dto.grape !== undefined ||
      dto.winery !== undefined ||
      dto.wineType !== undefined;
    if (dto.needsReview !== undefined) {
      data.needsReview = dto.needsReview;
    } else if (editedAnyField) {
      data.needsReview = false;
    }

    const row = await this.prisma.wine.update({
      where: { id },
      data,
      include: { user: { select: { email: true, displayName: true } } },
    });
    return this.toDomain(row, null);
  }

  async remove(id: string, userId: string): Promise<void> {
    const wine = await this.prisma.wine.findUnique({ where: { id } });
    if (!wine || wine.userId !== userId) {
      throw new NotFoundException('Wein nicht gefunden');
    }
    await this.uploadService.deleteByPath(wine.imagePath);
    await this.uploadService.deleteByPath(wine.imagePathBack);
    await this.prisma.wine.delete({ where: { id } });
  }

  async retryAnalysis(id: string, userId: string): Promise<Wine> {
    const wine = await this.prisma.wine.findUnique({ where: { id } });
    if (!wine || wine.userId !== userId) {
      throw new NotFoundException(`Wein ${id} nicht gefunden`);
    }
    if (!wine.imagePath) {
      throw new BadRequestException('Kein Bild zum Analysieren vorhanden');
    }
    // Bei Retry: alte (falsche) Analyse-Werte löschen, damit die neue Analyse 1:1 übernommen wird.
    // Vom User manuell gepflegte Werte (rating, notes) bleiben erhalten.
    await this.prisma.wine.update({
      where: { id },
      data: {
        analysisStatus: 'pending',
        analysisError: null,
        name: null,
        vintage: null,
        winery: null,
        region: null,
        country: null,
        grape: null,
        wineType: null,
        description: null,
        tastingNotes: null,
        needsReview: false,
      },
    });
    // Im Hintergrund laufen lassen — ähnlich wie bei create
    this.runAnalysis(id).catch((err) => {
      this.logger.error(`Retry-Analysis-Fehler ${id}: ${err instanceof Error ? err.message : err}`);
    });
    const refreshed = await this.prisma.wine.findUnique({
      where: { id },
      include: { user: { select: { email: true, displayName: true } } },
    });
    return this.toDomain(refreshed!, null);
  }

  private async runAnalysis(wineId: string): Promise<void> {
    const wine = await this.prisma.wine.findUnique({ where: { id: wineId } });
    if (!wine) return;

    this.logger.log(`Starting wine analysis for ${wineId}: ${wine.imagePath}${wine.imagePathBack ? ' + back' : ''}`);

    const imagePaths = [wine.imagePath, wine.imagePathBack].filter((p): p is string => !!p);
    const images: string[] = [];

    try {
      for (const path of imagePaths) {
        const filename = path.replace(/^.*\//, '');
        const filePath = join(process.cwd(), 'uploads', filename);
        const buffer = await fs.readFile(filePath);
        images.push(buffer.toString('base64'));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.prisma.wine.update({
        where: { id: wineId },
        data: { analysisStatus: 'failed', analysisError: `Bild konnte nicht gelesen werden: ${msg}` },
      });
      return;
    }

    try {
      const result = await this.analyzer.analyze(images);
      const fresh = await this.prisma.wine.findUnique({ where: { id: wineId } });
      if (!fresh) return;

      const update: Record<string, unknown> = {
        analysisStatus: 'analyzed',
        analysisError: null,
      };
      if (fresh.name === null && result.name !== null) update.name = result.name;
      if (fresh.vintage === null && result.vintage !== null) update.vintage = result.vintage;
      if (fresh.winery === null && result.winery !== null) update.winery = result.winery;
      if (fresh.region === null && result.region !== null) update.region = result.region;
      if (fresh.country === null && result.country !== null) update.country = result.country;
      if (fresh.grape === null && result.grape !== null) update.grape = result.grape;
      if (fresh.wineType === null && result.wineType !== null) update.wineType = result.wineType;
      if (fresh.description === null && result.description !== null) update.description = result.description;
      if (fresh.tastingNotes === null && result.tastingNotes !== null) update.tastingNotes = result.tastingNotes;
      update.needsReview = result.needsReview;

      await this.prisma.wine.update({ where: { id: wineId }, data: update });
      this.logger.log(`Analysis complete for ${wineId}: ${result.name ?? '(no name)'} ${result.vintage ?? ''}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Wine analysis failed for ${wineId}: ${msg}`);
      await this.prisma.wine.update({
        where: { id: wineId },
        data: { analysisStatus: 'failed', analysisError: msg },
      });
    }
  }

  private toDomain(row: DbWine, sharedFrom: { email: string; displayName: string | null } | null): Wine {
    return {
      id: row.id,
      imagePath: row.imagePath,
      imagePathBack: row.imagePathBack,
      rating: row.rating as WineRating | null,
      notes: row.notes,
      analysisStatus: row.analysisStatus as WineAnalysisStatus,
      analysisError: row.analysisError,
      name: row.name,
      vintage: row.vintage,
      region: row.region,
      country: row.country,
      grape: row.grape,
      winery: row.winery,
      wineType: row.wineType as WineType | null,
      description: row.description,
      tastingNotes: row.tastingNotes,
      needsReview: row.needsReview ?? false,
      shareToken: row.shareToken ?? null,
      sharedFrom,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
