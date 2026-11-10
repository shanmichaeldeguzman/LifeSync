import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonButtons, IonContent, IonFab, IonFabButton, IonHeader, IonIcon, IonRefresher, IonRefresherContent, IonSearchbar, IonTitle, IonToolbar, ModalController } from '@ionic/angular';
import { DataService } from '../../core/data/data.service';
import { SyncService } from '../../core/data/sync.service';
import type { Priority, Task } from '../../core/models';
import { addDays, dateKey, startOfDay, startOfWeek } from '../../core/utils/date';
import { PRIORITY_META } from '../../core/utils/format';
import { CategoryManagerModal } from '../../shared/components/category-manager.modal';
import { EmptyStateComponent } from '../../shared/components/empty-state.component';
import { HeaderActionsComponent } from '../../shared/components/header-actions.component';
import { SkeletonComponent } from '../../shared/components/skeleton.component';
import { TaskFormModal } from './task-form.modal';
import { TaskRowComponent } from './task-row.component';

type View = 'all' | 'today' | 'upcoming' | 'overdue' | 'completed';
type GroupBy = 'date' | 'priority' | 'category' | 'status';
type SortBy = 'due' | 'priority' | 'created' | 'title';

@Component({
  selector: 'app-tasks',
  imports: [IonHeader, IonToolbar, IonTitle, IonButtons, IonContent, IonIcon, IonFab, IonFabButton, IonSearchbar, IonRefresher, IonRefresherContent, FormsModule, HeaderActionsComponent, EmptyStateComponent, SkeletonComponent, TaskRowComponent],
  template: `
    <ion-header class="ion-hide-lg-up">
      <ion-toolbar>
        <ion-title>Tasks</ion-title>
        <ion-buttons slot="end"><app-header-actions></app-header-actions></ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <ion-refresher slot="fixed" (ionRefresh)="refresh($event)"><ion-refresher-content></ion-refresher-content></ion-refresher>
      <div class="ls-page">
        <div class="ls-page-header">
          <div>
            <h1>Tasks</h1>
            <p>{{ stats().pending }} open · {{ stats().completedWeek }} completed this week</p>
          </div>
          <div class="actions">
            <button class="ls-icon-btn" (click)="manageCategories()" aria-label="Manage task categories" title="Categories"><ion-icon name="pricetags-outline"></ion-icon></button>
            <span class="ion-hide-lg-down"><app-header-actions></app-header-actions></span>
          </div>
        </div>

        <div class="ls-stats" style="margin-bottom:18px">
          <div class="ls-stat"><div class="label">Due today</div><div class="value">{{ stats().today }}</div></div>
          <div class="ls-stat"><div class="label">Overdue</div><div class="value" [style.color]="stats().overdue ? 'var(--ion-color-danger)' : null">{{ stats().overdue }}</div></div>
          <div class="ls-stat"><div class="label">In progress</div><div class="value">{{ stats().inProgress }}</div></div>
          <div class="ls-stat"><div class="label">Completion rate</div><div class="value">{{ stats().rate }}%</div><div class="sub">last 30 days</div></div>
        </div>

        <div class="toolbar">
          <ion-searchbar class="ls-search" placeholder="Search tasks" [debounce]="200" [value]="search()" (ionInput)="search.set($any($event).detail.value ?? '')" aria-label="Search tasks"></ion-searchbar>
          <div class="selects">
            <select class="ls-native-input" [ngModel]="priority()" (ngModelChange)="priority.set($event)" aria-label="Filter by priority">
              <option value="">All priorities</option>
              @for (p of priorities; track p) { <option [value]="p">{{ meta[p].label }}</option> }
            </select>
            <select class="ls-native-input" [ngModel]="category()" (ngModelChange)="category.set($event)" aria-label="Filter by category">
              <option value="">All categories</option>
              <option value="none">Uncategorized</option>
              @for (c of categories(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }
            </select>
            <select class="ls-native-input" [ngModel]="groupBy()" (ngModelChange)="groupBy.set($event)" aria-label="Group tasks by">
              <option value="date">Group: Date</option>
              <option value="priority">Group: Priority</option>
              <option value="category">Group: Category</option>
              <option value="status">Group: Status</option>
            </select>
            <select class="ls-native-input" [ngModel]="sortBy()" (ngModelChange)="sortBy.set($event)" aria-label="Sort tasks">
              <option value="due">Sort: Due date</option>
              <option value="priority">Sort: Priority</option>
              <option value="created">Sort: Newest</option>
              <option value="title">Sort: Title</option>
            </select>
          </div>
        </div>

        <div class="ls-filter-bar" role="tablist" aria-label="Task views">
          @for (v of views; track v.value) {
            <button class="ls-filter-chip" role="tab" [attr.aria-selected]="view() === v.value" [class.active]="view() === v.value" (click)="view.set(v.value)">
              {{ v.label }} <span class="count">{{ viewCounts()[v.value] }}</span>
            </button>
          }
        </div>

        @if (loading()) {
          <app-skeleton [rows]="6"></app-skeleton>
        } @else if (groups().length === 0) {
          <div class="ls-card">
            @if (search() || priority() || category()) {
              <app-empty-state icon="search-outline" title="No matching tasks" message="Try a different search or clear your filters."></app-empty-state>
            } @else if (view() === 'completed') {
              <app-empty-state icon="trophy-outline" title="Nothing completed yet" message="Completed tasks will show up here."></app-empty-state>
            } @else {
              <app-empty-state icon="checkbox-outline" title="You're all caught up" message="Add a task to plan your day. Small steps add up." actionText="New task" (action)="openForm()"></app-empty-state>
            }
          </div>
        } @else {
          @for (g of groups(); track g.key) {
            <div class="ls-group-label">{{ g.label }} · {{ g.tasks.length }}</div>
            <div class="ls-card flush ls-fade-in">
              @for (t of g.tasks; track t.id) {
                <app-task-row [task]="t" (open)="openForm($event)"></app-task-row>
              }
            </div>
          }
        }
      </div>

      <ion-fab slot="fixed" vertical="bottom" horizontal="end" class="ls-fab">
        <ion-fab-button (click)="openForm()" aria-label="New task"><ion-icon name="add"></ion-icon></ion-fab-button>
      </ion-fab>
    </ion-content>
  `,
  styles: `
    .toolbar { display: flex; flex-direction: column; gap: 10px; margin-bottom: 12px; }
    .selects { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .selects select { min-height: 42px; font-size: 0.86rem; }
    @media (min-width: 900px) {
      .toolbar { flex-direction: row; align-items: center; }
      .toolbar ion-searchbar { flex: 1; }
      .selects { grid-template-columns: repeat(4, 160px); }
    }
    .count { opacity: 0.7; margin-left: 4px; font-weight: 700; }
  `,
})
export class TasksPage {
  private readonly data = inject(DataService);
  private readonly sync = inject(SyncService);
  private readonly modal = inject(ModalController);

