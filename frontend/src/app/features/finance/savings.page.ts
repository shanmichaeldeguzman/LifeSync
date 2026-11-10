import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonBackButton, IonButton, IonButtons, IonContent, IonFab, IonFabButton, IonHeader, IonIcon, IonTitle, IonToolbar } from '@ionic/angular';
import { DataService } from '../../core/data/data.service';
import type { SavingsGoal } from '../../core/models';
import { UiService } from '../../core/services/ui.service';
import { diffInDays, formatDate, parseDateKey } from '../../core/utils/date';
import { EmptyStateComponent } from '../../shared/components/empty-state.component';
import { ColorPickerComponent } from '../../shared/components/pickers.component';
import { ProgressRingComponent } from '../../shared/components/progress-ring.component';
import { SyncBadgeComponent } from '../../shared/components/sync-badge.component';
import { FinanceStore } from './finance.store';

@Component({
  selector: 'app-savings',
  imports: [IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonButton, IonContent, IonIcon, IonFab, IonFabButton, FormsModule, EmptyStateComponent, ColorPickerComponent, ProgressRingComponent, SyncBadgeComponent],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/finance" text=""></ion-back-button></ion-buttons>
        <ion-title>Savings goals</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <div class="ls-page">
        @if (editing()) {
          <form class="ls-card ls-form" (ngSubmit)="save()" style="margin-bottom:16px;max-width:640px">
            <h3 style="font-size:1rem">{{ editing()!.id ? 'Edit goal' : 'New savings goal' }}</h3>
            <div>
              <label class="ls-field-label" for="s-name">Name</label>
              <input id="s-name" name="name" class="ls-native-input" [(ngModel)]="name" maxlength="100" placeholder="e.g. Emergency fund" [class.invalid]="errors()['name']" />
              @if (errors()['name']) { <div class="ls-field-error">{{ errors()['name'] }}</div> }
            </div>
            <div class="ls-form-row two">
              <div>
                <label class="ls-field-label" for="s-target">Target ({{ store.currency() }})</label>
                <input id="s-target" name="target" class="ls-native-input" type="number" min="0.01" step="0.01" [(ngModel)]="target" [class.invalid]="errors()['target']" />
                @if (errors()['target']) { <div class="ls-field-error">{{ errors()['target'] }}</div> }
              </div>
              <div>
                <label class="ls-field-label" for="s-current">Saved so far</label>
                <input id="s-current" name="current" class="ls-native-input" type="number" min="0" step="0.01" [(ngModel)]="current" />
              </div>
            </div>
            <div>
              <label class="ls-field-label" for="s-date">Target date (optional)</label>
              <input id="s-date" name="date" class="ls-native-input" type="date" [(ngModel)]="targetDate" />
            </div>
            <div><span class="ls-field-label">Color</span><app-color-picker [(value)]="color"></app-color-picker></div>
            <div style="display:flex;gap:8px;justify-content:flex-end">
              <ion-button fill="clear" color="medium" (click)="editing.set(null)">Cancel</ion-button>
              <ion-button type="submit" [disabled]="saving()">Save</ion-button>
            </div>
          </form>
        }

        @if (goals().length) {
          <div class="ls-grid cols-3">
            @for (g of goals(); track g.id) {
              <div class="ls-card">
                <div style="display:flex;gap:14px;align-items:center">
                  <app-progress-ring [value]="pct(g)" [size]="70" [color]="g.color"></app-progress-ring>
                  <div style="flex:1;min-width:0">
                    <h3 class="ls-truncate" style="font-size:1rem">{{ g.name }}</h3>
                    <div class="ls-money" style="font-size:1.1rem;margin-top:4px">{{ store.format(g.current_amount) }}</div>
                    <div class="ls-muted ls-small">of {{ store.format(g.target_amount) }}</div>
                  </div>
                  <app-sync-badge [status]="g._status"></app-sync-badge>
                </div>
                @if (g.target_date) {
                  <div class="ls-small ls-muted" style="margin-top:12px"><ion-icon name="calendar-outline" style="vertical-align:-2px"></ion-icon> {{ dueLabel(g) }}</div>
                }
                @if (pct(g) >= 100) { <div class="ls-chip success" style="margin-top:10px"><ion-icon name="trophy-outline"></ion-icon>Goal reached!</div> }
                <div class="actions">
                  <ion-button size="small" (click)="contribute(g)"><ion-icon slot="start" name="add"></ion-icon>Add money</ion-button>
                  <button class="ls-icon-btn" (click)="edit(g)" aria-label="Edit goal"><ion-icon name="create-outline"></ion-icon></button>
                  <button class="ls-icon-btn" (click)="remove(g)" aria-label="Delete goal"><ion-icon name="trash-outline"></ion-icon></button>
                </div>
              </div>
            }
          </div>
        } @else if (!editing()) {
          <div class="ls-card"><app-empty-state icon="trophy-outline" title="Save for what matters" message="Create a goal like an emergency fund, a trip or a new laptop, and track your progress." actionText="New goal" (action)="create()"></app-empty-state></div>
        }
      </div>
      <ion-fab slot="fixed" vertical="bottom" horizontal="end" class="ls-fab">
        <ion-fab-button (click)="create()" aria-label="New savings goal"><ion-icon name="add"></ion-icon></ion-fab-button>
      </ion-fab>
    </ion-content>
  `,
  styles: `.actions { display: flex; gap: 8px; align-items: center; margin-top: 14px; } .actions ion-button { flex: 1; }`,
})
export class SavingsPage {
  readonly store = inject(FinanceStore);
  private readonly data = inject(DataService);
  private readonly ui = inject(UiService);

  readonly goals = computed(() => [...this.data.list('savings_goals')()].sort((a, b) => a.created_at.localeCompare(b.created_at)));
  readonly editing = signal<Partial<SavingsGoal> | null>(null);
  readonly saving = signal(false);
  readonly errors = signal<Record<string, string>>({});
  name = '';
  target: number | null = null;
  current: number | null = 0;
  targetDate = '';
  color = '#635BFF';

  pct(g: SavingsGoal) {
    return Math.min(100, Math.round((Number(g.current_amount) / Number(g.target_amount)) * 100));
  }
  dueLabel(g: SavingsGoal) {
    const days = diffInDays(parseDateKey(g.target_date!), new Date());
    const remaining = Math.max(0, Number(g.target_amount) - Number(g.current_amount));
    if (days < 0) return `Target date was ${formatDate(g.target_date!)}`;
    const months = Math.max(1, Math.ceil(days / 30));
    return `${formatDate(g.target_date!)} · about ${this.store.format(remaining / months)}/month to go`;
  }

  create() {
    this.name = '';
    this.target = null;
    this.current = 0;
    this.targetDate = '';
    this.color = '#635BFF';
    this.errors.set({});
    this.editing.set({});
  }
  edit(g: SavingsGoal) {
    this.name = g.name;
    this.target = Number(g.target_amount);
    this.current = Number(g.current_amount);
    this.targetDate = g.target_date ?? '';
    this.color = g.color;
    this.errors.set({});
    this.editing.set(g);
  }

  async save() {
    const errs: Record<string, string> = {};
    if (!this.name.trim()) errs['name'] = 'Please enter a name.';
    if (!Number(this.target) || Number(this.target) <= 0) errs['target'] = 'Enter a target greater than zero.';
    this.errors.set(errs);
    if (Object.keys(errs).length || this.saving()) return;
    const values = { name: this.name.trim(), target_amount: Math.round(Number(this.target) * 100) / 100, current_amount: Math.max(0, Math.round(Number(this.current || 0) * 100) / 100), target_date: this.targetDate || null, color: this.color };
    this.saving.set(true);
    try {
      const id = this.editing()?.id;
      if (id) await this.data.update('savings_goals', id, values);
      else await this.data.create('savings_goals', values);
      this.editing.set(null);
      await this.ui.success('Savings goal saved');
    } catch (e) {
      await this.ui.error(e);
    } finally {
      this.saving.set(false);
    }
  }

  async contribute(g: SavingsGoal) {
    const res = await this.ui.prompt({ header: 'Add to savings', message: `How much did you put toward "${g.name}"? Use a negative number to withdraw.`, inputs: [{ name: 'amount', type: 'number', placeholder: 'Amount' }], confirmText: 'Add' });
    if (!res) return;
    const amount = Number(res['amount']);
    if (!amount || !isFinite(amount)) return void this.ui.toast('Enter a valid amount.', 'warning');
    const next = Math.max(0, Math.round((Number(g.current_amount) + amount) * 100) / 100);
    await this.data.update('savings_goals', g.id, { current_amount: next });
    await this.ui.success(next >= Number(g.target_amount) ? 'Goal reached. Congratulations!' : 'Savings updated');
  }

  async remove(g: SavingsGoal) {
    const ok = await this.ui.confirm({ header: 'Delete goal?', message: `"${g.name}" will be removed.`, confirmText: 'Delete', destructive: true });
    if (ok) await this.data.remove('savings_goals', g.id);
  }
}
