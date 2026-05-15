import { Component, ElementRef, inject, output, signal, viewChild } from '@angular/core';

interface BarcodeDetectorPolyfill {
  detect(source: HTMLVideoElement | ImageBitmap): Promise<{ rawValue: string; format: string }[]>;
}

interface BarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): BarcodeDetectorPolyfill;
  getSupportedFormats?: () => Promise<string[]>;
}

declare global {
  interface Window {
    BarcodeDetector?: BarcodeDetectorConstructor;
  }
}

@Component({
  selector: 'app-barcode-scanner',
  imports: [],
  templateUrl: './barcode-scanner.html',
  styleUrl: './barcode-scanner.css',
})
export class BarcodeScannerComponent {
  readonly close = output<void>();
  readonly detected = output<string>();

  readonly videoRef = viewChild<ElementRef<HTMLVideoElement>>('video');

  readonly status = signal<'idle' | 'camera' | 'manual' | 'unsupported'>('idle');
  readonly error = signal<string | null>(null);
  readonly manualInput = signal('');

  private stream: MediaStream | null = null;
  private detector: BarcodeDetectorPolyfill | null = null;
  private scanInterval: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;

  async ngOnInit(): Promise<void> {
    if (typeof window.BarcodeDetector === 'undefined') {
      this.status.set('unsupported');
      return;
    }
    try {
      this.detector = new window.BarcodeDetector({
        formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'],
      });
      await this.startCamera();
    } catch (err) {
      this.error.set(`Kamera nicht verfügbar: ${(err as Error).message}`);
      this.status.set('manual');
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.stopCamera();
  }

  private async startCamera(): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
    } catch (err) {
      this.error.set('Kamera-Zugriff verweigert. Du kannst den Barcode manuell eingeben.');
      this.status.set('manual');
      return;
    }

    this.status.set('camera');
    // Warte bis Video-Element gerendert ist
    setTimeout(() => this.attachStream(), 50);
  }

  private attachStream(): void {
    const v = this.videoRef()?.nativeElement;
    if (!v || !this.stream) return;
    v.srcObject = this.stream;
    v.play().catch(() => { /* autoplay quirks */ });

    // Scan alle 400ms
    this.scanInterval = setInterval(() => this.scanFrame(), 400);
  }

  private async scanFrame(): Promise<void> {
    if (this.destroyed) return;
    const v = this.videoRef()?.nativeElement;
    if (!v || v.readyState < 2 || !this.detector) return;
    try {
      const results = await this.detector.detect(v);
      if (results.length > 0) {
        const code = results[0].rawValue;
        if (code && /^\d{8,14}$/.test(code)) {
          this.emit(code);
        }
      }
    } catch {
      // Detection-Fehler bei einzelnen Frames sind normal — ignorieren
    }
  }

  private emit(code: string): void {
    this.stopCamera();
    this.detected.emit(code);
  }

  switchToManual(): void {
    this.stopCamera();
    this.status.set('manual');
  }

  submitManual(): void {
    const code = this.manualInput().trim();
    if (!/^\d{8,14}$/.test(code)) {
      this.error.set('Barcode muss 8 bis 14 Ziffern haben.');
      return;
    }
    this.error.set(null);
    this.detected.emit(code);
  }

  onManualInput(event: Event): void {
    this.manualInput.set((event.target as HTMLInputElement).value);
  }

  cancel(): void {
    this.stopCamera();
    this.close.emit();
  }

  private stopCamera(): void {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
  }
}
