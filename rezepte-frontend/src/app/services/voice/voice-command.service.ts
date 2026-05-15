import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Recipe } from '@shared/interfaces';

export interface VoiceCommandPayload {
  command: string;
  recipeTitle: string;
  steps: { order: number; text: string }[];
  ingredients: { name: string; amount: number | null; unit: string | null }[];
  currentStep?: number;
}

export interface VoiceCommandResult {
  type: 'navigate' | 'answer' | 'unknown';
  action?: string;
  message?: string;
}

@Injectable({ providedIn: 'root' })
export class VoiceCommandService {
  private readonly http = inject(HttpClient);

  send(payload: VoiceCommandPayload): Observable<VoiceCommandResult> {
    return this.http.post<VoiceCommandResult>('/api/ai/voice-command', payload);
  }

  fromRecipe(recipe: Recipe, command: string, currentStep?: number): VoiceCommandPayload {
    return {
      command,
      recipeTitle: recipe.title,
      steps: recipe.steps.map((s) => ({ order: s.order, text: s.text })),
      ingredients: recipe.ingredients.map((i) => ({ name: i.name, amount: i.amount, unit: i.unit })),
      currentStep,
    };
  }
}
