import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const { Agent } = require('undici');

/** Custom Agent für Ollama: lange Timeouts da CPU-Inferenz Minuten dauern kann. */
const ollamaAgent = new Agent({
  headersTimeout: 30 * 60 * 1000,
  bodyTimeout: 30 * 60 * 1000,
  keepAliveTimeout: 60 * 1000,
});

export interface OllamaGenerateOptions {
  model: string;
  prompt: string;
  system?: string;
  images?: string[]; // base64 encoded
  format?: 'json' | object;
  /** seconds, default 1800 (30 min — CPU inference is slow, multiple stages possible) */
  timeoutSec?: number;
  /** Output-Token-Limit (num_predict). Default 8192. Erhöhen für sehr lange JSON-Outputs. */
  maxTokens?: number;
  /** Context-Window (num_ctx). Default 16384. Erhöhen wenn Prompt sehr lang ist. */
  contextSize?: number;
  /** Optional tag for queue inspection (e.g. "wine:stage1", "recipe:image", "voice") */
  tag?: string;
  /** Optional human-readable stage info, e.g. "1/2 OCR" */
  stage?: string;
}

interface OllamaGenerateResponse {
  response: string;
  done: boolean;
  total_duration?: number;
}

export interface QueueEntry {
  id: number;
  tag: string;
  stage: string | null;
  model: string;
  status: 'waiting' | 'running' | 'cancelled';
  enqueuedAt: number;
  startedAt: number | null;
  /** ETA in ms based on history of recent runs with same tag, null if unknown. */
  etaMs: number | null;
}

class CancelledError extends Error {
  constructor() {
    super('Cancelled by user');
    this.name = 'CancelledError';
  }
}

@Injectable()
export class OllamaService {
  private readonly logger = new Logger(OllamaService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string | null;
  readonly visionModel: string;
  readonly textModel: string;

  /** Sequentielle Queue: Ollama auf CPU verträgt nur 1 Request gleichzeitig sauber. */
  private chain: Promise<unknown> = Promise.resolve();
  private queueDepth = 0;
  private nextEntryId = 1;
  private readonly entries = new Map<number, QueueEntry>();
  /** AbortController pro Entry — erlaubt Stoppen des HTTP-Requests. */
  private readonly aborters = new Map<number, AbortController>();
  /** IDs die abgebrochen wurden bevor sie liefen — sollen direkt CancelledError werfen. */
  private readonly cancelled = new Set<number>();
  /** Historie der Laufzeiten pro Tag (für ETA-Median). Max 10 Einträge pro Tag. */
  private readonly history = new Map<string, number[]>();

  /** Snapshot der aktuellen Queue für Admin-View. */
  getQueueSnapshot(): QueueEntry[] {
    return Array.from(this.entries.values()).sort((a, b) => a.enqueuedAt - b.enqueuedAt);
  }

  private estimateMs(tag: string): number | null {
    const arr = this.history.get(tag);
    if (!arr || arr.length === 0) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]; // Median
  }

  private recordDuration(tag: string, ms: number): void {
    const arr = this.history.get(tag) ?? [];
    arr.push(ms);
    if (arr.length > 10) arr.shift();
    this.history.set(tag, arr);
  }

  /** Bricht einen Queue-Eintrag ab. Wartend → wird übersprungen. Laufend → fetch wird aborted (Ollama selbst rechnet trotzdem zu Ende). */
  cancel(entryId: number): boolean {
    const entry = this.entries.get(entryId);
    if (!entry) return false;
    this.cancelled.add(entryId);
    entry.status = 'cancelled';
    const aborter = this.aborters.get(entryId);
    if (aborter) {
      aborter.abort();
    }
    this.logger.log(`Ollama-Queue: Cancel angefordert für #${entryId} [${entry.tag}]`);
    return true;
  }

  /** Bricht ALLE Queue-Einträge ab. Unload läuft im Hintergrund (kann lange dauern). */
  async cancelAllAndUnload(): Promise<{ cancelled: number }> {
    const ids = Array.from(this.entries.keys());
    for (const id of ids) {
      this.cancel(id);
    }
    const cancelled = ids.length;

    // Models entladen im Hintergrund — nicht warten
    void this.unloadAllModels().catch((err) => {
      this.logger.warn(`Background-Unload fehlgeschlagen: ${(err as Error).message}`);
    });

    this.logger.log(`Ollama-Queue: ${cancelled} Einträge abgebrochen, Unload läuft im Hintergrund`);
    return { cancelled };
  }

  private async unloadAllModels(): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const psRes = await fetch(`${this.baseUrl}/api/ps`, { signal: controller.signal, headers: this.buildHeaders() });
      if (!psRes.ok) return;
      const psData = (await psRes.json()) as { models?: { name: string }[] };
      for (const m of psData.models ?? []) {
        try {
          const unloadCtrl = new AbortController();
          const unloadTimeout = setTimeout(() => unloadCtrl.abort(), 30_000);
          await fetch(`${this.baseUrl}/api/generate`, {
            method: 'POST',
            headers: this.buildHeaders(),
            body: JSON.stringify({ model: m.name, prompt: '', keep_alive: 0, stream: false }),
            signal: unloadCtrl.signal,
          });
          clearTimeout(unloadTimeout);
          this.logger.log(`Model entladen: ${m.name}`);
        } catch (err) {
          this.logger.warn(`Unload fehlgeschlagen für ${m.name}: ${(err as Error).message}`);
        }
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  constructor() {
    this.baseUrl = (process.env.OLLAMA_BASE_URL ?? 'http://host.docker.internal:11434').replace(/\/+$/, '');
    this.apiKey = process.env.OLLAMA_API_KEY?.trim() || null;
    this.visionModel = process.env.OLLAMA_VISION_MODEL ?? 'ministral-3:14b';
    this.textModel = process.env.OLLAMA_TEXT_MODEL ?? 'ministral-3:14b';
    this.logger.log(`Ollama: ${this.baseUrl} | vision=${this.visionModel} | text=${this.textModel} | auth=${this.apiKey ? 'bearer' : 'none'}`);
  }

  /** Header-Set für Ollama-Requests. Setzt Bearer-Token wenn OLLAMA_API_KEY gesetzt
   *  (z.B. wenn OpenWebUI als Gateway davorgeschaltet ist). */
  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;
    return headers;
  }

