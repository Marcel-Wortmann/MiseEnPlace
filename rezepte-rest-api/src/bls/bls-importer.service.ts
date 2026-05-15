import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import * as XLSX from 'xlsx';
import { PrismaService } from '../prisma/prisma.service';
import { normalize } from './bls.service';

interface BlsRow {
  code: string;
  name: string;
  nameEn: string | null;
  kcalPer100g: number;
  proteinPer100g: number | null;
  carbsPer100g: number | null;
  fatPer100g: number | null;
  fiberPer100g: number | null;
}

const DATA_DIR = process.env.BLS_DATA_DIR ?? '/app/data';
const FILENAMES = [
  'BLS_4_0_Daten_2025_DE.xlsx',
  'BLS_4_0_Daten.xlsx',
  'bls.xlsx',
  'bls.csv',
];

interface ColumnMap {
  code: number;
  name: number;
  nameEn: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
}

@Injectable()
export class BlsImporterService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BlsImporterService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.importIfNeeded();
    } catch (err) {
      this.logger.error(`BLS-Import fehlgeschlagen: ${(err as Error).message}`);
      this.logger.warn('Backend startet ohne BLS-Daten weiter — Calorie-Estimator nutzt LLM-Fallback.');
    }
  }

  private async importIfNeeded(): Promise<void> {
    const file = this.locateFile();
    if (!file) {
      this.logger.warn(
        `Keine BLS-Datei in ${DATA_DIR} gefunden. Erwartet: ${FILENAMES.join(', ')}. ` +
          `Calorie-Estimator nutzt LLM-Fallback. ` +
          `Datei kann unter https://blsdb.de/download (CC BY 4.0) heruntergeladen werden.`,
      );
      return;
    }

    const existing = await this.prisma.bls.count();
    if (existing > 0) {
      // Prüfe ob bereits Makros vorhanden — wenn nicht, re-import erzwingen
      const sample = await this.prisma.bls.findFirst({
        where: { proteinPer100g: { not: null } },
      });
      if (sample) {
        this.logger.log(`BLS bereits importiert (${existing} Einträge mit Makros). Überspringe Import.`);
        return;
      }
      this.logger.log(`BLS hat ${existing} Einträge ohne Makros — re-importiere…`);
      await this.prisma.bls.deleteMany({});
    }

    this.logger.log(`Importiere BLS aus ${file}…`);
    const rows = file.endsWith('.csv') ? this.readCsv(file) : this.readXlsx(file);
    this.logger.log(`${rows.length} Einträge gelesen, schreibe in DB…`);

    const chunkSize = 500;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      await this.prisma.bls.createMany({
        data: chunk.map((r) => ({
          code: r.code,
          name: r.name,
          nameEn: r.nameEn,
          kcalPer100g: r.kcalPer100g,
          proteinPer100g: r.proteinPer100g,
          carbsPer100g: r.carbsPer100g,
          fatPer100g: r.fatPer100g,
          fiberPer100g: r.fiberPer100g,
          searchKey: normalize(`${r.name} ${r.nameEn ?? ''}`),
        })),
        skipDuplicates: true,
      });
    }
    const total = await this.prisma.bls.count();
    this.logger.log(`BLS-Import abgeschlossen: ${total} Einträge in DB (mit Makros).`);
  }

  private locateFile(): string | null {
    for (const name of FILENAMES) {
      const full = join(DATA_DIR, name);
      if (existsSync(full)) return full;
    }
    return null;
  }

  /**
   * Liest BLS-Excel. Sucht alle Nährwert-Spalten dynamisch per Header-Code:
   *   ENERCC = kcal, PROT625 = Protein, CHO = Kohlenhydrate, FAT = Fett, FIBT = Ballaststoffe
   */
  private readXlsx(path: string): BlsRow[] {
    const wb = XLSX.readFile(path, { cellDates: false, cellNF: false });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
    if (aoa.length < 2) return [];

    const header = aoa[0].map((c) => String(c ?? '').trim());
    const cols = this.findColumns(header);
    if (cols.kcal === -1) {
      throw new Error(
        `Konnte ENERCC-Spalte im BLS-Header nicht finden: ${header.slice(0, 10).join(' | ')}…`,
      );
    }
    this.logger.log(
      `BLS Header: code=${cols.code}, name=${cols.name}, kcal=${cols.kcal}, protein=${cols.protein}, carbs=${cols.carbs}, fat=${cols.fat}, fiber=${cols.fiber}`,
    );

    const rows: BlsRow[] = [];
    for (let i = 1; i < aoa.length; i++) {
      const r = aoa[i];
      if (!r) continue;
      const code = r[cols.code] != null ? String(r[cols.code]).trim() : '';
      const name = r[cols.name] != null ? String(r[cols.name]).trim() : '';
      const nameEn = r[cols.nameEn] != null ? String(r[cols.nameEn]).trim() : null;
      if (!code || !name) continue;

      const kcal = this.parseNumeric(r[cols.kcal]);
      if (kcal === null || kcal < 0 || kcal > 1500) continue;

      rows.push({
        code,
        name,
        nameEn: nameEn || null,
        kcalPer100g: kcal,
        proteinPer100g: cols.protein !== -1 ? this.parseNutrient(r[cols.protein]) : null,
        carbsPer100g: cols.carbs !== -1 ? this.parseNutrient(r[cols.carbs]) : null,
        fatPer100g: cols.fat !== -1 ? this.parseNutrient(r[cols.fat]) : null,
        fiberPer100g: cols.fiber !== -1 ? this.parseNutrient(r[cols.fiber]) : null,
      });
    }
    return rows;
  }

  private readCsv(path: string): BlsRow[] {
    const content = readFileSync(path, 'utf-8');
    const lines = content.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return [];

    const sep = lines[0].includes(';') ? ';' : ',';
    const header = lines[0].split(sep).map((c) => c.trim());
    const cols = this.findColumns(header);
    if (cols.kcal === -1) {
      throw new Error(`CSV-Header enthält keine ENERCC/kcal-Spalte: ${header.join(' | ')}`);
    }

    const rows: BlsRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(sep);
      const code = cells[cols.code]?.trim() ?? '';
      const name = cells[cols.name]?.trim() ?? '';
      const nameEn = cells[cols.nameEn]?.trim() || null;
      if (!code || !name) continue;
      const kcal = this.parseNumeric(cells[cols.kcal]);
      if (kcal === null || kcal < 0 || kcal > 1500) continue;
      rows.push({
        code,
        name,
        nameEn,
        kcalPer100g: kcal,
        proteinPer100g: cols.protein !== -1 ? this.parseNutrient(cells[cols.protein]) : null,
        carbsPer100g: cols.carbs !== -1 ? this.parseNutrient(cells[cols.carbs]) : null,
        fatPer100g: cols.fat !== -1 ? this.parseNutrient(cells[cols.fat]) : null,
        fiberPer100g: cols.fiber !== -1 ? this.parseNutrient(cells[cols.fiber]) : null,
      });
    }
    return rows;
  }

  /**
   * Findet alle Nährwert-Spalten im Header. Matching auf BLS-Standard-Codes:
   *   ENERCC, PROT625, CHO, FAT, FIBT
   */
  private findColumns(header: string[]): ColumnMap {
    const find = (...patterns: RegExp[]): number => {
      for (let i = 0; i < header.length; i++) {
        const h = header[i];
        // Datenherkunft/Referenz-Spalten ausschließen
        if (/datenherkunft|referenz/i.test(h)) continue;
        for (const p of patterns) {
          if (p.test(h)) return i;
        }
      }
      return -1;
    };
    return {
      code: 0,
      name: 1,
      nameEn: 2,
      kcal: find(/\bENERCC\b/, /kcal\/100g/i),
      protein: find(/\bPROT625\b/, /^Protein/i),
      carbs: find(/\bCHO\b/, /Kohlenhydrate, verfügbar/i),
      fat: find(/\bFAT\b/, /^Fett \[g\/100g\]/i),
      fiber: find(/\bFIBT\b/, /Ballaststoffe, gesamt/i),
    };
  }

  /** Nährwert parsen — leer/`-` → null, sonst Zahl. */
  private parseNutrient(v: unknown): number | null {
    if (v === null || v === undefined || v === '' || v === '-') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const s = String(v).trim().replace(',', '.');
    if (s === '-' || s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  private parseNumeric(v: unknown): number | null {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const s = String(v).trim().replace(',', '.');
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
}