  readonly priorities: Priority[] = ['urgent', 'high', 'medium', 'low'];
  readonly meta = PRIORITY_META;
  readonly views: { value: View; label: string }[] = [
    { value: 'all', label: 'Open' },
    { value: 'today', label: 'Today' },
    { value: 'upcoming', label: 'Upcoming' },
    { value: 'overdue', label: 'Overdue' },
    { value: 'completed', label: 'Completed' },
  ];

  readonly view = signal<View>('all');
  readonly search = signal('');
  readonly priority = signal<'' | Priority>('');
  readonly category = signal('');
  readonly groupBy = signal<GroupBy>('date');
  readonly sortBy = signal<SortBy>('due');

  readonly tasks = this.data.list('tasks');
  readonly categories = computed(() => [...this.data.list('task_categories')()].sort((a, b) => a.name.localeCompare(b.name)));
  readonly loading = computed(() => !this.data.ready() || (!this.data.lastSyncedAt() && this.tasks().length === 0 && this.sync.state() === 'syncing'));

  private readonly bounds = computed(() => {
    const today = startOfDay(new Date());
    return { today, tomorrow: addDays(today, 1), dayAfter: addDays(today, 2), weekEnd: addDays(today, 7) };
  });

  private matchesView(t: Task, v: View): boolean {
    const { today, tomorrow } = this.bounds();
    const due = t.due_at ? new Date(t.due_at) : null;
    const done = t.status === 'completed';
    switch (v) {
      case 'all': return !done;
      case 'today': return !done && !!due && due >= today && due < tomorrow;
      case 'upcoming': return !done && !!due && due >= tomorrow;
      case 'overdue': return !done && !!due && due < new Date();
      case 'completed': return done;
    }
  }

  readonly viewCounts = computed(() => {
    const out = { all: 0, today: 0, upcoming: 0, overdue: 0, completed: 0 } as Record<View, number>;
    for (const t of this.tasks()) for (const v of this.views) if (this.matchesView(t, v.value)) out[v.value]++;
    return out;
  });

