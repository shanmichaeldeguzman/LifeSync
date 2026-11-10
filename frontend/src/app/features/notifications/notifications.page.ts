import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { IonButtons, IonContent, IonHeader, IonIcon, IonRefresher, IonRefresherContent, IonTitle, IonToolbar } from '@ionic/angular';
import { DataService } from '../../core/data/data.service';
import { SyncService } from '../../core/data/sync.service';
import type { AppNotification, NotificationType } from '../../core/models';
import { ApiService } from '../../core/services/api.service';
import { NetworkService } from '../../core/services/network.service';
import { ReminderService } from '../../core/services/reminder.service';
import { UiService } from '../../core/services/ui.service';
import { diffInDays, timeAgo } from '../../core/utils/date';
import { NOTIFICATION_META } from '../../core/utils/format';
import { EmptyStateComponent } from '../../shared/components/empty-state.component';
import { SkeletonComponent } from '../../shared/components/skeleton.component';

const ROUTES: Record<string, (id: string) => string> = {
  task: () => '/tasks',
  event: () => '/calendar',
  habit: (id) => `/habits/${id}`,
  budget: () => '/finance/budgets',
  document: () => '/documents',
  goal: (id) => `/goals/${id}`,
};

@Component({
  selector: 'app-notifications',
  imports: [IonHeader, IonToolbar, IonTitle, IonButtons, IonContent, IonIcon, IonRefresher, IonRefresherContent, RouterLink, EmptyStateComponent, SkeletonComponent],
  template: `
    <ion-header class="ion-hide-lg-up">
      <ion-toolbar>
        <ion-title>Notifications</ion-title>
        <ion-buttons slot="end"><button class="ls-icon-btn ghost" routerLink="/settings" [queryParams]="{ section: 'notifications' }" aria-label="Notification settings"><ion-icon name="options-outline"></ion-icon></button></ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <ion-refresher slot="fixed" (ionRefresh)="refresh($event)"><ion-refresher-content></ion-refresher-content></ion-refresher>
      <div class="ls-page narrow">
        <div class="ls-page-header">
          <div><h1>Notifications</h1><p>{{ unread() }} unread</p></div>
          <div class="actions">
            <button class="ls-filter-chip" (click)="markAll()" [disabled]="!unread()"><ion-icon name="checkmark-done-outline" style="vertical-align:-2px"></ion-icon> Mark all read</button>
            <button class="ls-icon-btn ion-hide-lg-down" routerLink="/settings" [queryParams]="{ section: 'notifications' }" aria-label="Notification settings"><ion-icon name="options-outline"></ion-icon></button>
          </div>
        </div>

        @if (reminders.permission() === 'prompt') {
          <div class="ls-banner" style="margin-bottom:14px">
            <ion-icon name="notifications-outline"></ion-icon>
            <span style="flex:1">{{ reminders.native ? 'Allow notifications to get reminders even when LifeSync is closed.' : 'Allow browser notifications for reminders while LifeSync is open.' }}</span>
            <button class="ls-filter-chip active" (click)="reminders.requestPermission()">Allow</button>
          </div>
        }

        <div class="ls-filter-bar">
          <button class="ls-filter-chip" [class.active]="!type() && !unreadOnly()" (click)="type.set(''); unreadOnly.set(false)">All</button>
          <button class="ls-filter-chip" [class.active]="unreadOnly()" (click)="unreadOnly.set(!unreadOnly())">Unread</button>
          @for (t of types; track t) {
            <button class="ls-filter-chip" [class.active]="type() === t" (click)="type.set(type() === t ? '' : t)"><ion-icon [name]="meta[t].icon" style="vertical-align:-2px"></ion-icon> {{ meta[t].label }}</button>
          }
        </div>

        @if (!data.ready()) {
          <app-skeleton [rows]="5"></app-skeleton>
        } @else if (groups().length === 0) {
          <div class="ls-card"><app-empty-state icon="notifications-off-outline" title="You're all caught up" message="Task, event, habit, budget, document and goal reminders appear here."></app-empty-state></div>
        } @else {
          @for (g of groups(); track g.label) {
            <div class="ls-group-label">{{ g.label }}</div>
            <div class="ls-card flush">
              @for (n of g.items; track n.id) {
                <div class="ls-row clickable" [class.unread]="!n.read_at" (click)="open(n)" (keydown.enter)="open(n)" tabindex="0">
                  <span class="ls-icon-tile sm" [style.background]="meta[n.type].color + '1f'" [style.color]="meta[n.type].color"><ion-icon [name]="meta[n.type].icon"></ion-icon></span>
                  <div class="grow">
                    <div class="title" style="white-space:normal">{{ n.title }}</div>
                    @if (n.body) { <div class="meta" style="margin-top:2px">{{ n.body }}</div> }
                    <div class="meta">{{ ago(n.created_at) }}</div>
                  </div>
                  @if (!n.read_at) { <span class="ls-dot" style="background:var(--ion-color-primary)" aria-label="Unread"></span> }
                  <button class="ls-icon-btn ghost" (click)="toggleRead(n, $event)" [attr.aria-label]="n.read_at ? 'Mark as unread' : 'Mark as read'"><ion-icon [name]="n.read_at ? 'mail-unread-outline' : 'mail-open-outline'"></ion-icon></button>
                  <button class="ls-icon-btn ghost" (click)="remove(n, $event)" aria-label="Delete notification"><ion-icon name="trash-outline"></ion-icon></button>
                </div>
              }
            </div>
          }
        }
      </div>
    </ion-content>
  `,
  styles: `.unread { background: color-mix(in srgb, var(--ion-color-primary) 4%, var(--ls-surface)); } .unread .title { font-weight: 700; }`,
})
export class NotificationsPage {
  readonly data = inject(DataService);
  readonly reminders = inject(ReminderService);
  private readonly sync = inject(SyncService);
  private readonly api = inject(ApiService);
  private readonly network = inject(NetworkService);
  private readonly ui = inject(UiService);
  private readonly router = inject(Router);

