import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { DataService } from '../../core/data/data.service';
import { SyncService } from '../../core/data/sync.service';
import { NetworkService } from '../../core/services/network.service';

/** Toolbar actions shown on every page: sync status and the notification bell. */
@Component({
  selector: 'app-header-actions',
  imports: [IonIcon, RouterLink],
  template: `
    <a class="sync" routerLink="/settings/sync" [attr.aria-label]="label()" [title]="label()">
      <ion-icon [name]="icon()" [class.spin]="sync.state() === 'syncing'" [style.color]="color()"></ion-icon>
      @if (data.pendingCount() > 0) {
        <span class="count">{{ data.pendingCount() }}</span>
      }
    </a>
    <a class="bell" routerLink="/notifications" [attr.aria-label]="'Notifications, ' + unread() + ' unread'">
      <ion-icon name="notifications-outline"></ion-icon>
      @if (unread() > 0) {
        <span class="badge">{{ unread() > 9 ? '9+' : unread() }}</span>
      }
    </a>
  `,
  styles: `
    :host { display: inline-flex; align-items: center; gap: 6px; }
    a {
      position: relative;
      width: 40px;
      height: 40px;
      border-radius: 12px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--ls-text-2);
      font-size: 21px;
      background: var(--ls-surface);
      border: 1px solid var(--ls-border);
    }
    .badge {
      position: absolute;
      top: -4px;
      right: -4px;
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      border-radius: 9px;
      background: var(--ion-color-danger);
      color: #fff;
      font-size: 0.66rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2px solid var(--ion-background-color);
    }
    .count {
      position: absolute;
      bottom: -3px;
      right: -3px;
      font-size: 0.6rem;
      font-weight: 700;
      background: var(--ion-color-primary);
      color: #fff;
      border-radius: 8px;
      padding: 0 4px;
      border: 2px solid var(--ion-background-color);
    }
    .spin { animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  `,
})
export class HeaderActionsComponent {
  readonly data = inject(DataService);
  readonly sync = inject(SyncService);
  private readonly network = inject(NetworkService);

  readonly unread = computed(() => this.data.list('notifications')().filter((n) => !n.read_at).length);
  readonly icon = computed(() => {
    if (!this.network.online()) return 'cloud-offline-outline';
    if (this.data.conflicts().length || this.sync.state() === 'error') return 'alert-circle-outline';
    if (this.sync.state() === 'syncing') return 'sync-outline';
    return this.data.pendingCount() ? 'cloud-upload-outline' : 'cloud-done-outline';
  });
  readonly color = computed(() => {
    if (!this.network.online() || this.data.conflicts().length || this.sync.state() === 'error') return 'var(--ion-color-warning)';
    return this.data.pendingCount() ? 'var(--ion-color-primary)' : 'var(--ion-color-success)';
  });
  readonly label = computed(() => {
    if (!this.network.online()) return 'Offline: changes saved on this device';
    if (this.data.conflicts().length) return 'Some changes need your review';
    if (this.data.pendingCount()) return `${this.data.pendingCount()} changes waiting to sync`;
    return 'All changes synced';
  });
}