  readonly stats = computed(() => {
    const all = this.tasks();
    const weekStart = startOfWeek(new Date(), 1);
    const monthAgo = addDays(new Date(), -30);
    const recent = all.filter((t) => new Date(t.created_at) >= monthAgo || (t.due_at && new Date(t.due_at) >= monthAgo && new Date(t.due_at) <= new Date()));
    const recentDone = recent.filter((t) => t.status === 'completed').length;
    return {
      pending: all.filter((t) => t.status !== 'completed').length,
      today: this.viewCounts().today,
      overdue: this.viewCounts().overdue,
      inProgress: all.filter((t) => t.status === 'in_progress').length,
      completedWeek: all.filter((t) => t.completed_at && new Date(t.completed_at) >= weekStart).length,
      rate: recent.length ? Math.round((recentDone / recent.length) * 100) : 0,
    };
  });

  readonly filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    const prio = this.priority();
    const cat = this.category();
    const list = this.tasks().filter(
      (t) =>
        this.matchesView(t, this.view()) &&
        (!q || t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)) &&
        (!prio || t.priority === prio) &&
        (!cat || (cat === 'none' ? !t.category_id : t.category_id === cat)),
    );
    const sort = this.sortBy();
    return list.sort((a, b) => {
      if (sort === 'priority') return PRIORITY_META[a.priority].rank - PRIORITY_META[b.priority].rank || this.dueCmp(a, b);
      if (sort === 'created') return b.created_at.localeCompare(a.created_at);
      if (sort === 'title') return a.title.localeCompare(b.title);
      return this.dueCmp(a, b) || PRIORITY_META[a.priority].rank - PRIORITY_META[b.priority].rank;
    });
  });

  private dueCmp(a: Task, b: Task) {
    if (a.due_at && b.due_at) return a.due_at.localeCompare(b.due_at);
    return a.due_at ? -1 : b.due_at ? 1 : 0;
  }

  readonly groups = computed(() => {
    const groups = new Map<string, { key: string; label: string; order: number; tasks: Task[] }>();
    const add = (key: string, label: string, order: number, t: Task) => {
      if (!groups.has(key)) groups.set(key, { key, label, order, tasks: [] });
      groups.get(key)!.tasks.push(t);
    };
    const { today, tomorrow, dayAfter, weekEnd } = this.bounds();
    for (const t of this.filtered()) {
      switch (this.groupBy()) {
        case 'priority':
          add(t.priority, PRIORITY_META[t.priority].label, PRIORITY_META[t.priority].rank, t);
          break;
        case 'status':
          add(t.status, { pending: 'Pending', in_progress: 'In progress', completed: 'Completed' }[t.status], { in_progress: 0, pending: 1, completed: 2 }[t.status], t);
          break;
        case 'category': {
          const c = this.data.find('task_categories', t.category_id);
          add(c?.id ?? 'none', c?.name ?? 'Uncategorized', c ? 0 : 1, t);
          break;
        }
        default: {
          if (t.status === 'completed') { add('done', 'Completed', 6, t); break; }
          const due = t.due_at ? new Date(t.due_at) : null;
          if (!due) add('none', 'No date', 5, t);
          else if (due < today) add('overdue', 'Overdue', 0, t);
          else if (due < tomorrow) add('today', 'Today', 1, t);
          else if (due < dayAfter) add('tomorrow', 'Tomorrow', 2, t);
          else if (due < weekEnd) add('week', 'Next 7 days', 3, t);
          else add('later', 'Later', 4, t);
        }
      }
    }
    return [...groups.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
  });

  async openForm(task?: Task) {
    const defaults: Partial<Task> | undefined = !task && this.view() === 'today' ? { due_at: (() => { const d = new Date(); d.setHours(17, 0, 0, 0); return d.toISOString(); })() } : undefined;
    const m = await this.modal.create({ component: TaskFormModal, componentProps: { task, defaults }, cssClass: 'ls-modal' });
    await m.present();
  }

  async manageCategories() {
    const m = await this.modal.create({ component: CategoryManagerModal, componentProps: { table: 'task_categories', title: 'Task categories' }, cssClass: 'ls-modal' });
    await m.present();
  }

  async refresh(ev: Event) {
    await this.sync.sync();
    (ev.target as HTMLIonRefresherElement).complete();
  }

  protected readonly dateKey = dateKey;
}