  async generate(opts: OllamaGenerateOptions): Promise<string> {
    this.queueDepth++;
    const position = this.queueDepth;
    const entryId = this.nextEntryId++;
    const tag = opts.tag ?? 'unknown';
    const entry: QueueEntry = {
      id: entryId,
      tag,
      stage: opts.stage ?? null,
      model: opts.model,
      status: position === 1 ? 'running' : 'waiting',
      enqueuedAt: Date.now(),
      startedAt: position === 1 ? Date.now() : null,
      etaMs: this.estimateMs(tag),
    };
    this.entries.set(entryId, entry);
    if (position > 1) {
      this.logger.log(`Ollama-Queue: Warte auf Slot (Position ${position}) [${entry.tag}${entry.stage ? ' · ' + entry.stage : ''}]`);
    }
    const previous = this.chain;
    const runIfNotCancelled = async (): Promise<string> => {
      if (this.cancelled.has(entryId)) {
        throw new CancelledError();
      }
      entry.status = 'running';
      entry.startedAt = Date.now();
      return this.doGenerate(opts, entryId);
    };
    const current = previous.then(runIfNotCancelled, runIfNotCancelled);
    this.chain = current.then(
      () => undefined,
      () => undefined,
    );
    current.then(
      () => {
        if (entry.startedAt && !this.cancelled.has(entryId)) {
          this.recordDuration(tag, Date.now() - entry.startedAt);
        }
      },
      () => undefined,
    );
    current.finally(() => {
      this.queueDepth--;
      this.entries.delete(entryId);
      this.aborters.delete(entryId);
      this.cancelled.delete(entryId);
    });
    return current;
  }

  private async doGenerate(opts: OllamaGenerateOptions, entryId: number): Promise<string> {
    const url = `${this.baseUrl}/api/generate`;
    const timeoutMs = (opts.timeoutSec ?? 1800) * 1000;
    const controller = new AbortController();
    this.aborters.set(entryId, controller);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const body = {
      model: opts.model,
      prompt: opts.prompt,
      system: opts.system,
      images: opts.images,
      format: opts.format,
      stream: false,
      think: false,
      options: {
        temperature: 0.2,
        // Output-Token-Budget. Default war 2048 — bei strukturierten JSON-Outputs
        // mit 5+ Items + Makros wird das schnell mid-stream abgeschnitten.
        // 8192 reicht auch für 15-Zutaten-Disambiguation komplett.
        num_predict: opts.maxTokens ?? 8192,
        // Context-Window. Ohne explizite Angabe nimmt Ollama den Modellfile-
        // Default (oft nur 2k/4k). Bei großen Prompts (z.B. BLS-Kandidaten +
        // Rezeptzutaten + Schritte) reicht das nicht. 16k ist ein guter
        // Mittelwert für 31B-Modelle und passt RAM-mäßig auch noch.
        num_ctx: opts.contextSize ?? 16384,
      },
    };

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(body),
        signal: controller.signal,
        // @ts-expect-error undici dispatcher option
        dispatcher: ollamaAgent,
      });

      if (!res.ok) {
        const text = await res.text();
        this.logger.error(`Ollama HTTP ${res.status}: ${text.slice(0, 500)}`);
        throw new ServiceUnavailableException(
          `Ollama-Fehler: HTTP ${res.status}. Läuft Ollama auf ${this.baseUrl}?`,
        );
      }

      const data = (await res.json()) as OllamaGenerateResponse;
      return data.response.trim();
    } catch (err: unknown) {
      if (err instanceof ServiceUnavailableException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('aborted')) {
        throw new ServiceUnavailableException(
          `Ollama-Anfrage hat ${opts.timeoutSec ?? 1800}s überschritten. Modell zu langsam oder nicht geladen.`,
        );
      }
      this.logger.error(`Ollama call failed: ${msg}`);
      throw new ServiceUnavailableException(
        `Ollama nicht erreichbar (${this.baseUrl}). Läuft 'ollama serve'?`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Robust JSON-extractor: Ollama's `format: 'json'` is reliable, but some models
   * still wrap output in markdown fences or add prose. Strip and parse.
   */
  parseJson<T>(raw: string): T {
    let cleaned = raw.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }
    try {
      return JSON.parse(cleaned) as T;
    } catch (err) {
      this.logger.error(`JSON parse failed. Raw: ${raw.slice(0, 800)}`);
      throw new ServiceUnavailableException(
        'KI-Antwort konnte nicht als JSON gelesen werden. Bitte erneut versuchen.',
      );
    }
  }
}
