import { Component, computed, inject, signal } from '@angular/core';
import { IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonSpinner, IonTitle, IonToolbar } from '@ionic/angular';
import { DataService } from '../../core/data/data.service';
import type { ConflictEntry, OutboxEntry } from '../../core/data/local-db';
import { SyncService } from '../../core/data/sync.service';
import { NetworkService } from '../../core/services/network.service';
import { UiService } from '../../core/services/ui.service';
import { timeAgo } from '../../core/utils/date';

const LABELS: Record<string, string> = {
  tasks: 'Task', events: 'Event', notes: 'Note', note_attachments: 'Attachment', habits: 'Habit', habit_logs: 'Habit check-in',
  transactions: 'Transaction', recurring_transactions: 'Recurring rule', budgets: 'Budget', savings_goals: 'Savings goal',
  documents: 'Document', goals: 'Goal', goal_milestones: 'Milestone', notifications: 'Notification',
  task_categories: 'Task category', event_categories: 'Event category', note_categories: 'Note category', transaction_categories: 'Finance category',
};

/** Sync status, pending changes and conflict resolution. */
@Component({
  selector: 'app-sync',
  imports: [IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonButton, IonContent, IonIcon, IonSpinner],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/settings" text=""></ion-back-button></ion-buttons>
        <ion-title>Sync & offline data</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <div class="ls-page narrow">
        <div class="ls-card status">
          <span class="ls-icon-tile" [style.background]="tone().bg" [style.color]="tone().fg"><ion-icon [name]="tone().icon"></ion-icon></span>
          <div style="flex:1">
            <strong>{{ tone().title }}</strong>
            <div class="ls-muted ls-small">{{ data.lastSyncedAt() ? 'Last synced ' + ago(data.lastSyncedAt()!) : 'Not synced yet' }}@if (sync.lastError()) { · {{ sync.lastError() }} }</div>
          </div>
          <ion-button (click)="syncNow()" [disabled]="!network.online() || sync.state() === 'syncing'">
            @if (sync.state() === 'syncing') { <ion-spinner name="crescent"></ion-spinner> } @else { Sync now }
          </ion-button>
        </div>

        <div class="ls-banner" style="margin:14px 0">
          <ion-icon name="information-circle-outline"></ion-icon>
          <span>LifeSync saves every change on this device first, then syncs it to your private cloud account. Items marked <strong>Local</strong> are saved on this device but not yet in the cloud.</span>
        </div>

        @if (data.conflicts().length) {
          <div class="ls-group-label">Needs your review ({{ data.conflicts().length }})</div>
          @for (c of data.conflicts(); track c.key) {
            <div class="ls-card conflict">
              <div class="head">
                <span class="ls-chip warning">{{ label(c.table) }}</span>
                <strong class="ls-truncate">{{ name(c.local) }}</strong>
              </div>
              <p class="ls-small">{{ explain(c) }}</p>
              @if (c.kind === 'conflict' && c.server) {
                <div class="compare">
                  <div><span>This device</span><strong>{{ name(c.local) }}</strong></div>
                  <div><span>Other device</span><strong>{{ name(c.server) }}</strong><small>{{ ago(asString(c.server['updated_at'])) }}</small></div>
                </div>
              }
              <div class="actions">
                @switch (c.kind) {
                  @case ('conflict') {
                    <ion-button size="small" (click)="resolve(c, 'local')">Keep this device's version</ion-button>
                    <ion-button size="small" fill="outline" (click)="resolve(c, 'server')">Use other version</ion-button>
                    @if (c.table === 'notes') { <ion-button size="small" fill="clear" (click)="resolve(c, 'both')">Keep both</ion-button> }
                  }
                  @case ('deleted') {
                    <ion-button size="small" (click)="resolve(c, 'local')">Restore it</ion-button>
                    <ion-button size="small" fill="outline" color="medium" (click)="resolve(c, 'server')">Discard</ion-button>
                  }
                  @default {
                    <ion-button size="small" (click)="resolve(c, 'local')">Try again</ion-button>
                    <ion-button size="small" fill="outline" color="medium" (click)="resolve(c, 'server')">Discard change</ion-button>
                  }
                }
              </div>
            </div>
          }
        }

        <div class="ls-group-label">Waiting to sync ({{ data.pendingCount() }})</div>
        <div class="ls-card flush">
          @for (o of outbox(); track o.key) {
            <div class="ls-row">
              <span class="ls-icon-tile sm"><ion-icon [name]="o.op === 'delete' ? 'trash-outline' : o.op === 'create' ? 'add-outline' : 'create-outline'"></ion-icon></span>
              <div class="grow">
                <div class="title">{{ label(o.table) }} {{ o.op === 'create' ? 'created' : o.op === 'delete' ? 'deleted' : 'edited' }}</div>
                <div class="meta">{{ o.attempts ? o.attempts + ' attempt(s) · ' + (o.lastError ?? '') : 'Queued' }}</div>
              </div>
            </div>
          } @empty {
            <div class="ls-row"><ion-icon name="cloud-done-outline" style="color:var(--ion-color-success)"></ion-icon><span class="ls-small">Everything on this device is synced.</span></div>
          }
        </div>
      </div>
    </ion-content>
  `,
  styles: `
    .status { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
    .conflict { margin-bottom: 12px; }
    .conflict .head { display: flex; align-items: center; gap: 8px; }
    .conflict p { color: var(--ls-text-2); margin: 8px 0; }
    .compare { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 10px 0; }
    .compare div { background: var(--ls-surface-2); border-radius: 12px; padding: 10px; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .compare span { font-size: 0.72rem; font-weight: 700; color: var(--ls-text-2); text-transform: uppercase; }
    .compare strong { font-size: 0.88rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .compare small { font-size: 0.75rem; color: var(--ls-text-3); }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; }
  `,
})
export class SyncPage {
  readonly data = inject(DataService);
  readonly sync = inject(SyncService);
  readonly network = inject(NetworkService);
  private readonly ui = inject(UiService);
  readonly outbox = signal<OutboxEntry[]>([]);

  constructor() {
    void this.loadOutbox();
  }

  readonly tone = computed(() => {
    if (!this.network.online()) return { title: 'Offline: changes are saved on this device', icon: 'cloud-offline-outline', bg: 'var(--ls-warning-soft)', fg: 'var(--ion-color-warning)' };
    if (this.data.conflicts().length) return { title: 'Some changes need your review', icon: 'alert-circle-outline', bg: 'var(--ls-warning-soft)', fg: 'var(--ion-color-warning)' };
    if (this.sync.state() === 'error') return { title: 'Sync paused', icon: 'alert-circle-outline', bg: 'var(--ls-danger-soft)', fg: 'var(--ion-color-danger)' };
    if (this.data.pendingCount()) return { title: `${this.data.pendingCount()} change(s) waiting to sync`, icon: 'cloud-upload-outline', bg: 'var(--ls-primary-soft)', fg: 'var(--ion-color-primary)' };
    return { title: 'Everything is synced', icon: 'cloud-done-outline', bg: 'var(--ls-success-soft)', fg: 'var(--ion-color-success)' };
  });

  private async loadOutbox() {
    if (this.data.ready()) this.outbox.set(await this.data.outboxEntries());
  }

  label(t: string) {
    return LABELS[t] ?? t;
  }
  name(r: Record<string, unknown>) {
    return String(r['title'] ?? r['name'] ?? r['description'] ?? r['log_date'] ?? 'Item') || 'Untitled';
  }
  asString(v: unknown) {
    return String(v ?? new Date().toISOString());
  }
  ago(iso: string) {
    return timeAgo(iso);
  }
  explain(c: ConflictEntry) {
    if (c.kind === 'conflict') return 'This item was edited on another device while you also changed it here. Choose which version to keep.';
    if (c.kind === 'deleted') return 'This item was deleted on another device, but you edited it here.';
    return `The server couldn't accept this change: ${c.message}`;
  }

  async syncNow() {
    await this.sync.sync({ housekeeping: true });
    await this.loadOutbox();
    if (this.sync.state() === 'idle') await this.ui.success('Sync complete');
  }

  async resolve(c: ConflictEntry, choice: 'local' | 'server' | 'both') {
    try {
      if (choice === 'local') await this.sync.keepLocal(c);
      else if (choice === 'server') await this.sync.keepServer(c);
      else await this.sync.keepBoth(c);
      await this.loadOutbox();
      await this.ui.success('Resolved');
    } catch (e) {
      await this.ui.error(e);
    }
  }
}
