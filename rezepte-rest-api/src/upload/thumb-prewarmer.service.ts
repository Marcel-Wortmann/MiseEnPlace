import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { promises as fs } from 'fs';
import { join } from 'path';
import sharp from 'sharp';

const WIDTHS = [240, 480, 768];
const SOURCE_DIR = join(process.cwd(), 'uploads');
const CACHE_DIR = join(SOURCE_DIR, '.thumbs');
const VALID_EXT = /\.(jpe?g|png|webp)$/i;

/**
 * Erzeugt fehlende Thumbs beim Boot. Vermeidet First-Request-Lag der
 * ThumbMiddleware. Läuft im Hintergrund, blockt nicht den Bootstrap.
 * Im Throttle: 1 Bild parallel, kleine Pause — CX43 hat nur 4 vCPU.
 */
@Injectable()
export class ThumbPrewarmerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ThumbPrewarmerService.name);

  onApplicationBootstrap(): void {
    setImmediate(() => {
      this.warmAll().catch((err) => this.logger.warn(`Thumb-Prewarmer Fehler: ${(err as Error).message}`));
    });
  }

  private async warmAll(): Promise<void> {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    let files: string[];
    try {
      files = await fs.readdir(SOURCE_DIR);
    } catch {
      return;
    }
    const images = files.filter((f) => VALID_EXT.test(f) && !f.startsWith('.'));
    if (images.length === 0) return;
    this.logger.log(`Thumb-Prewarmer: prüfe ${images.length} Bilder, ${WIDTHS.length} Größen`);

    let created = 0;
    let skipped = 0;
    for (const filename of images) {
      const sourcePath = join(SOURCE_DIR, filename);
      let sourceMtime: number;
      try {
        sourceMtime = (await fs.stat(sourcePath)).mtimeMs;
      } catch {
        continue;
      }

      for (const w of WIDTHS) {
        const cachePath = join(CACHE_DIR, `${w}_${filename}.webp`);
        const cacheMtime = await fs
          .stat(cachePath)
          .then((s) => s.mtimeMs)
          .catch(() => 0);
        if (cacheMtime >= sourceMtime) {
          skipped++;
          continue;
        }
        try {
          await sharp(sourcePath).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: 80 }).toFile(cachePath);
          created++;
        } catch (err) {
          this.logger.warn(`Thumb ${w} für ${filename} fehlgeschlagen: ${(err as Error).message}`);
        }
        // CPU-Schoner — kurze Pause zwischen den Bildern
        await new Promise((r) => setTimeout(r, 30));
      }
    }
    this.logger.log(`Thumb-Prewarmer fertig: ${created} erzeugt, ${skipped} übersprungen`);
  }
}
