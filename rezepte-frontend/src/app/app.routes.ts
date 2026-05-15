import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './auth/auth.guard';

export const routes: Routes = [
  // Public share pages (no login required)
  {
    path: 'share/rezept/:token',
    loadComponent: () => import('./share/recipe/share-recipe').then((m) => m.ShareRecipeComponent),
  },
  {
    path: 'share/idee/:token',
    loadComponent: () => import('./share/idea/share-idea').then((m) => m.ShareIdeaComponent),
  },
  {
    path: 'share/wein/:token',
    loadComponent: () => import('./share/wine/share-wine').then((m) => m.ShareWineComponent),
  },

  // Auth pages (only when NOT logged in)
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./login/login').then((m) => m.LoginComponent),
  },
  {
    path: 'register',
    canActivate: [guestGuard],
    loadComponent: () => import('./register/register').then((m) => m.RegisterComponent),
  },

  // Protected app
  {
    path: '',
    canActivate: [authGuard],
    children: [
      { path: '', redirectTo: 'rezepte', pathMatch: 'full' },
      {
        path: 'rezepte',
        loadComponent: () => import('./recipes/list/recipe-list').then((m) => m.RecipeListComponent),
      },
      {
        path: 'rezepte/neu',
        loadComponent: () => import('./recipes/form/recipe-form').then((m) => m.RecipeFormComponent),
      },
      {
        path: 'rezepte/:id',
        loadComponent: () => import('./recipes/detail/recipe-detail').then((m) => m.RecipeDetailComponent),
      },
      {
        path: 'rezepte/:id/bearbeiten',
        loadComponent: () => import('./recipes/form/recipe-form').then((m) => m.RecipeFormComponent),
      },
      {
        path: 'ideen',
        loadComponent: () => import('./recipe-ideas/list/recipe-idea-list').then((m) => m.RecipeIdeaListComponent),
      },
      {
        path: 'ideen/neu',
        loadComponent: () => import('./recipe-ideas/form/recipe-idea-form').then((m) => m.RecipeIdeaFormComponent),
      },
      {
        path: 'ideen/:id/bearbeiten',
        loadComponent: () => import('./recipe-ideas/form/recipe-idea-form').then((m) => m.RecipeIdeaFormComponent),
      },
      {
        path: 'wein',
        loadComponent: () => import('./wines/list/wine-list').then((m) => m.WineListComponent),
      },
      {
        path: 'wein/neu',
        loadComponent: () => import('./wines/form/wine-form').then((m) => m.WineFormComponent),
      },
      {
        path: 'wein/:id',
        loadComponent: () => import('./wines/detail/wine-detail').then((m) => m.WineDetailComponent),
      },
      {
        path: 'wein/:id/bearbeiten',
        loadComponent: () => import('./wines/form/wine-form').then((m) => m.WineFormComponent),
      },
      {
        path: 'restaurants',
        loadComponent: () => import('./restaurants/list/restaurant-list').then((m) => m.RestaurantListComponent),
      },
      {
        path: 'restaurants/neu',
        loadComponent: () => import('./restaurants/form/restaurant-form').then((m) => m.RestaurantFormComponent),
      },
      {
        path: 'restaurants/:id',
        loadComponent: () => import('./restaurants/detail/restaurant-detail').then((m) => m.RestaurantDetailComponent),
      },
      {
        path: 'restaurants/:id/bearbeiten',
        loadComponent: () => import('./restaurants/form/restaurant-form').then((m) => m.RestaurantFormComponent),
      },
      {
        path: 'plan',
        loadComponent: () => import('./meal-plan/meal-plan').then((m) => m.MealPlanComponent),
      },
      {
        path: 'gefolgt',
        loadComponent: () => import('./follow/follow').then((m) => m.FollowComponent),
      },
      {
        path: 'vorrat',
        loadComponent: () => import('./user-ingredients/list/user-ingredient-list').then((m) => m.UserIngredientListComponent),
      },
      {
        path: 'vorrat/neu',
        loadComponent: () => import('./user-ingredients/form/user-ingredient-form').then((m) => m.UserIngredientFormComponent),
      },
      {
        path: 'vorrat/:id/bearbeiten',
        loadComponent: () => import('./user-ingredients/form/user-ingredient-form').then((m) => m.UserIngredientFormComponent),
      },
      {
        path: 'einkaufsliste',
        loadComponent: () => import('./shopping/shopping').then((m) => m.ShoppingComponent),
      },
      {
        path: 'einstellungen',
        loadComponent: () => import('./settings/settings').then((m) => m.SettingsComponent),
      },
    ],
  },

  { path: '**', redirectTo: '' },
];
