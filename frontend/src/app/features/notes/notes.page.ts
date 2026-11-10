import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IonButtons, IonContent, IonFab, IonFabButton, IonHeader, IonIcon, IonSearchbar, IonTitle, IonToolbar, ModalController } from '@ionic/angular';
import { DataService } from '../../core/data/data.service';
import { SyncService } from '../../core/data/sync.service';
import type { Note } from '../../core/models';
import { timeAgo } from '../../core/utils/date';
import { markdownExcerpt } from '../../core/utils/markdown';
import { CategoryManagerModal } from '../../shared/components/category-manager.modal';
import { EmptyStateComponent } from '../../shared/components/empty-state.component';
import { HeaderActionsComponent } from '../../shared/components/header-actions.component';
import { SkeletonComponent } from '../../shared/components/skeleton.component';
import { SyncBadgeComponent } from '../../shared/components/sync-badge.component';

type Filter = 'all' | 'pinned' | 'favorites' | 'archived';

@Component({
  selector: 'app-notes',
  imports: [IonHeader, IonToolbar, IonTitle, IonButtons, IonContent, IonIcon, IonFab, IonFabButton, IonSearchbar, HeaderActionsComponent, EmptyStateComponent, SkeletonComponent, SyncBadgeComponent],
  template: `
    <ion-header class="ion-hide-lg-up">
      <ion-toolbar>
        <ion-title>Notes</ion-title>
        <ion-buttons slot="end"><app-header-actions></app-header-actions></ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <div class="ls-page">
        <div class="ls-page-header">
          <div><h1>Notes</h1><p>{{ activeCount() }} notes · capture ideas, plans and lists</p></div>
          <div class="actions">
            <button class="ls-icon-btn" (click)="manageCategories()" aria-label="Manage note categories" title="Categories"><ion-icon name="pricetags-outline"></ion-icon></button>
            <span class="ion-hide-lg-down"><app-header-actions></app-header-actions></span>
          </div>
        </div>

        <ion-searchbar class="ls-search" placeholder="Search notes" [debounce]="200" (ionInput)="search.set($any($event).detail.value ?? '')" aria-label="Search notes"></ion-searchbar>

        <div class="ls-filter-bar" style="margin-top:12px">
          @for (f of filters; track f.value) {
            <button class="ls-filter-chip" [class.active]="filter() === f.value" (click)="filter.set(f.value)"><ion-icon [name]="f.icon" style="vertical-align:-2px"></ion-icon> {{ f.label }}</button>
          }
          <span style="width:1px;background:var(--ls-border);margin:4px 2px"></span>
          <button class="ls-filter-chip" [class.active]="!category()" (click)="category.set('')">All categories</button>
          @for (c of categories(); track c.id) {
            <button class="ls-filter-chip" [class.active]="category() === c.id" (click)="category.set(c.id)"><span class="ls-dot" [style.background]="c.color"></span> {{ c.name }}</button>
          }
        </div>

        @if (!data.ready()) {
          <app-skeleton variant="cards" [rows]="6"></app-skeleton>
        } @else if (visible().length === 0) {
          <div class="ls-card">
            @if (search() || category()) {
              <app-empty-state icon="search-outline" title="No matching notes" message="Try another search term or category."></app-empty-state>
            } @else if (filter() === 'archived') {
              <app-empty-state icon="archive-outline" title="No archived notes" message="Archive notes you want to keep but don't need every day."></app-empty-state>
            } @else {
              <app-empty-state icon="document-text-outline" title="Start writing" message="Notes support Markdown: headings, lists, checklists and links." actionText="New note" (action)="create()"></app-empty-state>
            }
          </div>
        } @else {
          <div class="notes-grid">
            @for (n of visible(); track n.id) {
              <article class="note ls-card interactive ls-fade-in" (click)="open(n)" (keydown.enter)="open(n)" tabindex="0" [style.--c]="categoryColor(n)">
                <header>
                  <h3>{{ n.title || 'Untitled' }}</h3>
                  <span class="flags">
                    @if (n.is_pinned) { <ion-icon name="pin" title="Pinned"></ion-icon> }
                    @if (n.is_favorite) { <ion-icon name="star" class="fav" title="Favorite"></ion-icon> }
                  </span>
                </header>
                <p>{{ excerpt(n) || 'No content yet' }}</p>
                <footer>
                  @if (categoryName(n); as name) { <span class="ls-chip" [style.color]="categoryColor(n)" [style.background]="categoryColor(n) + '1a'">{{ name }}</span> }
                  <span class="time">{{ ago(n.updated_at) }}</span>
                  <app-sync-badge [status]="n._status"></app-sync-badge>
                  <button class="ls-icon-btn ghost" (click)="togglePin(n, $event)" [attr.aria-label]="n.is_pinned ? 'Unpin note' : 'Pin note'"><ion-icon [name]="n.is_pinned ? 'pin' : 'pin-outline'"></ion-icon></button>
                </footer>
              </article>
            }
          </div>
        }
      </div>
      <ion-fab slot="fixed" vertical="bottom" horizontal="end" class="ls-fab">
        <ion-fab-button (click)="create()" aria-label="New note"><ion-icon name="create-outline"></ion-icon></ion-fab-button>
      </ion-fab>
    </ion-content>
  `,
  styles: `
    .notes-grid { display: grid; gap: 14px; grid-template-columns: 1fr; margin-top: 6px; }
    @media (min-width: 640px) { .notes-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (min-width: 1100px) { .notes-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
    .note { display: flex; flex-direction: column; gap: 8px; min-height: 160px; border-top: 3px solid var(--c); }
    .note header { display: flex; align-items: flex-start; gap: 8px; }
    .note h3 { font-size: 1rem; font-weight: 700; flex: 1; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .flags { display: flex; gap: 4px; color: var(--ls-text-2); }
    .fav { color: var(--ion-color-warning); }
    .note p { margin: 0; color: var(--ls-text-2); font-size: 0.88rem; line-height: 1.5; flex: 1; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
    .note footer { display: flex; align-items: center; gap: 8px; }
    .time { font-size: 0.76rem; color: var(--ls-text-3); flex: 1; }
  `,
})
export class NotesPage {
  readonly data = inject(DataService);
  private readonly sync = inject(SyncService);
  private readonly router = inject(Router);
  private readonly modal = inject(ModalController);

