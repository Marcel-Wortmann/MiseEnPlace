import { Injectable, NgZone, inject, signal } from '@angular/core';

interface SpeechRecognitionEventLike {
  results: ArrayLike<{ 0: { transcript: string; confidence: number }; isFinal: boolean }>;
  resultIndex: number;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

interface WindowWithSpeech extends Window {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
}

const WAKEWORDS = ['hey rezeptbuch', 'hey rezept', 'rezeptbuch'];

export type VoiceState = 'idle' | 'listening' | 'awaiting-command' | 'processing' | 'unsupported';

@Injectable({ providedIn: 'root' })
export class VoiceService {
  private readonly zone = inject(NgZone);
  private recognition: SpeechRecognitionLike | null = null;
  private active = false;
  private commandTimer: ReturnType<typeof setTimeout> | null = null;

  readonly state = signal<VoiceState>('idle');
  readonly transcript = signal<string>('');
  /** Wird gesetzt wenn ein Befehl erkannt wurde (kompletter Satz nach Wakeword) */
  readonly command = signal<string | null>(null);

  isSupported(): boolean {
    const w = window as WindowWithSpeech;
    return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
  }

  start(): void {
    if (!this.isSupported()) {
      this.state.set('unsupported');
      return;
    }
    if (this.active) return;
    this.active = true;
    this.spawnRecognition();
  }

  stop(): void {
    this.active = false;
    if (this.commandTimer) {
      clearTimeout(this.commandTimer);
      this.commandTimer = null;
    }
    if (this.recognition) {
      try { this.recognition.abort(); } catch { /* ignore */ }
      this.recognition = null;
    }
    this.state.set('idle');
    this.transcript.set('');
  }

  consumeCommand(): string | null {
    const c = this.command();
    this.command.set(null);
    return c;
  }

  private spawnRecognition(): void {
    if (!this.active) return;
    const w = window as WindowWithSpeech;
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'de-DE';

    rec.onresult = (e) => {
      this.zone.run(() => this.handleResult(e));
    };
    rec.onerror = (e) => {
      // 'no-speech' und 'aborted' sind normal — einfach neu starten
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
        // eslint-disable-next-line no-console
        console.warn('[Voice] error:', e.error);
      }
    };
    rec.onend = () => {
      this.zone.run(() => {
        // Browser stoppt häufig (60s-Limit oder Stille auf Mobile).
        // 2s Delay reduziert Bimmeln deutlich. Risiko: kurze Lücke ohne Listening.
        if (this.active) {
          setTimeout(() => this.spawnRecognition(), 2000);
        }
      });
    };

    this.recognition = rec;
    try {
      rec.start();
      if (this.state() === 'idle') this.state.set('listening');
    } catch {
      // Bereits gestartet — ignorieren
    }
  }

  /** Setzt den Processing-Lock. Solange aktiv werden alle Transcripts verworfen. */
  setProcessing(processing: boolean): void {
    if (processing) {
      // Lock setzen — laufender awaiting-Timer abbrechen, Transcript leeren
      if (this.commandTimer) {
        clearTimeout(this.commandTimer);
        this.commandTimer = null;
      }
      this.transcript.set('');
      this.state.set('processing');
    } else if (this.state() === 'processing') {
      // Nach Lock zurück auf listening (sofern Service noch aktiv)
      if (this.active) {
        this.state.set('listening');
      } else {
        this.state.set('idle');
      }
    }
  }

  private handleResult(e: SpeechRecognitionEventLike): void {
    // Mic-Lock: während Backend-Call oder TTS keine Transcripts auswerten
    if (this.state() === 'processing') return;

    const results = Array.from({ length: e.results.length }, (_, i) => e.results[i]);
    const latest = results.slice(e.resultIndex);
    for (const r of latest) {
      const text = r[0].transcript.trim().toLowerCase();
      this.transcript.set(text);

      if (this.state() === 'listening') {
        const wakeIdx = this.findWakeword(text);
        if (wakeIdx >= 0) {
          // Rest der Phrase ist evtl. schon der Befehl
          const after = this.stripWakewords(text.slice(wakeIdx));
          if (after.length > 2 && r.isFinal) {
            this.fireCommand(after);
            return;
          }
          this.state.set('awaiting-command');
          this.armCommandTimeout();
        }
      } else if (this.state() === 'awaiting-command' && r.isFinal) {
        this.fireCommand(text);
        return;
      }
    }
  }

  private findWakeword(text: string): number {
    for (const w of WAKEWORDS) {
      const idx = text.indexOf(w);
      if (idx >= 0) return idx;
    }
    return -1;
  }

  /**
   * Entfernt ALLE Vorkommen von Wakewords aus einem Text (nicht nur am Anfang).
   * Wichtig: Wenn `interimResults=true` ist, enthält der Final-Result oft das
   * Wakeword nochmal mit. Ohne Stripping landet "hey rezeptbuch was kommt jetzt"
   * komplett im Backend-LLM und verwirrt es.
   */
  private stripWakewords(text: string): string {
    let cleaned = text;
    // Längste zuerst, sonst bleiben Reste übrig (z.B. "hey rezept" bei "hey rezeptbuch")
    const sorted = [...WAKEWORDS].sort((a, b) => b.length - a.length);
    for (const w of sorted) {
      cleaned = cleaned.split(w).join(' ');
    }
    // Mehrfache Whitespaces & führende/hinten Satzzeichen aufräumen
    return cleaned.replace(/\s+/g, ' ').replace(/^[\s,.!?]+|[\s,.!?]+$/g, '').trim();
  }

  private armCommandTimeout(): void {
    if (this.commandTimer) clearTimeout(this.commandTimer);
    this.commandTimer = setTimeout(() => {
      this.zone.run(() => {
        if (this.state() === 'awaiting-command') {
          this.state.set('listening');
          this.transcript.set('');
        }
      });
    }, 6000);
  }

  private fireCommand(text: string): void {
    if (this.commandTimer) {
      clearTimeout(this.commandTimer);
      this.commandTimer = null;
    }
    // Defensiv: auch hier nochmal Wakewords strippen — falls Aufrufer rohen Text übergibt
    const cleaned = this.stripWakewords(text);
    if (cleaned.length < 2) {
      // Reines Wakeword ohne Befehl → kein Command feuern
      this.state.set('listening');
      this.transcript.set('');
      return;
    }
    this.command.set(cleaned);
    this.state.set('listening');
    this.transcript.set('');
  }
}
