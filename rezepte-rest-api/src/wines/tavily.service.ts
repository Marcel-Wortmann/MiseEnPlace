import { Injectable, Logger } from '@nestjs/common';

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

interface TavilyResponse {
  answer?: string;
  results?: TavilyResult[];
}

@Injectable()
export class TavilyService {
  private readonly logger = new Logger(TavilyService.name);
  private readonly apiKey = process.env.TAVILY_API_KEY ?? '';

  get enabled(): boolean {
    return this.apiKey.length > 0;
  }

  /**
   * Sucht nach Wein-Infos. Gibt formatierten Snippet-Text zurück oder null bei Fehler.
   */
  async searchWine(query: string): Promise<string | null> {
    if (!this.enabled) {
      this.logger.debug('Tavily disabled (no API key)');
      return null;
    }
    if (!query.trim()) return null;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: this.apiKey,
          query: `Wein ${query}`,
          search_depth: 'advanced',
          include_answer: true,
          max_results: 6,
        }),
      });
      clearTimeout(timeout);
      if (!res.ok) {
        this.logger.warn(`Tavily HTTP ${res.status}`);
        return null;
      }
      const data = (await res.json()) as TavilyResponse;
      const parts: string[] = [];
      if (data.answer) parts.push(`Zusammenfassung: ${data.answer}`);
      // Nur Treffer mit ausreichender Relevanz aufnehmen — vermeidet, dass Stage 2
      // Beschreibungen eines anderen Weins übernimmt
      const relevant = (data.results ?? []).filter((r) => (r.score ?? 0) >= 0.65);
      if (relevant.length > 0) {
        parts.push('Quellen:');
        relevant.slice(0, 6).forEach((r, i) => {
          parts.push(`${i + 1}. [score ${r.score.toFixed(2)}] ${r.title}\n   ${r.content.slice(0, 600)}`);
        });
      } else if (data.results?.length) {
        this.logger.log(`Tavily: ${data.results.length} Treffer, aber keiner mit score ≥ 0.6 — verworfen`);
      }
      const out = parts.join('\n');
      this.logger.log(`Tavily search '${query}' → ${out.length} chars (${relevant.length} relevant)`);
      return out.length > 0 ? out : null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Tavily search failed: ${msg}`);
      return null;
    }
  }
}
