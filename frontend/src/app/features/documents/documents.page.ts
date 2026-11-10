import { Component, computed, inject, signal } from '@angular/core';
import { IonButtons, IonContent, IonFab, IonFabButton, IonHeader, IonIcon, IonSearchbar, IonTitle, IonToolbar, ModalController } from '@ionic/angular';
import { DataService } from '../../core/data/data.service';
import type { DocumentCategory, LifeDocument } from '../../core/models';
import { diffInDays, formatDate, parseDateKey } from '../../core/utils/date';
import { DOCUMENT_CATEGORIES, fileSize } from '../../core/utils/format';
import { EmptyStateComponent } from '../../shared/components/empty-state.component';
import { HeaderActionsComponent } from '../../shared/components/header-actions.component';
import { SkeletonComponent } from '../../shared/components/skeleton.component';
import { SyncBadgeComponent } from '../../shared/components/sync-badge.component';
import { DocumentFormModal } from './document-form.modal';
import { DocumentPreviewModal } from './document-preview.modal';

@Component({
  selector: 'app-documents',
  imports: [IonHeader, IonToolbar, IonTitle, IonButtons, IonContent, IonIcon, IonFab, IonFabButton, IonSearchbar, HeaderActionsComponent, EmptyStateComponent, SkeletonComponent, SyncBadgeComponent],
  template: `
    <ion-header class="ion-hide-lg-up">
      <ion-toolbar>
        <ion-title>Documents</ion-title>
        <ion-buttons slot="end"><app-header-actions></app-header-actions></ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <div class="ls-page">
        <div class="ls-page-header">
          <div><h1 class="page-title">Documents</h1><p>Your important files, private and organized · {{ docs().length }} stored</p></div>
          <div class="actions ion-hide-lg-down"><app-header-actions></app-header-actions></div>
        </div>

        @if (expiring().length) {
          <div class="ls-banner warning" style="margin-bottom:14px">
            <ion-icon name="alarm-outline"></ion-icon>
            <span>{{ expiring().length }} document{{ expiring().length === 1 ? '' : 's' }} expiring soon or expired. <button class="link" (click)="onlyExpiring.set(true)">Show</button></span>
          </div>
        }

        <ion-searchbar class="ls-search" placeholder="Search documents" [debounce]="200" (ionInput)="search.set($any($event).detail.value ?? '')" aria-label="Search documents"></ion-searchbar>
        <div class="ls-filter-bar" style="margin-top:12px">
          <button class="ls-filter-chip" [class.active]="!category() && !onlyExpiring()" (click)="category.set(''); onlyExpiring.set(false)">All</button>
          <button class="ls-filter-chip" [class.active]="onlyExpiring()" (click)="onlyExpiring.set(!onlyExpiring())"><ion-icon name="alarm-outline" style="vertical-align:-2px"></ion-icon> Expiring</button>
          @for (c of usedCategories(); track c.value) {
            <button class="ls-filter-chip" [class.active]="category() === c.value" (click)="category.set(category() === c.value ? '' : c.value)"><ion-icon [name]="c.icon" style="vertical-align:-2px"></ion-icon> {{ c.label }}</button>
          }
        </div>

        @if (!data.ready()) {
          <app-skeleton variant="cards" [rows]="6"></app-skeleton>
        } @else if (visible().length === 0) {
          <div class="ls-card">
            @if (docs().length) {
              <app-empty-state icon="search-outline" title="No matching documents" message="Try another search or category."></app-empty-state>
            } @else {
              <app-empty-state icon="folder-open-outline" title="Keep important papers in one place" message="Upload IDs, insurance cards, certificates or receipts. Get reminded before they expire." actionText="Upload document" (action)="upload()"></app-empty-state>
            }
          </div>
        } @else {
          <div class="ls-grid cols-3">
            @for (d of visible(); track d.id) {
              <button class="doc ls-card interactive ls-fade-in" (click)="preview(d)">
                <span class="ls-icon-tile" [class.pdf]="d.mime_type === 'application/pdf'"><ion-icon [name]="d.mime_type === 'application/pdf' ? 'document-text-outline' : 'image-outline'"></ion-icon></span>
                <div class="body">
                  <strong class="ls-truncate">{{ d.title }}</strong>
                  <span class="ls-muted ls-small">{{ catLabel(d.category) }} · {{ size(d.size_bytes) }}</span>
                  <div class="chips">
                    @if (expiry(d); as e) { <span class="ls-chip" [class]="'ls-chip ' + e.tone"><ion-icon name="alarm-outline"></ion-icon>{{ e.label }}</span> }
                    <app-sync-badge [status]="d._status"></app-sync-badge>
                  </div>
                </div>
              </button>
            }
          </div>
        }
        <p class="ls-hint" style="text-align:center;margin-top:20px"><ion-icon name="lock-closed-outline" style="vertical-align:-2px"></ion-icon> Files are stored in private storage accessible only to your account.</p>
      </div>
      <ion-fab slot="fixed" vertical="bottom" horizontal="end" class="ls-fab">
        <ion-fab-button (click)="upload()" aria-label="Upload document"><ion-icon name="cloud-upload-outline"></ion-icon></ion-fab-button>
      </ion-fab>
    </ion-content>
  `,
  styles: `
    .doc { display: flex; gap: 14px; align-items: flex-start; text-align: left; font: inherit; color: inherit; width: 100%; }
    .doc .body { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; }
    .ls-icon-tile.pdf { background: var(--ls-danger-soft); color: var(--ion-color-danger); }
    .chips { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
    .link { background: none; border: 0; color: var(--ion-color-primary); font: inherit; font-weight: 700; cursor: pointer; padding: 0; }
  `,
})
export class DocumentsPage {
  readonly data = inject(DataService);
  private readonly modal = inject(ModalController);

