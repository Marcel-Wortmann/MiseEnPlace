import { Injectable, BadRequestException } from '@nestjs/common';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';

const ISSUER = 'Mise en Place';

@Injectable()
export class TotpService {
  constructor(private readonly prisma: PrismaService) {
    authenticator.options = { window: 1 }; // ±30s Toleranz
  }

  /**
   * Setup-Start: Secret generieren und QR-Code-URL zurückgeben.
   * Speichert Secret noch nicht permanent — erst nach Bestätigung mit verify().
   */
  async generateSetup(userId: string, email: string): Promise<{ secret: string; qrDataUrl: string; otpauthUrl: string }> {
    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(email, ISSUER, secret);
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl);
    // Secret temporär in DB schreiben, totpEnabled bleibt false bis verify()
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: secret, totpEnabled: false },
    });
    return { secret, qrDataUrl, otpauthUrl };
  }

  /** Aktiviert 2FA nach erfolgreichem Code-Check, gibt Recovery-Codes zurück. */
  async confirmEnable(userId: string, code: string): Promise<{ recoveryCodes: string[] }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.totpSecret) throw new BadRequestException('TOTP nicht initiiert');
    if (!authenticator.check(code, user.totpSecret)) {
      throw new BadRequestException('Code ungültig');
    }
    // 8 Recovery-Codes generieren, gehasht speichern, Plain-Text einmalig zurückgeben
    const plain: string[] = [];
    const hashes: string[] = [];
    for (let i = 0; i < 8; i++) {
      const code = randomBytes(5).toString('hex'); // 10 Zeichen hex
      plain.push(code);
      hashes.push(await bcrypt.hash(code, 10));
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpEnabled: true, totpRecoveryCodes: hashes },
    });
    return { recoveryCodes: plain };
  }

  /** Prüft TOTP-Code beim Login. Akzeptiert auch Recovery-Codes. */
  async verifyCode(userId: string, code: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.totpEnabled || !user.totpSecret) return false;

    if (authenticator.check(code, user.totpSecret)) return true;

    // Recovery-Code-Check
    const codes = user.totpRecoveryCodes ?? [];
    for (let i = 0; i < codes.length; i++) {
      if (await bcrypt.compare(code, codes[i])) {
        // Recovery-Code verbrauchen
        const remaining = codes.filter((_, idx) => idx !== i);
        await this.prisma.user.update({
          where: { id: userId },
          data: { totpRecoveryCodes: remaining },
        });
        return true;
      }
    }
    return false;
  }

  /** Deaktiviert 2FA nach Passwort-Bestätigung. */
  async disable(userId: string, password: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('Nutzer nicht gefunden');
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new BadRequestException('Passwort falsch');
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: null, totpEnabled: false, totpRecoveryCodes: [] },
    });
  }
}
