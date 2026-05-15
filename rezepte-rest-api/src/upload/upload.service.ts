import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import { basename, join } from 'path';
import { randomUUID } from 'crypto';
import sharp from 'sharp';

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);
  private readonly uploadDir = join(process.cwd(), 'uploads');
  private readonly thumbDir = join(this.uploadDir, '.thumbs');

  /**
   * Saves a binary buffer (e.g. uploaded image) to the uploads directory.
   * Skaliert grosse Bilder auf max 1920px (1080p) — spart Speicher und
   * Decoding-Zeit auf Mobile. `.rotate()` ohne Argument wendet EXIF-Orientation
   * auf die Pixel an, sodass das gespeicherte Bild physisch korrekt liegt
   * (Sharp's resize strippt EXIF, deshalb müssen wir vorher rotieren).
   */
  async saveBuffer(buffer: Buffer, originalName: string): Promise<{ filename: string; path: string }> {
    await fs.mkdir(this.uploadDir, { recursive: true });
    await fs.mkdir(this.thumbDir, { recursive: true });
    const ext = (basename(originalName).match(/\.[a-z0-9]+$/i)?.[0] ?? '').toLowerCase();
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '.jpg';
    const filename = `${randomUUID()}${safeExt}`;
    const fullPath = join(this.uploadDir, filename);

    let processed: Buffer;
    try {
      const pipeline = sharp(buffer, { failOn: 'none' })
        .rotate()
        .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true });
      if (safeExt === '.png') {
        processed = await pipeline.png({ compressionLevel: 9 }).toBuffer();
      } else if (safeExt === '.webp') {
        processed = await pipeline.webp({ quality: 88 }).toBuffer();
      } else {
        processed = await pipeline.jpeg({ quality: 88, mozjpeg: true }).toBuffer();
      }
    } catch (err) {
      this.logger.warn(`Bild-Skalierung fehlgeschlagen, speichere Original: ${(err as Error).message}`);
      processed = buffer;
    }

    await fs.writeFile(fullPath, processed);

    this.prewarmThumbs(filename, fullPath).catch((err) =>
      this.logger.warn(`Thumb-Prewarming fehlgeschlagen für ${filename}: ${(err as Error).message}`),
    );

    return { filename, path: `/api/uploads/${filename}` };
  }

  private async prewarmThumbs(filename: string, sourcePath: string): Promise<void> {
    const widths = [240, 480, 768];
    await Promise.all(
      widths.map(async (w) => {
        const target = join(this.thumbDir, `${w}_${filename}.webp`);
        try {
          await sharp(sourcePath).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: 80 }).toFile(target);
        } catch (err) {
          this.logger.warn(`Thumb ${w}px für ${filename} fehlgeschlagen: ${(err as Error).message}`);
        }
      }),
    );
  }

  async deleteFile(filename: string): Promise<void> {
    const safeName = basename(filename);
    const fullPath = join(this.uploadDir, safeName);

    try {
      await fs.unlink(fullPath);
    } catch (err) {
      this.logger.warn(`Datei konnte nicht gelöscht werden: ${safeName} (${(err as Error).message})`);
    }
  }

  async deleteByPath(imagePath: string | null | undefined): Promise<void> {
    if (!imagePath) {
      return;
    }
    const filename = basename(imagePath);
    await this.deleteFile(filename);
  }
}