  readonly search = signal('');
  readonly category = signal<'' | DocumentCategory>('');
  readonly onlyExpiring = signal(false);
  readonly docs = computed(() => [...this.data.list('documents')()].sort((a, b) => b.created_at.localeCompare(a.created_at)));
  readonly usedCategories = computed(() => {
    const used = new Set(this.docs().map((d) => d.category));
    return DOCUMENT_CATEGORIES.filter((c) => used.has(c.value));
  });
  readonly expiring = computed(() => this.docs().filter((d) => this.expiry(d)?.tone !== undefined && this.expiry(d)!.tone !== ''));

  readonly visible = computed(() => {
    const q = this.search().trim().toLowerCase();
    return this.docs()
      .filter((d) => !this.category() || d.category === this.category())
      .filter((d) => !this.onlyExpiring() || this.expiring().includes(d))
      .filter((d) => !q || d.title.toLowerCase().includes(q) || d.description.toLowerCase().includes(q) || d.file_name.toLowerCase().includes(q));
  });

  expiry(d: LifeDocument): { label: string; tone: string } | null {
    if (!d.expires_at) return null;
    const days = diffInDays(parseDateKey(d.expires_at), new Date());
    if (days < 0) return { label: 'Expired', tone: 'danger' };
    if (days === 0) return { label: 'Expires today', tone: 'danger' };
    if (days <= d.remind_days_before) return { label: `Expires in ${days}d`, tone: 'warning' };
    return { label: `Expires ${formatDate(d.expires_at, { month: 'short', year: 'numeric' })}`, tone: '' };
  }

  catLabel(c: DocumentCategory) {
    return DOCUMENT_CATEGORIES.find((x) => x.value === c)?.label ?? 'Other';
  }
  size(n: number) {
    return fileSize(n);
  }

  async upload() {
    const m = await this.modal.create({ component: DocumentFormModal, cssClass: 'ls-modal' });
    await m.present();
  }

  async preview(d: LifeDocument) {
    const m = await this.modal.create({ component: DocumentPreviewModal, componentProps: { doc: d }, cssClass: 'ls-modal wide' });
    await m.present();
  }
}
