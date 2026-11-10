import { Component, inject, signal, type OnDestroy, type OnInit } from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { Capacitor } from '@capacitor/core';
import { IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonSpinner, IonTitle, IonToolbar, ModalController } from '@ionic/angular';
import { DataService } from '../../core/data/data.service';
import type { LifeDocument } from '../../core/models';
import { StorageService } from '../../core/services/storage.service';
import { UiService } from '../../core/services/ui.service';
import { formatDate } from '../../core/utils/date';
import { saveFile } from '../../core/utils/files';
import { DOCUMENT_CATEGORIES, fileSize } from '../../core/utils/format';
import { DocumentFormModal } from './document-form.modal';

/** Private in-app preview: the file is fetched with the user's session into a local blob URL. */
@Component({
  selector: 'app-document-preview',
  imports: [IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonIcon, IonSpinner],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-button (click)="close()">Close</ion-button></ion-buttons>
        <ion-title>{{ doc.title }}</ion-title>
        <ion-buttons slot="end">
          <button class="ls-icon-btn ghost" (click)="edit()" aria-label="Edit details"><ion-icon name="create-outline"></ion-icon></button>
          <button class="ls-icon-btn ghost" (click)="download()" aria-label="Download"><ion-icon name="download-outline"></ion-icon></button>
          <button class="ls-icon-btn ghost" (click)="remove()" aria-label="Delete"><ion-icon name="trash-outline"></ion-icon></button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <div class="ls-modal-body">
        <div class="viewer">
          @if (loading()) {
            <ion-spinner name="crescent"></ion-spinner>
          } @else if (error()) {
            <div class="ls-banner warning"><ion-icon name="cloud-offline-outline"></ion-icon>{{ error() }}</div>
          } @else if (isImage) {
            <img [src]="url()" [alt]="doc.title" />
          } @else if (pdfUrl() && !isNative) {
            <iframe [src]="pdfUrl()" title="PDF preview"></iframe>
          } @else {
            <div class="pdf-fallback">
              <ion-icon name="document-text"></ion-icon>
              <p>PDF ready to open.</p>
              <ion-button (click)="download()"><ion-icon slot="start" name="open-outline"></ion-icon>Open PDF</ion-button>
            </div>
          }
        </div>
        <div class="ls-card details">
          <div><span>Category</span><strong>{{ categoryLabel() }}</strong></div>
          <div><span>File</span><strong class="ls-truncate">{{ doc.file_name }} · {{ size() }}</strong></div>
          <div><span>Uploaded</span><strong>{{ uploaded() }}</strong></div>
          @if (doc.expires_at) { <div><span>Expires</span><strong>{{ expires() }}</strong></div> }
          @if (doc.description) { <p>{{ doc.description }}</p> }
        </div>
      </div>
    </ion-content>
  `,
  styles: `
    .viewer { min-height: 280px; display: flex; align-items: center; justify-content: center; background: var(--ls-surface-2); border-radius: 16px; overflow: hidden; margin-bottom: 16px; }
    img { max-width: 100%; max-height: 60vh; object-fit: contain; display: block; }
    iframe { width: 100%; height: 60vh; border: 0; background: #fff; }
    .pdf-fallback { text-align: center; padding: 24px; }
    .pdf-fallback ion-icon { font-size: 56px; color: var(--ion-color-primary); }
    .details { display: grid; gap: 10px; }
    .details div { display: flex; justify-content: space-between; gap: 12px; font-size: 0.88rem; }
    .details span { color: var(--ls-text-2); }
    .details p { margin: 4px 0 0; color: var(--ls-text-2); font-size: 0.88rem; }
  `,
})
export class DocumentPreviewModal implements OnInit, OnDestroy {
  doc!: LifeDocument;

  private readonly storage = inject(StorageService);
  private readonly data = inject(DataService);
  private readonly ui = inject(UiService);
  private readonly modal = inject(ModalController);
  private readonly sanitizer = inject(DomSanitizer);

  readonly isNative = Capacitor.isNativePlatform();
  isImage = false;
  readonly loading = signal(true);
  readonly error = signal('');
  readonly url = signal<string | null>(null);
  readonly pdfUrl = signal<SafeResourceUrl | null>(null);
  private blob?: Blob;
  private objectUrl?: string;

  async ngOnInit() {
    this.isImage = this.doc.mime_type.startsWith('image/');
    try {
      this.blob = await this.storage.download('documents', this.doc.storage_path);
      this.objectUrl = URL.createObjectURL(this.blob);
      this.url.set(this.objectUrl);
      // Blob URLs are same-origin and created from the user's own private file.
      if (!this.isImage) this.pdfUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.objectUrl));
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.loading.set(false);
    }
  }

  ngOnDestroy() {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
  }

  categoryLabel() {
    return DOCUMENT_CATEGORIES.find((c) => c.value === this.doc.category)?.label ?? 'Other';
  }
  size() {
    return fileSize(this.doc.size_bytes);
  }
  uploaded() {
    return formatDate(this.doc.created_at);
  }
  expires() {
    return formatDate(this.doc.expires_at!);
  }

  async download() {
    try {
      const blob = this.blob ?? (await this.storage.download('documents', this.doc.storage_path));
      await saveFile(blob, this.doc.file_name, this.doc.mime_type);
    } catch (e) {
      await this.ui.error(e);
    }
  }

  async edit() {
    const m = await this.modal.create({ component: DocumentFormModal, componentProps: { doc: this.doc }, cssClass: 'ls-modal' });
    await m.present();
    const { role } = await m.onDidDismiss();
    if (role === 'saved') this.doc = this.data.find('documents', this.doc.id) ?? this.doc;
  }

  async remove() {
    const ok = await this.ui.confirm({ header: 'Delete document?', message: `"${this.doc.title}" and its file will be permanently deleted.`, confirmText: 'Delete', destructive: true });
    if (!ok) return;
    await this.data.remove('documents', this.doc.id);
    await this.ui.success('Document deleted');
    await this.modal.dismiss(true, 'deleted');
  }

  close() {
    void this.modal.dismiss();
  }
}
