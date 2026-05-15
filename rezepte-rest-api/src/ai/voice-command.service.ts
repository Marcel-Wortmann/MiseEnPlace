import { Injectable, Logger } from '@nestjs/common';
import { OllamaService } from './ollama.service';
import { VoiceCommandDto, VoiceCommandResult } from './dto/voice-command.dto';

const SYSTEM_PROMPT = `Du bist ein Sprachassistent für ein Kochbuch. Der User kocht gerade und stellt Fragen oder gibt Befehle per Sprache.

Du erhältst:
- Den Befehl/die Frage des Users
- Den Rezepttitel, alle Zutaten und alle Schritte
- Den aktuellen Schritt (falls bekannt)

Antworte IMMER mit einem JSON-Objekt:
{
  "type": "navigate" | "answer" | "unknown",
  "action": "next" | "prev" | "repeat" | "step:N" | "ingredients" | "pause" | "exit",
  "message": "..."
}

Regeln:
1. Wenn der User explizit navigieren will (nächster, vorheriger, wiederhole, Schritt 3, Zutaten zeigen, pause, beenden), nutze type: "navigate" mit der entsprechenden action.
2. Wenn der User eine inhaltliche Frage stellt (z.B. "was muss ich schälen", "was kann ich vorbereiten", "wie viel Mehl brauche ich", "lies Schritt 3 vor"), nutze type: "answer" mit einer kurzen, klaren Antwort auf Deutsch (max 2-3 Sätze).
3. Wenn unklar: type: "unknown" mit kurzer Klarstellung in message.

Bei "lies Schritt N vor": type: "answer", message: kompletter Schritttext.
Antworten in natürlichem, gesprochenem Deutsch — der User hört sie nicht, sondern liest sie kurz auf einem Toast.`;

@Injectable()
export class VoiceCommandService {
  private readonly logger = new Logger(VoiceCommandService.name);

  constructor(private readonly ollama: OllamaService) {}

  async interpret(dto: VoiceCommandDto): Promise<VoiceCommandResult> {
    const local = this.tryLocal(dto.command);
    if (local) return local;

    const stepsList = dto.steps
      .map((s) => `${s.order}. ${s.text}`)
      .join('\n');
    const ingList = dto.ingredients
      .map((i) => `- ${i.amount ?? ''} ${i.unit ?? ''} ${i.name}`.trim())
      .join('\n');

    const userPrompt = `Rezept: ${dto.recipeTitle}
Aktueller Schritt: ${dto.currentStep ?? '(unbekannt)'}

ZUTATEN:
${ingList}

SCHRITTE:
${stepsList}

USER-BEFEHL: "${dto.command}"

Antworte als JSON.`;

    try {
      const raw = await this.ollama.generate({
        model: this.ollama.textModel,
        system: SYSTEM_PROMPT,
        prompt: userPrompt,
        format: 'json',
        timeoutSec: 60,
        tag: 'voice-command',
      });
      const parsed = this.ollama.parseJson<VoiceCommandResult>(raw);
      if (parsed.type === 'navigate' && parsed.action) {
        return { type: 'navigate', action: parsed.action };
      }
      if (parsed.type === 'answer' && parsed.message) {
        return { type: 'answer', message: parsed.message };
      }
      return { type: 'unknown', message: parsed.message ?? 'Befehl nicht verstanden' };
    } catch (err) {
      this.logger.warn(`Voice-Command fehlgeschlagen: ${err instanceof Error ? err.message : err}`);
      return { type: 'unknown', message: 'Konnte den Befehl gerade nicht verarbeiten.' };
    }
  }

  /** Schnelle regelbasierte Treffer ohne LLM für die häufigsten Befehle */
  private tryLocal(commandRaw: string): VoiceCommandResult | null {
    const cmd = commandRaw.toLowerCase().trim();
    if (/(nächst|weiter|als nächstes)/.test(cmd)) return { type: 'navigate', action: 'next' };
    if (/(vorher|zurück|davor)/.test(cmd)) return { type: 'navigate', action: 'prev' };
    if (/(wiederhol|nochmal|wiederholen)/.test(cmd)) return { type: 'navigate', action: 'repeat' };
    if (/(zutaten|was brauch)/.test(cmd) && !/wie viel/.test(cmd)) {
      return { type: 'navigate', action: 'ingredients' };
    }
    if (/(pause|stopp|halt)/.test(cmd)) return { type: 'navigate', action: 'pause' };
    if (/(beenden|ende|aufhören|fertig)/.test(cmd)) return { type: 'navigate', action: 'exit' };
    const stepMatch = cmd.match(/(?:gehe zu |zeig |zu |zum )?schritt (\d+|eins|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn)/);
    if (stepMatch && !/lies|vor/.test(cmd)) {
      const n = this.wordToNum(stepMatch[1]);
      if (n) return { type: 'navigate', action: `step:${n}` };
    }
    return null;
  }

  private wordToNum(s: string): number | null {
    const map: Record<string, number> = {
      eins: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10,
    };
    if (map[s]) return map[s];
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : null;
  }
}
