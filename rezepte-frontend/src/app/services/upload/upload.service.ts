import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface UploadResponse {
  path: string;
}

@Injectable({ providedIn: 'root' })
export class UploadService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/api/uploads`;

  uploadImage(file: File): Observable<UploadResponse> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<UploadResponse>(`${this.baseUrl}/image`, form);
  }

  resolveUrl(path: string | null | undefined): string | null {
    if (!path) {
      return null;
    }
    return `${environment.apiBaseUrl}${path}`;
  }

  /**
   * Thumbnail-URL für Listen-Ansichten (240/480/768 px breite WebP).
   * Server resized on-the-fly und cached. Detail-Ansichten nutzen weiter resolveUrl().
   */
  thumbUrl(path: string | null | undefined, width: 240 | 480 | 768 = 480): string | null {
    if (!path) return null;
    if (path.startsWith('http')) return path;
    return `${environment.apiBaseUrl}${path}?w=${width}`;
  }
}
