import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { MealPlanStore } from '../store/MealPlan/MealPlan.store';
import { RecipesStore } from '../store/Recipes/Recipes.store';
import { ShoppingService } from '../services/shopping/shopping.service';
import { MealPlanService } from '../services/meal-plan/meal-plan.service';
import { NotificationStore } from '../store/Notification/Notification.store';
import { DayNutrition, MEAL_SLOTS, MEAL_SLOT_LABELS, MealSlot, Recipe } from '@shared/interfaces';
import { environment } from '../../environments/environment';

@Component({
  selector: 'app-meal-plan',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './meal-plan.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MealPlanComponent implements OnInit {
  store = inject(MealPlanStore);
  recipesStore = inject(RecipesStore);
  private shoppingService = inject(ShoppingService);
  private mealPlanService = inject(MealPlanService);
  private notify = inject(NotificationStore);

  readonly nutritionByDate = signal<Map<string, DayNutrition>>(new Map());

  readonly slots = MEAL_SLOTS;
  readonly slotLabels = MEAL_SLOT_LABELS;
  readonly weekdayLabels = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

  // Picker state
  picker = signal<{ date: string; slot: MealSlot } | null>(null);
  pickerSearch = signal('');
  customText = signal('');
  addingToShopping = signal(false);

  async addWeekToShopping(): Promise<void> {
    const days = this.store.weekDays();
    if (days.length === 0) return;
    this.addingToShopping.set(true);
    try {
      const items = await firstValueFrom(this.shoppingService.addFromPlan(days[0], days[days.length - 1]));
      if (items.length === 0) {
        this.notify.success('Keine Rezepte im Plan', 'Diese Woche enthält keine Rezepte.');
      } else {
        this.notify.success('Zur Einkaufsliste hinzugefügt', `${items.length} Zutaten.`);
      }
    } catch (err) {
      this.notify.error('Fehlgeschlagen', (err as Error).message);
    } finally {
      this.addingToShopping.set(false);
    }
  }

  pickerResults = computed<Recipe[]>(() => {
    const q = this.pickerSearch().trim().toLowerCase();
    const all = this.recipesStore.items();
    if (!q) return all.slice(0, 30);
    return all.filter((r) =>
      r.title.toLowerCase().includes(q) ||
      (r.tags ?? []).some((t) => t.toLowerCase().includes(q))
    ).slice(0, 30);
  });

  async ngOnInit(): Promise<void> {
    await this.store.loadWeek();
    if (this.recipesStore.items().length === 0) await this.recipesStore.loadAll();
    void this.loadNutrition();
  }

  private async loadNutrition(): Promise<void> {
    const days = this.store.weekDays();
    if (days.length === 0) return;
    try {
      const data = await firstValueFrom(this.mealPlanService.nutrition(days[0], days[days.length - 1]));
      const map = new Map<string, DayNutrition>();
      for (const d of data) map.set(d.date, d);
      this.nutritionByDate.set(map);
    } catch {
      // still keep UI usable
    }
  }

  nutritionFor(date: string): DayNutrition['totals'] | null {
    const d = this.nutritionByDate().get(date);
    return d?.totals ?? null;
  }

  imageUrl(path: string | null): string | null {
    if (!path) return null;
    if (path.startsWith("http")) return path;
    return `${environment.apiBaseUrl}${path}?w=480`;
  }

  weekRangeLabel(): string {
    const days = this.store.weekDays();
    const fmt = (iso: string) => {
      const d = new Date(iso);
      return `${d.getDate()}.${d.getMonth() + 1}.`;
    };
    return `${fmt(days[0])} – ${fmt(days[6])}`;
  }

  dayLabel(iso: string, idx: number): string {
    const d = new Date(iso);
    return `${this.weekdayLabels[idx]} ${d.getDate()}.${d.getMonth() + 1}.`;
  }

  isToday(iso: string): boolean {
    const today = new Date().toISOString().slice(0, 10);
    return iso === today;
  }

  entryFor(date: string, slot: MealSlot) {
    return this.store.entriesByKey().get(`${date}::${slot}`);
  }

  openPicker(date: string, slot: MealSlot): void {
    this.picker.set({ date, slot });
    this.pickerSearch.set('');
    this.customText.set('');
  }

  closePicker(): void {
    this.picker.set(null);
  }

  pickRecipe(recipe: Recipe): void {
    const p = this.picker();
    if (!p) return;
    this.store.upsert({ date: p.date, slot: p.slot, recipeId: recipe.id, customText: null });
    this.closePicker();
  }

  saveCustom(): void {
    const p = this.picker();
    const text = this.customText().trim();
    if (!p || !text) return;
    this.store.upsert({ date: p.date, slot: p.slot, recipeId: null, customText: text });
    this.closePicker();
  }

  clear(date: string, slot: MealSlot): void {
    this.store.clear(date, slot);
  }
}
