import { Component, computed, inject, signal, type OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonTitle, IonToolbar, ModalController } from '@ionic/angular';
import { DataService } from '../../core/data/data.service';
import type { PaymentMethod, Transaction, TxType } from '../../core/models';
import { UiService } from '../../core/services/ui.service';
import { dateKey } from '../../core/utils/date';
import { PAYMENT_METHODS } from '../../core/utils/format';
import { CategoryManagerModal } from '../../shared/components/category-manager.modal';

@Component({
  selector: 'app-transaction-form',
  imports: [IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonIcon, FormsModule],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-button (click)="cancel()">Cancel</ion-button></ion-buttons>
        <ion-title>{{ tx ? 'Edit transaction' : 'New transaction' }}</ion-title>
        <ion-buttons slot="end"><ion-button strong (click)="save()" [disabled]="saving()">Save</ion-button></ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <form class="ls-modal-body ls-form" (ngSubmit)="save()" novalidate>
        <div class="ls-segmented type">
          <button type="button" class="exp" [class.active]="type() === 'expense'" (click)="setType('expense')"><ion-icon name="arrow-up-outline"></ion-icon> Expense</button>
          <button type="button" class="inc" [class.active]="type() === 'income'" (click)="setType('income')"><ion-icon name="arrow-down-outline"></ion-icon> Income</button>
        </div>

        <div class="amount-wrap">
          <label class="ls-field-label" for="tx-amount">Amount ({{ currency() }})</label>
          <input id="tx-amount" name="amount" class="amount" type="number" inputmode="decimal" min="0.01" step="0.01" [(ngModel)]="amount" placeholder="0.00" [class.invalid]="amountError()" />
          @if (amountError()) { <div class="ls-field-error">{{ amountError() }}</div> }
        </div>

        <div>
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span class="ls-field-label">Category</span>
            <button type="button" class="link" (click)="manageCategories()">Manage</button>
          </div>
          <div class="cats">
            @for (c of categories(); track c.id) {
              <button type="button" class="cat" [class.active]="categoryId === c.id" [style.--c]="c.color" (click)="categoryId = categoryId === c.id ? null : c.id">
                <ion-icon [name]="c.icon"></ion-icon><span>{{ c.name }}</span>
              </button>
            }
          </div>
        </div>

        <div class="ls-form-row two">
          <div>
            <label class="ls-field-label" for="tx-date">Date</label>
            <input id="tx-date" name="date" type="date" class="ls-native-input" [(ngModel)]="date" [max]="maxDate" />
          </div>
          <div>
            <label class="ls-field-label" for="tx-method">Payment method</label>
            <select id="tx-method" name="method" class="ls-native-input" [(ngModel)]="method">
              @for (p of methods; track p.value) { <option [value]="p.value">{{ p.label }}</option> }
            </select>
          </div>
        </div>

        <div>
          <label class="ls-field-label" for="tx-desc">Description</label>
          <input id="tx-desc" name="description" class="ls-native-input" [(ngModel)]="description" maxlength="300" placeholder="e.g. Groceries at the market" />
        </div>

        <p class="ls-hint"><ion-icon name="information-circle-outline" style="vertical-align:-2px"></ion-icon> Recorded manually by you. LifeSync never connects to bank accounts.</p>

        @if (tx) {
          <ion-button fill="outline" color="danger" type="button" (click)="remove()"><ion-icon slot="start" name="trash-outline"></ion-icon>Delete transaction</ion-button>
        }
        <button type="submit" hidden></button>
      </form>
    </ion-content>
  `,
  styles: `
    .type button { padding: 12px; display: flex; align-items: center; justify-content: center; gap: 6px; }
    .type .exp.active { border-color: var(--ion-color-danger); color: var(--ion-color-danger); background: var(--ls-danger-soft); }
    .type .inc.active { border-color: var(--ion-color-success); color: #16a34a; background: var(--ls-success-soft); }
    .amount { width: 100%; border: 0; border-bottom: 2px solid var(--ls-border-strong); background: transparent; color: var(--ls-text); font: inherit; font-size: 2.2rem; font-weight: 800; padding: 6px 0; outline: none; font-variant-numeric: tabular-nums; }
    .amount:focus { border-color: var(--ion-color-primary); }
    .amount.invalid { border-color: var(--ion-color-danger); }
    .cats { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px; }
    .cat { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 10px 4px; border-radius: 12px; border: 1px solid var(--ls-border); background: var(--ls-surface); color: var(--ls-text-2); font: inherit; font-size: 0.74rem; font-weight: 600; cursor: pointer; }
    .cat ion-icon { font-size: 20px; color: var(--c); }
    .cat span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cat.active { border-color: var(--c); background: color-mix(in srgb, var(--c) 12%, transparent); color: var(--ls-text); }
    .link { background: none; border: 0; color: var(--ion-color-primary); font-weight: 600; font-size: 0.82rem; cursor: pointer; margin-bottom: 6px; }
  `,
})
export class TransactionFormModal implements OnInit {
  tx?: Transaction;
  initialType: TxType = 'expense';

  private readonly data = inject(DataService);
  private readonly ui = inject(UiService);
  private readonly modal = inject(ModalController);

  readonly methods = PAYMENT_METHODS;
  readonly type = signal<TxType>('expense');
  readonly saving = signal(false);
  readonly amountError = signal('');
  readonly currency = computed(() => this.data.profile()?.currency ?? 'USD');
  readonly categories = computed(() => this.data.list('transaction_categories')().filter((c) => c.type === this.type()).sort((a, b) => a.name.localeCompare(b.name)));
  readonly maxDate = dateKey(new Date(Date.now() + 366 * 86400000));

  amount: number | null = null;
  categoryId: string | null = null;
  date = dateKey();
  method: PaymentMethod = 'cash';
  description = '';

  ngOnInit() {
    const t = this.tx;
    this.type.set(t?.type ?? this.initialType);
    if (!t) return;
    this.amount = Number(t.amount);
    this.categoryId = t.category_id;
    this.date = t.transaction_date;
    this.method = t.payment_method;
    this.description = t.description;
  }

  setType(t: TxType) {
    this.type.set(t);
    if (this.categoryId && this.data.find('transaction_categories', this.categoryId)?.type !== t) this.categoryId = null;
  }

  async manageCategories() {
    const m = await this.modal.create({ component: CategoryManagerModal, componentProps: { table: 'transaction_categories', title: 'Finance categories', initialType: this.type() }, cssClass: 'ls-modal' });
    await m.present();
  }

  async save() {
    const amount = Number(this.amount);
    if (!amount || amount <= 0) this.amountError.set('Enter an amount greater than zero.');
    else if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) this.amountError.set('Use at most 2 decimal places.');
    else if (amount >= 1e12) this.amountError.set('That amount is too large.');
    else this.amountError.set('');
    if (this.amountError() || this.saving()) return;

    const values: Partial<Transaction> = {
      type: this.type(),
      amount: Math.round(amount * 100) / 100,
      category_id: this.categoryId,
      transaction_date: this.date || dateKey(),
      payment_method: this.method,
      description: this.description.trim(),
    };
    this.saving.set(true);
    try {
      if (this.tx) await this.data.update('transactions', this.tx.id, values);
      else await this.data.create('transactions', values);
      await this.ui.success(this.tx ? 'Transaction updated' : 'Transaction recorded');
      await this.modal.dismiss(true, 'saved');
    } catch (e) {
      await this.ui.error(e);
    } finally {
      this.saving.set(false);
    }
  }

  async remove() {
    if (!this.tx) return;
    const ok = await this.ui.confirm({ header: 'Delete transaction?', message: 'This record will be permanently removed.', confirmText: 'Delete', destructive: true });
    if (!ok) return;
    await this.data.remove('transactions', this.tx.id);
    await this.ui.success('Transaction deleted');
    await this.modal.dismiss(true, 'deleted');
  }

  cancel() {
    void this.modal.dismiss(null, 'cancel');
  }
}
