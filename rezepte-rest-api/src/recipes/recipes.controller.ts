import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Express } from 'express';
import { promises as dns } from 'dns';
import { isIP } from 'net';
import { RecipesService } from './recipes.service';
import { UploadService } from '../upload/upload.service';
import { RecipeExtractorService } from '../ai/recipe-extractor.service';
import { CreateRecipeDto } from './dto/create-recipe.dto';
import { UpdateRecipeDto } from './dto/update-recipe.dto';
import { CreateFromUrlDto } from './dto/create-from-url.dto';
import { CurrentUser, AuthUser } from '../auth/decorators/current-user.decorator';
import { Recipe } from '@shared/interfaces/recipe.interface';

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_HTML_BYTES = 5 * 1024 * 1024;

/**
 * Prüft ob eine IP in einem privaten/internen Bereich liegt.
 * Schützt gegen SSRF-Angriffe via from-url (z.B. AWS-Metadata-Service,
 * interne Docker-Services, localhost).
 */
function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 169 && parts[1] === 254) return true; // Link-Local + AWS-Metadata
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 0) return true;
    if (parts[0] >= 224) return true; // Multicast/Reserved
    return false;
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // Unique-Local
    if (lower.startsWith('fe80')) return true; // Link-Local
    if (lower.startsWith('::ffff:')) {
      // IPv4-mapped — IPv4-Teil prüfen
      const v4 = lower.slice(7);
      return isPrivateIp(v4);
    }
    return false;
  }
  return false;
}

@Controller('recipes')
export class RecipesController {
  constructor(
    private readonly recipesService: RecipesService,
    private readonly uploadService: UploadService,
    private readonly extractor: RecipeExtractorService,
  ) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser): Promise<Recipe[]> {
    return this.recipesService.findAllForUser(user.userId);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Recipe> {
    return this.recipesService.findOneForUser(id, user.userId);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRecipeDto): Promise<Recipe> {
    return this.recipesService.create(user.userId, dto);
  }

  @Post('from-image')
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: MAX_BYTES } }))
  async createFromImage(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: { hintTitle?: string; hintDescription?: string },
  ): Promise<Recipe> {
    if (!file) throw new BadRequestException('Kein Bild empfangen.');
    if (!ALLOWED_MIME.includes(file.mimetype)) {
      throw new BadRequestException('Nur JPEG, PNG oder WebP erlaubt.');
    }
    const saved = await this.uploadService.saveBuffer(file.buffer, file.originalname);
    return this.recipesService.createFromImageAsync(user.userId, saved.path, {
      title: body?.hintTitle ?? null,
      description: body?.hintDescription ?? null,
    });
  }

  @Post('from-url')
  async createFromUrl(@CurrentUser() user: AuthUser, @Body() dto: CreateFromUrlDto) {
    // SSRF-Schutz: URL parsen, Hostname auflösen, private IPs blockieren
    let parsed: URL;
    try {
      parsed = new URL(dto.url);
    } catch {
      throw new BadRequestException('URL ist nicht gültig.');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new BadRequestException('Nur http(s) erlaubt.');
    }
    if (parsed.username || parsed.password) {
      throw new BadRequestException('URL mit User-Info nicht erlaubt.');
    }

    // DNS-Auflösung — verhindert dass z.B. localhost.evil.com auf 127.0.0.1 zeigt
    const hostname = parsed.hostname;
    let addresses: string[];
    try {
      const directIp = isIP(hostname);
      if (directIp) {
        addresses = [hostname];
      } else {
        const lookups = await dns.lookup(hostname, { all: true });
        addresses = lookups.map((l) => l.address);
      }
    } catch {
      throw new BadRequestException('Hostname konnte nicht aufgelöst werden.');
    }
    if (addresses.length === 0) {
      throw new BadRequestException('Hostname konnte nicht aufgelöst werden.');
    }
    for (const ip of addresses) {
      if (isPrivateIp(ip)) {
        throw new BadRequestException('URL verweist auf eine interne Adresse — nicht erlaubt.');
      }
    }

    let html: string;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(dto.url, {
        signal: controller.signal,
        redirect: 'manual', // kein Auto-Follow — Redirect könnte interne Adresse sein
        headers: {
          'User-Agent':
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'de-DE,de;q=0.9,en;q=0.5',
        },
      });
      clearTimeout(timeout);
      // 3xx → könnte intern umleiten, daher manuell ablehnen
      if (res.status >= 300 && res.status < 400) {
        throw new BadRequestException('URL leitet weiter — bitte finale URL angeben.');
      }
      if (!res.ok) {
        throw new BadRequestException(`URL nicht erreichbar (HTTP ${res.status}).`);
      }
      const contentType = res.headers.get('content-type') ?? '';
      if (contentType && !/text\/html|application\/xhtml/i.test(contentType)) {
        throw new BadRequestException(`Inhaltstyp wird nicht unterstützt: ${contentType}`);
      }
      // Größenlimit
      const reader = res.body?.getReader();
      if (!reader) {
        html = await res.text();
      } else {
        const chunks: Uint8Array[] = [];
        let total = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.length;
          if (total > MAX_HTML_BYTES) {
            controller.abort();
            throw new BadRequestException('Webseite ist zu groß (>5 MB).');
          }
          chunks.push(value);
        }
        html = Buffer.concat(chunks).toString('utf-8');
      }
    } catch (err: unknown) {
      if (err instanceof BadRequestException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(`URL konnte nicht geladen werden: ${msg}`);
    }

    const jsonLd = this.extractor.parseJsonLd(html);
    if (jsonLd && jsonLd.title && jsonLd.ingredients.length > 0) {
      return { mode: 'sync', draft: jsonLd };
    }

    const microdata = this.extractor.parseMicrodata(html);
    if (microdata && microdata.title && microdata.ingredients.length > 0) {
      return { mode: 'sync', draft: microdata };
    }

    const plugin = this.extractor.parseRecipeCardPlugin(html);
    if (plugin && plugin.title && plugin.ingredients.length >= 2) {
      return { mode: 'sync', draft: plugin };
    }

    const heuristic = this.extractor.parseHeuristic(html);
    if (heuristic && heuristic.title && heuristic.ingredients.length >= 2 && heuristic.steps.length > 0) {
      return { mode: 'sync', draft: heuristic };
    }

    const text = this.extractor.htmlToText(html);
    if (text.length < 100) {
      throw new BadRequestException('Webseite enthielt zu wenig lesbaren Text.');
    }
    const recipe = await this.recipesService.createFromUrlAsync(user.userId, dto.url, text);
    return { mode: 'async', recipe };
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRecipeDto,
  ): Promise<Recipe> {
    return this.recipesService.update(id, user.userId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.recipesService.remove(id, user.userId);
  }
}
