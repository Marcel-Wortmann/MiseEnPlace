import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface UserSearchResult {
  id: string;
  email: string;
  displayName: string | null;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Searches users by email substring (case-insensitive). Excludes the requesting user.
   * Returns at most 10 results.
   */
  async search(query: string, excludeUserId: string): Promise<UserSearchResult[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];
    const users = await this.prisma.user.findMany({
      where: {
        email: { contains: trimmed.toLowerCase(), mode: 'insensitive' },
        NOT: { id: excludeUserId },
      },
      select: { id: true, email: true, displayName: true },
      take: 10,
      orderBy: { email: 'asc' },
    });
    return users;
  }
}
