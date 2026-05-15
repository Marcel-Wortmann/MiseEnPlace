import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface OllamaQueueEntry {
  id: number;
  tag: string;
  stage: string | null;
  model: string;
  status: 'waiting' | 'running' | 'cancelled';
  enqueuedAt: number;
  startedAt: number | null;
  etaMs: number | null;
}

export interface OllamaQueueResponse {
  now: number;
  entries: OllamaQueueEntry[];
}

@Injectable({ providedIn: 'root' })
export class AdminService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/api/admin`;

  ollamaQueue(): Observable<OllamaQueueResponse> {
    return this.http.get<OllamaQueueResponse>(`${this.baseUrl}/ollama-queue`);
  }

  cancelOllamaEntry(id: number): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${this.baseUrl}/ollama-queue/cancel`, { id });
  }

  cancelAllOllama(): Observable<{ cancelled: number }> {
    return this.http.post<{ cancelled: number }>(`${this.baseUrl}/ollama-queue/cancel-all`, {});
  }
}
