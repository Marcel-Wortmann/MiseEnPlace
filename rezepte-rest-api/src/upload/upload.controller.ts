import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync, statSync } from 'fs';
import { stat, rename, writeFile, unlink } from 'fs/promises';
import { randomBytes, randomUUID } from 'crypto';
import sharp from 'sharp';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { UploadService } from './upload.service';

const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_SIZE_BYTES = 8 * 1024 * 1024;
const VALID_WIDTHS = new Set([240, 480, 768]);
const SOURCE_DIR = join(process.cwd(), 'uploads');
const CACHE_DIR = join(SOURCE_DIR, '.thumbs');

if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });

@Controller('uploads')
export class UploadController {
  private readonly logger = new Logger(UploadController.name);

  constructor(private readonly uploadService: UploadService) {}

  @Public()
  @Get(':filename')
  async serveImage(
    @Param('filename') filename: string,
    @Query('w') widthParam: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (filename.includes('..') || filename.includes('/')) {
      throw new NotFoundException();
    }
    const sourcePath = join(SOURCE_DIR, filename);
    const sourceStat = await stat(sourcePath).catch(() => null);
    if (!sourceStat) throw new NotFoundException();

    const width = widthParam ? parseInt(widthParam, 10) : NaN;
    if (!VALID_WIDTHS.has(width)) {
      // Original ausliefern
      res.setHeader('Cache-Control', 'public, max-age=2592000');
      res.setHeader('Last-Modified', sourceStat.mtime.toUTCString());
      res.sendFile(sourcePath);
      return;
    }

    // Thumbnail mit Cache
    const cachePath = join(CACHE_DIR, `${width}_${filename}.webp`);
    const cacheStat = await stat(cachePath).catch(() => null);
    if (cacheStat && cacheStat.mtimeMs >= sourceStat.mtimeMs) {
      res.setHeader('Content-Type', 'image/webp');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.sendFile(cachePath, { dotfiles: 'allow' });
      return;
    }

    // Cache-Miss: encoden
    try {
      const buffer = await sharp(sourcePath)
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();

      res.setHeader('Content-Type', 'image/webp');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.send(buffer);

      const tmpPath = `${cachePath}.${randomBytes(6).toString('hex')}.tmp`;
      writeFile(tmpPath, buffer)
        .then(() => rename(tmpPath, cachePath))
        .catch(async (err) => {
          this.logger.warn(`Cache-Write fehlgeschlagen: ${(err as Error).message}`);
          await unlink(tmpPath).catch(() => undefined);
        });
    } catch (err) {
      this.logger.warn(`Thumb fehlgeschlagen für ${filename}: ${err instanceof Error ? err.message : err}`);
      res.sendFile(sourcePath);
    }
  }

  @Post('image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads',
        filename: (_req, file, cb) => {
          const ext = extname(file.originalname).toLowerCase();
          cb(null, `${randomUUID()}${ext}`);
        },
      }),
      limits: { fileSize: MAX_SIZE_BYTES },
      fileFilter: (_req, file, cb) => {
        if (!ALLOWED_MIMES.has(file.mimetype)) {
          cb(new Error('Nicht unterstützter Dateityp'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  uploadImage(@UploadedFile() file: Express.Multer.File): { path: string } {
    return { path: `/api/uploads/${file.filename}` };
  }
}
