import { Injectable } from '@angular/core';

/**
 * Text-To-Speech via Browser Web Speech API. Liest Antworten im Cooking-Mode vor.
 * Pausiert die Mikrofon-Aufnahme während des Sprechens, damit Recognition
 * nicht die TTS-Stimme als Befehl interpretiert.
 */
@Injectable({ providedIn: 'root' })
export class TtsService {
  /** Ist Browser-TTS verfügbar? */
  isSupported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  /** Sucht eine deutsche Stimme. Bevorzugt Google → Microsoft → erste de-* Stimme. */
  private pickGermanVoice(): SpeechSynthesisVoice | null {
    if (!this.isSupported()) return null;
    const voices = window.speechSynthesis.getVoices();
    const de = voices.filter((v) => v.lang.toLowerCase().startsWith('de'));
    if (de.length === 0) return null;
    return (
      de.find((v) => /google/i.test(v.name)) ??
      de.find((v) => /microsoft/i.test(v.name)) ??
      de[0]
    );
  }

  /** Spricht den Text. Bricht laufende Ausgabe ab. */
  speak(text: string, opts?: { rate?: number; onEnd?: () => void; onStart?: () => void }): void {
    if (!this.isSupported() || !text.trim()) {
      opts?.onEnd?.();
      return;
    }
    window.speechSynthesis.cancel();

    const utter = new SpeechSynthesisUtterance(text);
    const voice = this.pickGermanVoice();
    if (voice) utter.voice = voice;
    utter.lang = voice?.lang ?? 'de-DE';
    utter.rate = opts?.rate ?? 1.0;
    utter.pitch = 1.0;

    if (opts?.onStart) utter.onstart = () => opts.onStart!();
    if (opts?.onEnd) {
      utter.onend = () => opts.onEnd!();
      utter.onerror = () => opts.onEnd!();
    }

    window.speechSynthesis.speak(utter);
  }

  cancel(): void {
    if (this.isSupported()) window.speechSynthesis.cancel();
  }

  /** True während aktiv vorgelesen wird (oder eine Utterance in der Queue steht). */
  isSpeaking(): boolean {
    return this.isSupported() && (window.speechSynthesis.speaking || window.speechSynthesis.pending);
  }
}
