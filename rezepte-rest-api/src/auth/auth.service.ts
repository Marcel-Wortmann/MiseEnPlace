import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TotpService } from './totp.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { AuthResponse, AuthTokens, User } from '@shared/interfaces/auth.interface';

const ACCESS_TTL = '15m';
const REFRESH_TTL_DAYS = 30;

interface JwtPayload {
  sub: string;
  email: string;
  type: 'access' | 'refresh';
}

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly totp: TotpService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Admin per Email aus ENV. Mehrere kommasepariert.
    const raw = process.env.ADMIN_EMAILS;
    if (!raw) return;
    const emails = raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
    if (emails.length === 0) return;
    try {
      const result = await this.prisma.user.updateMany({
        where: { email: { in: emails }, isAdmin: false },
        data: { isAdmin: true },
      });
      if (result.count > 0) {
        this.logger.log(`Admin-Promotion: ${result.count} User auf isAdmin=true gesetzt (${emails.join(', ')})`);
      }
    } catch (err) {
      this.logger.warn(`Admin-Promotion fehlgeschlagen: ${(err as Error).message}`);
    }
  }

  async register(dto: RegisterDto): Promise<AuthResponse> {
    const email = dto.email.trim().toLowerCase();
    const username = dto.username?.trim().toLowerCase() || null;

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('E-Mail-Adresse ist bereits registriert.');
    }
    if (username) {
      const existingUsername = await this.prisma.user.findUnique({ where: { username } });
      if (existingUsername) {
        throw new ConflictException('Benutzername ist bereits vergeben.');
      }
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        email,
        username,
        passwordHash,
        displayName: dto.displayName?.trim() || null,
      },
    });

    const tokens = await this.issueTokens(user.id, user.email);
    return { user: this.toDomain(user), tokens };
  }

  async login(dto: LoginDto): Promise<AuthResponse | { totpRequired: true; userId: string }> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new UnauthorizedException('E-Mail oder Passwort ungültig.');
    }
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('E-Mail oder Passwort ungültig.');
    }

    // 2FA: wenn aktiv, fordere Code an (zweiter Schritt via /auth/login-totp)
    if (user.totpEnabled) {
      if (!dto.totpCode) {
        return { totpRequired: true, userId: user.id };
      }
      const valid = await this.totp.verifyCode(user.id, dto.totpCode.trim());
      if (!valid) {
        throw new UnauthorizedException('TOTP-Code ungültig.');
      }
    }

    // Opportunistisch abgelaufene Tokens dieses Users entfernen
    this.prisma.refreshToken
      .deleteMany({ where: { userId: user.id, expiresAt: { lt: new Date() } } })
      .catch((err) => this.logger.warn(`Token-Cleanup fehlgeschlagen: ${(err as Error).message}`));

    const tokens = await this.issueTokens(user.id, user.email);
    return { user: this.toDomain(user), tokens };
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    let payload: JwtPayload;
    try {
      payload = this.jwt.verify<JwtPayload>(refreshToken);
    } catch {
      throw new UnauthorizedException('Refresh-Token ungültig oder abgelaufen.');
    }
    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Falscher Token-Typ.');
    }

    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!stored || stored.userId !== payload.sub || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh-Token wurde widerrufen.');
    }

    // Rotate: revoke this token, issue a new pair
    await this.prisma.refreshToken.delete({ where: { id: stored.id } });
    return this.issueTokens(payload.sub, payload.email);
  }

  async logout(refreshToken: string): Promise<void> {
    try {
      const tokenHash = this.hashToken(refreshToken);
      await this.prisma.refreshToken.deleteMany({ where: { tokenHash } });
    } catch (err) {
      this.logger.warn(`logout token cleanup: ${(err as Error).message}`);
    }
  }

  async getProfile(userId: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Nutzer nicht gefunden.');
    return this.toDomain(user);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<User> {
    const data: { displayName?: string | null; username?: string | null } = {};
    if (dto.displayName !== undefined) data.displayName = dto.displayName?.trim() || null;
    if (dto.username !== undefined) {
      const username = dto.username?.trim().toLowerCase() || null;
      if (username) {
        const existing = await this.prisma.user.findFirst({
          where: { username, id: { not: userId } },
        });
        if (existing) throw new ConflictException('Benutzername ist bereits vergeben.');
      }
      data.username = username;
    }
    const user = await this.prisma.user.update({ where: { id: userId }, data });
    return this.toDomain(user);
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Nutzer nicht gefunden.');

    const ok = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!ok) throw new BadRequestException('Aktuelles Passwort ist nicht korrekt.');

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    // Invalidate all refresh tokens
    await this.prisma.refreshToken.deleteMany({ where: { userId } });
  }

  async deleteAccount(userId: string): Promise<void> {
    // Cascade in schema removes recipes/ideas/wines/shares/tokens.
    await this.prisma.user.delete({ where: { id: userId } });
  }

  // ----- helpers -----

  private async issueTokens(userId: string, email: string): Promise<AuthTokens> {
    const accessToken = this.jwt.sign(
      { sub: userId, email, type: 'access' } satisfies JwtPayload,
      { expiresIn: ACCESS_TTL },
    );
    const refreshTokenJti = randomBytes(16).toString('hex');
    const refreshToken = this.jwt.sign(
      { sub: userId, email, type: 'refresh', jti: refreshTokenJti } as JwtPayload & { jti: string },
      { expiresIn: `${REFRESH_TTL_DAYS}d` },
    );

    const tokenHash = this.hashToken(refreshToken);
    const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
    await this.prisma.refreshToken.create({
      data: { userId, tokenHash, expiresAt },
    });

    return { accessToken, refreshToken };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private toDomain(user: { id: string; email: string; username: string | null; displayName: string | null; totpEnabled?: boolean; isAdmin?: boolean; createdAt: Date }): User {
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      totpEnabled: user.totpEnabled ?? false,
      isAdmin: user.isAdmin ?? false,
      createdAt: user.createdAt.toISOString(),
    };
  }
}