  readonly filters: { value: Filter; label: string; icon: string }[] = [
    { value: 'all', label: 'All', icon: 'documents-outline' },
    { value: 'pinned', label: 'Pinned', icon: 'pin-outline' },
    { value: 'favorites', label: 'Favorites', icon: 'star-outline' },
    { value: 'archived', label: 'Archived', icon: 'archive-outline' },
  ];
  readonly filter = signal<Filter>('all');
  readonly search = signal('');
  readonly category = signal('');
  readonly categories = computed(() => [...this.data.list('note_categories')()].sort((a, b) => a.name.localeCompare(b.name)));
  readonly activeCount = computed(() => this.data.list('notes')().filter((n) => !n.is_archived).length);

  readonly visible = computed(() => {
    const q = this.search().trim().toLowerCase();
    const f = this.filter();
    const cat = this.category();
    return this.data
      .list('notes')()
      .filter((n) => (f === 'archived' ? n.is_archived : !n.is_archived))
      .filter((n) => f !== 'pinned' || n.is_pinned)
      .filter((n) => f !== 'favorites' || n.is_favorite)
      .filter((n) => !cat || n.category_id === cat)
      .filter((n) => !q || n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q))
      .sort((a, b) => Number(b.is_pinned) - Number(a.is_pinned) || b.updated_at.localeCompare(a.updated_at));
  });

  excerpt(n: Note) {
    return markdownExcerpt(n.content, 220);
  }
  ago(iso: string) {
    return timeAgo(iso);
  }
  categoryName(n: Note) {
    return this.data.find('note_categories', n.category_id)?.name;
  }
  categoryColor(n: Note) {
    return this.data.find('note_categories', n.category_id)?.color ?? '#635BFF';
  }

  open(n: Note) {
    void this.router.navigate(['/notes', n.id]);
  }
  create() {
    void this.router.navigate(['/notes', 'new'], { queryParams: this.category() ? { category: this.category() } : {} });
  }
  async togglePin(n: Note, ev: Event) {
    ev.stopPropagation();
    await this.data.update('notes', n.id, { is_pinned: !n.is_pinned });
  }
  async manageCategories() {
    const m = await this.modal.create({ component: CategoryManagerModal, componentProps: { table: 'note_categories', title: 'Note categories' }, cssClass: 'ls-modal' });
    await m.present();
  }
}
