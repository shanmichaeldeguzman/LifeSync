import { Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { IonIcon, IonMenu, IonRouterOutlet, IonSplitPane } from '@ionic/angular';
import { filter } from 'rxjs';
import { DataService } from '../core/data/data.service';
import { SyncService } from '../core/data/sync.service';
import { AuthService } from '../core/services/auth.service';
import { NetworkService } from '../core/services/network.service';
import { initials } from '../core/utils/format';
import { timeAgo } from '../core/utils/date';
import { AvatarComponent } from '../shared/components/avatar.component';

export interface NavItem {
  path: string;
  label: string;
  icon: string;
  badge?: () => number;
}

const COLLAPSE_KEY = 'lifesync-sidebar-collapsed';

/**
 * Application shell.
 *  - >= 992px: collapsible sidebar (ion-split-pane) with all modules.
 *  - < 992px: content + bottom navigation (Dashboard, Tasks, Calendar, More).
 */
@Component({
  selector: 'app-shell',
  imports: [IonSplitPane, IonMenu, IonRouterOutlet, IonIcon, RouterLink, RouterLinkActive, AvatarComponent],
  template: `
    <ion-split-pane contentId="main" when="(min-width: 992px)" [class.collapsed]="collapsed()">
      <ion-menu contentId="main" type="overlay" [swipeGesture]="false" class="ls-sidebar" menuId="sidebar">
        <div class="sidebar">
          <div class="brand">
            <div class="logo" aria-hidden="true"><ion-icon name="sync"></ion-icon></div>
            <span class="brand-name">LifeSync</span>
            <button class="ls-icon-btn ghost collapse-btn" (click)="toggleCollapsed()" [attr.aria-label]="collapsed() ? 'Expand sidebar' : 'Collapse sidebar'">
              <ion-icon [name]="collapsed() ? 'chevron-forward' : 'chevron-back'"></ion-icon>
            </button>
          </div>

          <nav class="nav" aria-label="Main navigation">
            @for (group of groups; track group.title) {
              <div class="nav-group">
                <div class="nav-title">{{ group.title }}</div>
                @for (item of group.items; track item.path) {
                  <a class="nav-item" [routerLink]="item.path" routerLinkActive="active" [attr.title]="collapsed() ? item.label : null">
                    <ion-icon [name]="item.icon"></ion-icon>
                    <span class="label">{{ item.label }}</span>
                    @if (item.badge && item.badge() > 0) {
                      <span class="badge">{{ item.badge() > 99 ? '99+' : item.badge() }}</span>
                    }
                  </a>
                }
              </div>
            }
          </nav>

          <div class="sidebar-footer">
            <a class="sync-card" routerLink="/settings/sync" [class.offline]="!network.online()">
              <span class="ls-dot" [style.background]="syncColor()"></span>
              <span class="label">{{ syncLabel() }}</span>
            </a>
            <a class="user-card" routerLink="/settings">
              <app-avatar [path]="data.profile()?.avatar_path ?? null" [initials]="userInitials()" [size]="36"></app-avatar>
              <span class="label">
                <strong class="ls-truncate">{{ data.profile()?.full_name || 'Your account' }}</strong>
                <small class="ls-truncate">{{ auth.user()?.email }}</small>
              </span>
            </a>
          </div>
        </div>
      </ion-menu>

      <div class="ion-page" id="main">
        @if (!network.online()) {
          <div class="offline-banner" role="status">
            <ion-icon name="cloud-offline-outline"></ion-icon>
            You're offline. Changes are saved on this device and will sync automatically.
          </div>
        }
        <ion-router-outlet></ion-router-outlet>

        <nav class="bottom-nav" aria-label="Primary">
          @for (item of bottomItems; track item.path) {
            <a [routerLink]="item.path" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: false }" class="tab" [class.active]="item.path === '/more' && moreActive()">
              <span class="tab-icon">
                <ion-icon [name]="item.icon"></ion-icon>
                @if (item.badge && item.badge() > 0) {
                  <span class="dot"></span>
                }
              </span>
              <span>{{ item.label }}</span>
            </a>
          }
        </nav>
      </div>
    </ion-split-pane>
  `,
  styleUrl: './shell.component.scss',
})
export class ShellComponent {
  readonly data = inject(DataService);
  readonly auth = inject(AuthService);
  readonly network = inject(NetworkService);
  readonly sync = inject(SyncService);
  private readonly router = inject(Router);

  readonly collapsed = signal(this.readCollapsed());
  readonly url = signal(this.router.url);

  readonly unread = computed(() => this.data.list('notifications')().filter((n) => !n.read_at).length);
  readonly userInitials = computed(() => initials(this.data.profile()?.full_name, this.auth.user()?.email));

  readonly groups: { title: string; items: NavItem[] }[] = [
    {
      title: 'Overview',
      items: [
        { path: '/dashboard', label: 'Dashboard', icon: 'grid-outline' },
        { path: '/notifications', label: 'Notifications', icon: 'notifications-outline', badge: () => this.unread() },
      ],
    },
    {
      title: 'Plan',
      items: [
        { path: '/tasks', label: 'Tasks', icon: 'checkbox-outline' },
        { path: '/calendar', label: 'Calendar', icon: 'calendar-outline' },
        { path: '/habits', label: 'Habits', icon: 'leaf-outline' },
        { path: '/goals', label: 'Goals', icon: 'flag-outline' },
      ],
    },
    {
      title: 'Organize',
      items: [
        { path: '/notes', label: 'Notes', icon: 'document-text-outline' },
        { path: '/finance', label: 'Finance', icon: 'wallet-outline' },
        { path: '/documents', label: 'Documents', icon: 'folder-open-outline' },
      ],
    },
    { title: 'Account', items: [{ path: '/settings', label: 'Settings', icon: 'settings-outline' }] },
  ];

  readonly bottomItems: NavItem[] = [
    { path: '/dashboard', label: 'Home', icon: 'grid-outline' },
    { path: '/tasks', label: 'Tasks', icon: 'checkbox-outline' },
    { path: '/calendar', label: 'Calendar', icon: 'calendar-outline' },
    { path: '/more', label: 'More', icon: 'apps-outline', badge: () => this.unread() + this.data.conflicts().length },
  ];

  readonly moreActive = computed(() => {
    const u = this.url();
    return !['/dashboard', '/tasks', '/calendar'].some((p) => u.startsWith(p)) && !u.startsWith('/more');
  });

  readonly syncLabel = computed(() => {
    if (!this.network.online()) return `Offline · ${this.data.pendingCount()} pending`;
    if (this.data.conflicts().length) return `${this.data.conflicts().length} need review`;
    if (this.sync.state() === 'syncing') return 'Syncing…';
    if (this.sync.state() === 'error') return 'Sync paused, tap to retry';
    if (this.data.pendingCount()) return `${this.data.pendingCount()} pending`;
    const last = this.data.lastSyncedAt();
    return last ? `Synced ${timeAgo(last)}` : 'Not synced yet';
  });
  readonly syncColor = computed(() => {
    if (!this.network.online() || this.sync.state() === 'error' || this.data.conflicts().length) return 'var(--ion-color-warning)';
    if (this.data.pendingCount() || this.sync.state() === 'syncing') return 'var(--ion-color-primary)';
    return 'var(--ion-color-success)';
  });

  constructor() {
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe((e) => this.url.set((e as NavigationEnd).urlAfterRedirects));
  }

  toggleCollapsed() {
    this.collapsed.update((v) => !v);
    try {
      localStorage.setItem(COLLAPSE_KEY, this.collapsed() ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  private readCollapsed(): boolean {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  }
}
