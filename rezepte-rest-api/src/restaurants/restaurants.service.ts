import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UploadService } from '../upload/upload.service';
import { Restaurant, RestaurantRating } from '@shared/interfaces';
import { CreateRestaurantDto, UpdateRestaurantDto } from './dto/restaurant.dto';

@Injectable()
export class RestaurantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
  ) {}

  async findAllForUser(userId: string): Promise<Restaurant[]> {
    const rows = await this.prisma.restaurant.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toDomain(r));
  }

  async findOne(id: string, userId: string): Promise<Restaurant> {
    const row = await this.prisma.restaurant.findUnique({ where: { id } });
    if (!row || row.userId !== userId) throw new NotFoundException('Restaurant nicht gefunden');
    return this.toDomain(row);
  }

  async create(userId: string, dto: CreateRestaurantDto): Promise<Restaurant> {
    const row = await this.prisma.restaurant.create({
      data: {
        userId,
        name: dto.name,
        cuisine: dto.cuisine ?? null,
        rating: dto.rating ?? null,
        priceLevel: dto.priceLevel ?? null,
        imagePath: dto.imagePath ?? null,
        notes: dto.notes ?? null,
        tags: dto.tags ?? [],
      },
    });
    return this.toDomain(row);
  }

  async update(id: string, userId: string, dto: UpdateRestaurantDto): Promise<Restaurant> {
    const existing = await this.prisma.restaurant.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) {
      throw new NotFoundException('Restaurant nicht gefunden');
    }

    // Altes Bild löschen, wenn der Pfad geändert wird (analog Recipe-Service).
    if (
      dto.imagePath !== undefined &&
      existing.imagePath &&
      dto.imagePath !== existing.imagePath
    ) {
      await this.uploadService.deleteByPath(existing.imagePath);
    }

    const row = await this.prisma.restaurant.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.cuisine !== undefined && { cuisine: dto.cuisine }),
        ...(dto.rating !== undefined && { rating: dto.rating }),
        ...(dto.priceLevel !== undefined && { priceLevel: dto.priceLevel }),
        ...(dto.imagePath !== undefined && { imagePath: dto.imagePath }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.tags !== undefined && { tags: dto.tags }),
      },
    });
    return this.toDomain(row);
  }

  async remove(id: string, userId: string): Promise<void> {
    const existing = await this.prisma.restaurant.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) {
      throw new NotFoundException('Restaurant nicht gefunden');
    }
    await this.uploadService.deleteByPath(existing.imagePath);
    await this.prisma.restaurant.delete({ where: { id } });
  }

  private toDomain(row: {
    id: string;
    userId: string;
    name: string;
    cuisine: string | null;
    rating: string | null;
    priceLevel: number | null;
    imagePath: string | null;
    notes: string | null;
    tags: string[];
    createdAt: Date;
    updatedAt: Date;
  }): Restaurant {
    return {
      id: row.id,
      userId: row.userId,
      name: row.name,
      cuisine: row.cuisine,
      rating: (row.rating as RestaurantRating | null) ?? null,
      priceLevel: row.priceLevel,
      imagePath: row.imagePath,
      notes: row.notes,
      tags: row.tags,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
