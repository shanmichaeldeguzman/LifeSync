import { Component, computed, inject, signal, type OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonTitle, IonToolbar, ModalController } from '@ionic/angular';
import { DataService } from '../../core/data/data.service';
import type { Category, TableName, TransactionCategory, TxType } from '../../core/models';
import { UiService } from '../../core/services/ui.service';
import { ColorPickerComponent, IconPickerComponent } from './pickers.component';
import { SyncBadgeComponent } from './sync-badge.component';

type CategoryTable = 'task_categories' | 'event_categories' | 'note_categories' | 'transaction_categories';

/** Create, rename, recolor and delete categories for any module. */
@Component({
  selector: 'app-category-manager',
  imports: [IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonIcon, FormsModule, ColorPickerComponent, IconPickerComponent, SyncBadgeComponent],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-button (click)="close()">Close</ion-button></ion-buttons>
        <ion-title>{{ title }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <div class="ls-modal-body">
        @if (isTransaction) {
          <div class="ls-segmented" style="margin-bottom:16px">
            <button type="button" [class.active]="txType() === 'expense'" (click)="txType.set('expense')">Expense</button>
            <button type="button" [class.active]="txType() === 'income'" (click)="txType.set('income')">Income</button>
          </div>
        }

        <div class="ls-card flush">
          @for (c of categories(); track c.id) {
            <div class="ls-row clickable" (click)="edit(c)" (keydown.enter)="edit(c)" tabindex="0">
              <span class="ls-icon-tile sm" [style.background]="c.color + '1f'" [style.color]="c.color"><ion-icon [name]="c.icon"></ion-icon></span>
              <div class="grow"><div class="title">{{ c.name }}</div></div>
              <app-sync-badge [status]="c._status"></app-sync-badge>
              <button class="ls-icon-btn ghost" (click)="remove(c, $event)" [attr.aria-label]="'Delete ' + c.name"><ion-icon name="trash-outline"></ion-icon></button>
            </div>
          } @empty {
            <div class="ls-row"><span class="ls-muted ls-small">No categories yet.</span></div>
          }
        </div>

        <h3 class="ls-group-label">{{ editingId() ? 'Edit category' : 'New category' }}</h3>
        <form class="ls-form ls-card" (ngSubmit)="save()">
          <div>
            <label class="ls-field-label" for="cat-name">Name</label>
            <input id="cat-name" class="ls-native-input" name="name" [(ngModel)]="name" maxlength="60" placeholder="e.g. Fitness" required [class.invalid]="error()" />
            @if (error()) { <div class="ls-field-error">{{ error() }}</div> }
          </div>
          <div>
            <span class="ls-field-label">Color</span>
            <app-color-picker [(value)]="color"></app-color-picker>
          </div>
          <div>
            <span class="ls-field-label">Icon</span>
            <app-icon-picker [(value)]="icon" [color]="color"></app-icon-picker>
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            @if (editingId()) { <ion-button fill="clear" color="medium" (click)="reset()">Cancel</ion-button> }
            <ion-button type="submit" [disabled]="saving()">{{ editingId() ? 'Save changes' : 'Add category' }}</ion-button>
          </div>
        </form>
      </div>
    </ion-content>
  `,
})
export class CategoryManagerModal implements OnInit {
  /** Set via componentProps */
  table: CategoryTable = 'task_categories';
  title = 'Categories';
  initialType: TxType = 'expense';

  private readonly data = inject(DataService);
  private readonly ui = inject(UiService);
  private readonly modal = inject(ModalController);

  readonly txType = signal<TxType>('expense');
  readonly editingId = signal<string | null>(null);
  readonly saving = signal(false);
  readonly error = signal('');
  name = '';
  color = '#635BFF';
  icon = 'pricetag-outline';

  get isTransaction() {
    return this.table === 'transaction_categories';
  }

  readonly categories = computed(() => {
    const list = this.data.list(this.table as TableName)() as unknown as (Category & Partial<TransactionCategory>)[];
    return list
      .filter((c) => !this.isTransaction || c.type === this.txType())
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  ngOnInit() {
    this.txType.set(this.initialType);
  }

  edit(c: Category) {
    this.editingId.set(c.id);
    this.name = c.name;
    this.color = c.color;
    this.icon = c.icon;
    this.error.set('');
  }

  reset() {
    this.editingId.set(null);
    this.name = '';
    this.color = '#635BFF';
    this.icon = 'pricetag-outline';
    this.error.set('');
  }

  async save() {
    const name = this.name.trim();
    if (!name) return this.error.set('Please enter a name.');
    const duplicate = this.categories().some((c) => c.name.toLowerCase() === name.toLowerCase() && c.id !== this.editingId());
    if (duplicate) return this.error.set('A category with this name already exists.');
    this.saving.set(true);
    try {
      const values = { name, color: this.color, icon: this.icon };
      if (this.editingId()) {
        await this.data.update(this.table, this.editingId()!, values);
        await this.ui.success('Category updated');
      } else {
        await this.data.create(this.table, this.isTransaction ? { ...values, type: this.txType() } : values);
        await this.ui.success('Category added');
      }
      this.reset();
    } catch (e) {
      await this.ui.error(e);
    } finally {
      this.saving.set(false);
    }
  }

  async remove(c: Category, ev: Event) {
    ev.stopPropagation();
    const ok = await this.ui.confirm({
      header: 'Delete category?',
      message: `"${c.name}" will be removed. Items in this category will become uncategorized.`,
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    await this.data.remove(this.table, c.id);
    if (this.editingId() === c.id) this.reset();
    await this.ui.success('Category deleted');
  }

  close() {
    void this.modal.dismiss();
  }
}
