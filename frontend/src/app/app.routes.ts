import type { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  { path: 'setup', loadComponent: () => import('./features/auth/setup.page').then((m) => m.SetupPage) },
  {
    path: 'auth',
    children: [
      { path: 'login', canActivate: [guestGuard], loadComponent: () => import('./features/auth/login.page').then((m) => m.LoginPage) },
      { path: 'register', canActivate: [guestGuard], loadComponent: () => import('./features/auth/register.page').then((m) => m.RegisterPage) },
      { path: 'forgot-password', canActivate: [guestGuard], loadComponent: () => import('./features/auth/forgot-password.page').then((m) => m.ForgotPasswordPage) },
      { path: 'reset-password', loadComponent: () => import('./features/auth/reset-password.page').then((m) => m.ResetPasswordPage) },
      { path: '', pathMatch: 'full', redirectTo: 'login' },
    ],
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/shell.component').then((m) => m.ShellComponent),
    children: [
      { path: 'dashboard', loadComponent: () => import('./features/dashboard/dashboard.page').then((m) => m.DashboardPage) },
      { path: 'tasks', loadComponent: () => import('./features/tasks/tasks.page').then((m) => m.TasksPage) },
      { path: 'calendar', loadComponent: () => import('./features/calendar/calendar.page').then((m) => m.CalendarPage) },
      { path: 'notes', loadComponent: () => import('./features/notes/notes.page').then((m) => m.NotesPage) },
      { path: 'notes/:id', loadComponent: () => import('./features/notes/note-editor.page').then((m) => m.NoteEditorPage) },
      { path: 'habits', loadComponent: () => import('./features/habits/habits.page').then((m) => m.HabitsPage) },
      { path: 'habits/:id', loadComponent: () => import('./features/habits/habit-detail.page').then((m) => m.HabitDetailPage) },
      { path: 'finance', loadComponent: () => import('./features/finance/finance.page').then((m) => m.FinancePage) },
      { path: 'finance/transactions', loadComponent: () => import('./features/finance/transactions.page').then((m) => m.TransactionsPage) },
      { path: 'finance/budgets', loadComponent: () => import('./features/finance/budgets.page').then((m) => m.BudgetsPage) },
      { path: 'finance/savings', loadComponent: () => import('./features/finance/savings.page').then((m) => m.SavingsPage) },
      { path: 'finance/recurring', loadComponent: () => import('./features/finance/recurring.page').then((m) => m.RecurringPage) },
      { path: 'documents', loadComponent: () => import('./features/documents/documents.page').then((m) => m.DocumentsPage) },
      { path: 'goals', loadComponent: () => import('./features/goals/goals.page').then((m) => m.GoalsPage) },
      { path: 'goals/:id', loadComponent: () => import('./features/goals/goal-detail.page').then((m) => m.GoalDetailPage) },
      { path: 'notifications', loadComponent: () => import('./features/notifications/notifications.page').then((m) => m.NotificationsPage) },
      { path: 'settings', loadComponent: () => import('./features/settings/settings.page').then((m) => m.SettingsPage) },
      { path: 'settings/sync', loadComponent: () => import('./features/settings/sync.page').then((m) => m.SyncPage) },
      { path: 'more', loadComponent: () => import('./features/more/more.page').then((m) => m.MorePage) },
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
    ],
  },
  { path: '**', redirectTo: 'dashboard' },
];