  readonly meta = NOTIFICATION_META;
  readonly types: NotificationType[] = ['task', 'event', 'habit', 'budget', 'document', 'goal'];
  readonly type = signal<'' | NotificationType>('');
  readonly unreadOnly = signal(false);
  readonly all = computed(() => [...this.data.list('notifications')()].sort((a, b) => b.created_at.localeCompare(a.created_at)));
  readonly unread = computed(() => this.all().filter((n) => !n.read_at).length);

  readonly groups = computed(() => {
    const list = this.all().filter((n) => (!this.type() || n.type === this.type()) && (!this.unreadOnly() || !n.read_at));
    const buckets: Record<string, AppNotification[]> = { Today: [], Yesterday: [], 'This week': [], Earlier: [] };
    for (const n of list) {
      const d = -diffInDays(new Date(n.created_at), new Date());
      buckets[d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : d < 7 ? 'This week' : 'Earlier'].push(n);
    }
    return Object.entries(buckets).filter(([, items]) => items.length).map(([label, items]) => ({ label, items }));
  });

  ago(iso: string) {
    return timeAgo(iso);
  }

  async open(n: AppNotification) {
    if (!n.read_at) await this.data.update('notifications', n.id, { read_at: new Date().toISOString() });
    const route = ROUTES[n.entity_type ?? n.type];
    if (route) void this.router.navigateByUrl(route(n.entity_id ?? ''));
  }

  async toggleRead(n: AppNotification, ev: Event) {
    ev.stopPropagation();
    await this.data.update('notifications', n.id, { read_at: n.read_at ? null : new Date().toISOString() });
  }

  async remove(n: AppNotification, ev: Event) {
    ev.stopPropagation();
    await this.data.remove('notifications', n.id);
  }

  async markAll() {
    const now = new Date().toISOString();
    if (this.network.online()) {
      try {
        await this.api.post('/notifications/read-all');
        await this.sync.sync();
        return;
      } catch {
        /* fall back to local updates */
      }
    }
    for (const n of this.all().filter((x) => !x.read_at)) await this.data.update('notifications', n.id, { read_at: now });
    await this.ui.success('All caught up');
  }

  async refresh(ev: Event) {
    if (this.network.online()) {
      await this.api.post('/notifications/refresh').catch(() => undefined);
      await this.sync.sync();
    }
    (ev.target as HTMLIonRefresherElement).complete();
  }
}
