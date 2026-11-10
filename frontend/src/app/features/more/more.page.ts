import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonContent, IonHeader, IonIcon, IonTitle, IonToolbar } from '@ionic/angular';
import { DataService } from '../../core/data/data.service';
import { AuthService } from '../../core/services/auth.service';
import { SessionService } from '../../core/services/session.service';
import { initials } from '../../core/utils/format';
import { AvatarComponent } from '../../shared/components/avatar.component';

/** Mobile hub for every module not on the bottom bar. */
@Component({
  selector: 'app-more',
  imports: [IonHeader, IonToolbar, IonTitle, IonContent, IonIcon, RouterLink, AvatarComponent],
  template: `
    <ion-header>
      <ion-toolbar><ion-title>More</ion-title></ion-toolbar>
    </ion-header>
    <ion-content>
      <div class="ls-page narrow">
        <a class="ls-card profile" routerLink="/settings">
          <app-avatar [path]="data.profile()?.avatar_path ?? null" [initials]="userInitials()" [size]="52"></app-avatar>
          <div style="min-width:0;flex:1">
            <strong class="ls-truncate" style="display:block">{{ data.profile()?.full_name || 'Your account' }}</strong>
            <span class="ls-muted ls-small ls-truncate" style="display:block">{{ auth.user()?.email }}</span>
          </div>
          <ion-icon name="chevron-forward" class="ls-muted"></ion-icon>
        </a>

        <div class="tiles">
          @for (m of modules; track m.path) {
            <a class="tile" [routerLink]="m.path" [style.--c]="m.color">
              <span class="icon"><ion-icon [name]="m.icon"></ion-icon></span>
              <strong>{{ m.label }}</strong>
              <span class="desc">{{ m.desc }}</span>
              @if (m.path === '/notifications' && unread() > 0) { <span class="badge">{{ unread() }}</span> }
            </a>
          }
        </div>

        <div class="ls-card flush" style="margin-top:16px">
          <a class="ls-row clickable" routerLink="/settings/sync" style="text-decoration:none">
            <span class="ls-icon-tile sm"><ion-icon name="sync-outline"></ion-icon></span>
            <div class="grow"><div class="title">Sync & offline data</div><div class="meta">{{ data.pendingCount() }} pending · {{ data.conflicts().length }} to review</div></div>
            <ion-icon name="chevron-forward" class="ls-muted"></ion-icon>
          </a>
          <a class="ls-row clickable" routerLink="/settings" style="text-decoration:none">
            <span class="ls-icon-tile sm"><ion-icon name="settings-outline"></ion-icon></span>
            <div class="grow"><div class="title">Settings</div><div class="meta">Profile, theme, notifications, privacy</div></div>
            <ion-icon name="chevron-forward" class="ls-muted"></ion-icon>
          </a>
          <button class="ls-row clickable signout" (click)="session.signOut()">
            <span class="ls-icon-tile sm" style="background:var(--ls-danger-soft);color:var(--ion-color-danger)"><ion-icon name="log-out-outline"></ion-icon></span>
            <div class="grow"><div class="title" style="color:var(--ion-color-danger)">Sign out</div></div>
          </button>
        </div>
      </div>
    </ion-content>
  `,
  styles: `
    .profile { display: flex; align-items: center; gap: 14px; text-decoration: none; color: inherit; margin-bottom: 16px; }
    .tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .tile { position: relative; display: flex; flex-direction: column; gap: 4px; padding: 16px; border-radius: var(--ls-radius-lg); background: var(--ls-surface); border: 1px solid var(--ls-border); text-decoration: none; color: var(--ls-text); }
    .tile .icon { width: 42px; height: 42px; border-radius: 13px; display: flex; align-items: center; justify-content: center; font-size: 22px; background: color-mix(in srgb, var(--c) 14%, transparent); color: var(--c); margin-bottom: 6px; }
    .tile .desc { font-size: 0.76rem; color: var(--ls-text-2); }
    .badge { position: absolute; top: 12px; right: 12px; background: var(--ion-color-danger); color: #fff; border-radius: 99px; font-size: 0.7rem; font-weight: 700; padding: 2px 8px; }
    .signout { width: 100%; border: 0; font: inherit; text-align: left; }
  `,
})
export class MorePage {
  readonly data = inject(DataService);
  readonly auth = inject(AuthService);
  readonly session = inject(SessionService);
  readonly unread = computed(() => this.data.list('notifications')().filter((n) => !n.read_at).length);
  readonly userInitials = computed(() => initials(this.data.profile()?.full_name, this.auth.user()?.email));

  readonly modules = [
    { path: '/notes', label: 'Notes', desc: 'Ideas & lists', icon: 'document-text-outline', color: '#F59E0B' },
    { path: '/habits', label: 'Habits', desc: 'Daily routines', icon: 'leaf-outline', color: '#22C55E' },
    { path: '/finance', label: 'Finance', desc: 'Money & budgets', icon: 'wallet-outline', color: '#0EA5E9' },
    { path: '/documents', label: 'Documents', desc: 'Private files', icon: 'folder-open-outline', color: '#8B5CF6' },
    { path: '/goals', label: 'Goals', desc: 'Milestones', icon: 'flag-outline', color: '#EC4899' },
    { path: '/notifications', label: 'Notifications', desc: 'Reminders', icon: 'notifications-outline', color: '#635BFF' },
  ];
}
