import { Component, inject, signal, type OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonSpinner, IonTitle, IonToolbar, ModalController } from '@ionic/angular';
import { DataService } from '../../core/data/data.service';
import type { DocumentCategory, LifeDocument } from '../../core/models';
import { ApiService } from '../../core/services/api.service';
import { NetworkService } from '../../core/services/network.service';
import { StorageService } from '../../core/services/storage.service';
import { UiService } from '../../core/services/ui.service';
import { pickFile } from '../../core/utils/files';
import { DOCUMENT_CATEGORIES, fileSize } from '../../core/utils/format';

@Component({
  selector: 'app-document-form',
  imports: [IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonIcon, IonSpinner, FormsModule],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-button (click)="cancel()" [disabled]="saving()">Cancel</ion-button></ion-buttons>
        <ion-title>{{ doc ? 'Document details' : 'Upload document' }}</ion-title>
        <ion-buttons slot="end"><ion-button strong (click)="save()" [disabled]="saving()">{{ doc ? 'Save' : 'Upload' }}</ion-button></ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <form class="ls-modal-body ls-form" (ngSubmit)="save()" novalidate>
        @if (!doc) {
          @if (!network.online()) {
            <div class="ls-banner warning"><ion-icon name="cloud-offline-outline"></ion-icon>Uploading requires an internet connection.</div>
          }
          <button type="button" class="drop" [class.has]="file()" (click)="choose()" (dragover)="$event.preventDefault()" (drop)="drop($event)">
            @if (file(); as f) {
              <ion-icon [name]="f.type === 'application/pdf' ? 'document-text' : 'image'"></ion-icon>
              <strong class="ls-truncate" style="max-width:100%">{{ f.name }}</strong>
              <span>{{ size(f.size) }} · tap to change</span>
            } @else {
              <ion-icon name="cloud-upload-outline"></ion-icon>
              <strong>Choose a file</strong>
              <span>PDF, JPEG, PNG or WebP · up to 10 MB</span>
            }
          </button>
          @if (isNative) {
            <ion-button fill="outline" type="button" (click)="takePhoto()"><ion-icon slot="start" name="camera-outline"></ion-icon>Scan with camera</ion-button>
          }
          @if (fileError()) { <div class="ls-field-error">{{ fileError() }}</div> }
        }

        <div>
          <label class="ls-field-label" for="d-title">Title</label>
          <input id="d-title" name="title" class="ls-native-input" [(ngModel)]="title" maxlength="200" placeholder="e.g. Passport" [class.invalid]="submitted() && !title.trim()" />
          @if (submitted() && !title.trim()) { <div class="ls-field-error">Please add a title.</div> }
        </div>
        <div>
          <label class="ls-field-label" for="d-cat">Category</label>
          <select id="d-cat" name="cat" class="ls-native-input" [(ngModel)]="category">
            @for (c of categories; track c.value) { <option [value]="c.value">{{ c.label }}</option> }
          </select>
        </div>
        <div>
          <label class="ls-field-label" for="d-desc">Description (optional)</label>
          <textarea id="d-desc" name="desc" class="ls-native-input" [(ngModel)]="description" maxlength="2000" style="min-height:70px"></textarea>
        </div>
        <div class="ls-form-row two">
          <div>
            <label class="ls-field-label" for="d-exp">Expiration date (optional)</label>
            <input id="d-exp" name="exp" type="date" class="ls-native-input" [(ngModel)]="expiresAt" />
          </div>
          <div>
            <label class="ls-field-label" for="d-rem">Remind me</label>
            <select id="d-rem" name="rem" class="ls-native-input" [(ngModel)]="remindDays" [disabled]="!expiresAt">
              <option [ngValue]="7">1 week before</option>
              <option [ngValue]="14">2 weeks before</option>
              <option [ngValue]="30">1 month before</option>
              <option [ngValue]="60">2 months before</option>
              <option [ngValue]="90">3 months before</option>
            </select>
          </div>
        </div>
        <p class="ls-hint"><ion-icon name="lock-closed-outline" style="vertical-align:-2px"></ion-icon> Stored in your private storage. Only your account can access it; there are no public links.</p>
        @if (saving()) { <div style="display:flex;align-items:center;gap:8px" class="ls-muted ls-small"><ion-spinner name="crescent"></ion-spinner> Uploading securely…</div> }
        <button type="submit" hidden></button>
      </form>
    </ion-content>
  `,
  styles: `
    .drop { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 28px 16px; border: 2px dashed var(--ls-border-strong); border-radius: 16px; background: var(--ls-surface-2); color: var(--ls-text-2); cursor: pointer; font: inherit; }
    .drop ion-icon { font-size: 36px; color: var(--ion-color-primary); }
    .drop strong { color: var(--ls-text); }
    .drop span { font-size: 0.8rem; }
    .drop.has { border-style: solid; border-color: var(--ion-color-primary); background: var(--ls-primary-soft); }
  `,
})
export class DocumentFormModal implements OnInit {
  doc?: LifeDocument;

  private readonly data = inject(DataService);
  private readonly api = inject(ApiService);
  private readonly storage = inject(StorageService);
  readonly network = inject(NetworkService);
  private readonly ui = inject(UiService);
  private readonly modal = inject(ModalController);

  readonly isNative = Capacitor.isNativePlatform();
  readonly categories = DOCUMENT_CATEGORIES;
  readonly file = signal<File | null>(null);
  readonly fileError = signal('');
  readonly saving = signal(false);
  readonly submitted = signal(false);
  private mime = '';

  title = '';
  description = '';
  category: DocumentCategory = 'other';
  expiresAt = '';
  remindDays = 30;

  ngOnInit() {
    this.remindDays = this.data.preferences()?.document_reminder_days ?? 30;
    if (!this.doc) return;
    this.title = this.doc.title;
    this.description = this.doc.description;
    this.category = this.doc.category;
    this.expiresAt = this.doc.expires_at ?? '';
    this.remindDays = this.doc.remind_days_before;
  }

  size(n: number) {
    return fileSize(n);
  }

  async choose() {
    const f = await pickFile('application/pdf,image/jpeg,image/png,image/webp');
    if (f) await this.setFile(f);
  }

  async drop(ev: DragEvent) {
    ev.preventDefault();
    const f = ev.dataTransfer?.files?.[0];
    if (f) await this.setFile(f);
  }

  async takePhoto() {
    try {
      const photo = await Camera.getPhoto({ resultType: CameraResultType.Uri, source: CameraSource.Prompt, quality: 85, correctOrientation: true });
      if (!photo.webPath) return;
      const blob = await (await fetch(photo.webPath)).blob();
      const ext = photo.format === 'png' ? 'png' : 'jpeg';
      await this.setFile(new File([blob], `scan-${Date.now()}.${ext === 'jpeg' ? 'jpg' : ext}`, { type: `image/${ext}` }));
    } catch {
      /* user cancelled */
    }
  }

  private async setFile(f: File) {
    this.fileError.set('');
    try {
      this.mime = await this.storage.validate(f, 'documents');
      this.file.set(f);
      if (!this.title) this.title = f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').slice(0, 200);
    } catch (e) {
      this.file.set(null);
      this.fileError.set((e as Error).message);
    }
  }

  async save() {
    this.submitted.set(true);
    if (!this.title.trim() || this.saving()) return;
    const meta = {
      title: this.title.trim(),
      description: this.description,
      category: this.category,
      expires_at: this.expiresAt || null,
      remind_days_before: Number(this.remindDays),
    };

    if (this.doc) {
      this.saving.set(true);
      try {
        await this.data.update('documents', this.doc.id, meta);
        await this.ui.success('Document updated');
        await this.modal.dismiss(true, 'saved');
      } catch (e) {
        await this.ui.error(e);
      } finally {
        this.saving.set(false);
      }
      return;
    }

    const f = this.file();
    if (!f) return this.fileError.set('Choose a file to upload.');
    if (!this.network.online()) return void this.ui.toast('Connect to the internet to upload documents.', 'warning');

    this.saving.set(true);
    let path: string | null = null;
    try {
      path = await this.storage.upload('documents', f, this.mime);
      const res = await this.api.post<{ data: LifeDocument }>('/documents', { ...meta, storage_path: path, file_name: f.name.slice(0, 255), mime_type: this.mime, size_bytes: f.size });
      await this.data.putServerRow('documents', res.data);
      await this.ui.success('Document uploaded');
      await this.modal.dismiss(true, 'saved');
    } catch (e) {
      if (path) await this.storage.remove('documents', path).catch(() => undefined);
      await this.ui.error(e, 'Upload failed.');
    } finally {
      this.saving.set(false);
    }
  }

  cancel() {
    void this.modal.dismiss(null, 'cancel');
  }
}
