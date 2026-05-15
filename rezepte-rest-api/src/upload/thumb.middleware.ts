import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { stat, rename, writeFile, unlink } from 'fs/promises';
import { randomBytes } from 'crypto';
import sharp from 'sharp';

const VALID_WIDTHS = [240, 480, 768];
const CACHE_DIR = join(process.cwd(), 'uploads', '.thumbs');
const SOURCE_DIR = join(process.cwd(), 'uploads');

if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });

@Injectable()
export class ThumbMiddleware implements NestMiddleware {
  private readonly logger = new Logger(ThumbMiddleware.name);

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (req.method !== 'GET') return next();
    const widthParam = req.query.w;
    if (!widthParam || typeof widthParam !== 'string') return next();
    const width = parseInt(widthParam, 10);
    if (!VALID_WIDTHS.includes(width)) return next();

    const filename = req.path.replace(/^\/+(api\/)?(uploads\/)?/, '');
    if (!filename || filename.includes('..') || filename.includes('/')) return next();

    const sourcePath = join(SOURCE_DIR, filename);
    const cachePath = join(CACHE_DIR, `${width}_${filename}.webp`);

    try {
      // Async stat statt blocking existsSync — Source darf fehlen
      const sourceStat = await stat(sourcePath).catch(() => null);
      if (!sourceStat) return next();

      // Cache-Hit prüfen
      const cacheStat = await stat(cachePath).catch(() => null);
      if (cacheStat && cacheStat.mtimeMs >= sourceStat.mtimeMs) {
        res.setHeader('Content-Type', 'image/webp');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.sendFile(cachePath);
        return;
      }

      // Cache-Miss: einmalig encoden
      const buffer = await sharp(sourcePath)
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();

      // Antworten zuerst — User wartet nicht aufs Schreiben
      res.setHeader('Content-Type', 'image/webp');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.send(buffer);

      // Atomar in Cache schreiben (tmp + rename) — verhindert Race-Conditions
      // wenn zwei parallele Requests dasselbe Thumb erzeugen
      const tmpPath = `${cachePath}.${randomBytes(6).toString('hex')}.tmp`;
      writeFile(tmpPath, buffer)
        .then(() => rename(tmpPath, cachePath))
        .catch(async (err) => {
          this.logger.warn(`Cache-Write fehlgeschlagen für ${filename}: ${(err as Error).message}`);
          await unlink(tmpPath).catch(() => undefined);
        });
    } catch (err) {
      this.logger.warn(`Thumb-Erzeugung fehlgeschlagen für ${filename}: ${err instanceof Error ? err.message : err}`);
      next();
    }
  }
}
