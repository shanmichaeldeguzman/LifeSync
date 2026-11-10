import { Component, ElementRef, computed, effect, inject, input, signal, untracked, viewChild, type OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonBackButton, IonButtons, IonContent, IonHeader, IonIcon, IonSpinner, IonToolbar } from '@ionic/angular';
import { DataService } from '../../core/data/data.service';
import type { Note, NoteAttachment } from '../../core/models';
import { ApiService } from '../../core/services/api.service';
import { NetworkService } from '../../core/services/network.service';
import { StorageService } from '../../core/services/storage.service';
import { UiService } from '../../core/services/ui.service';
import { formatDate, timeAgo } from '../../core/utils/date';
import { pickFile, saveFile } from '../../core/utils/files';
import { fileSize } from '../../core/utils/format';
import { renderMarkdown } from '../../core/utils/markdown';

type SaveState = 'idle' | 'saving' | 'local' | 'synced';

@Component({
  selector: 'app-note-editor',
  imports: [IonHeader, IonToolbar, IonButtons, IonBackButton, IonContent, IonIcon, IonSpinner, FormsModule],
  templateUrl: './note-editor.page.html',
  styleUrl: './note-editor.page.scss',
})
export class NoteEditorPage implements OnDestroy {
  private readonly data = inject(DataService);
  private readonly api = inject(ApiService);
  private readonly storage = inject(StorageService);
  private readonly network = inject(NetworkService);
  private readonly ui = inject(UiService);
  private readonly router = inject(Router);

  /** Route param: a note id or "new". */
  readonly id = input<string>('new');
  /** Optional preselected category for new notes. */
  readonly categoryParam = input<string | undefined>(undefined, { alias: 'category' });

  private readonly textarea = viewChild<ElementRef<HTMLTextAreaElement>>('editor');

  readonly noteId = signal<string | null>(null);
  readonly note = computed(() => this.data.find('notes', this.noteId()));
  readonly attachments = computed(() => this.data.list('note_attachments')().filter((a) => a.note_id === this.noteId()).sort((a, b) => a.created_at.localeCompare(b.created_at)));
  readonly categories = computed(() => [...this.data.list('note_categories')()].sort((a, b) => a.name.localeCompare(b.name)));

  title = '';
  content = '';
  categoryId: string | null = null;
  readonly mode = signal<'write' | 'preview'>('write');
  readonly preview = signal('');
  readonly saveState = signal<SaveState>('idle');
  readonly uploading = signal(false);
  readonly missing = signal(false);
  private saveTimer?: ReturnType<typeof setTimeout>;
  private loaded = false;
  private creating?: Promise<void>;

  readonly statusLabel = computed(() => {
    const n = this.note();
    if (this.saveState() === 'saving') return 'Saving…';
    if (!n) return 'Not saved yet';
    if (n._status === 'conflict') return 'Needs review';
    return n._status === 'pending' ? 'Saved on this device' : `Synced · ${timeAgo(n.updated_at)}`;
  });

  constructor() {
    effect(() => {
      const id = this.id();
      const ready = this.data.ready();
      untracked(() => {
        if (!ready || this.loaded) return;
        if (id === 'new') {
          this.loaded = true;
          this.categoryId = this.categoryParam() ?? null;
          setTimeout(() => this.textarea()?.nativeElement.focus(), 300);
          return;
        }
        const n = this.data.find('notes', id);
        if (n) {
          this.loaded = true;
          this.noteId.set(n.id);
          this.title = n.title;
          this.content = n.content;
          this.categoryId = n.category_id;
          this.preview.set(renderMarkdown(n.content));
          this.saveState.set(n._status === 'pending' ? 'local' : 'synced');
        } else if (this.data.lastSyncedAt()) {
          this.missing.set(true);
        }
      });
    });
    // If the note is updated from another device while open and we have no unsaved edits, refresh it.
    effect(() => {
      const n = this.note();
      untracked(() => {
        if (n && this.loaded && this.saveState() !== 'saving' && n._status === 'synced' && (n.content !== this.content || n.title !== this.title) && !this.saveTimer) {
          this.title = n.title;
          this.content = n.content;
          this.preview.set(renderMarkdown(n.content));
        }
      });
    });
  }

  ngOnDestroy() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      void this.persist();
    }
  }

  ionViewWillLeave() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
      void this.persist();
    }
  }

  /** Debounced autosave. */
  changed() {
    this.saveState.set('saving');
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      void this.persist();
    }, 700);
  }

  private async persist() {
    const values = { title: this.title.trim().slice(0, 200), content: this.content, category_id: this.categoryId };
    try {
      const id = this.noteId();
      if (!id) {
        if (!values.title && !values.content.trim()) {
          this.saveState.set('idle');
          return;
        }
        this.creating ??= (async () => {
          const n = await this.data.create('notes', values);
          this.noteId.set(n.id);
          void this.router.navigate(['/notes', n.id], { replaceUrl: true });
        })();
        await this.creating;
      } else {
        await this.data.update('notes', id, values);
      }
      this.saveState.set('local');
    } catch (e) {
      this.saveState.set('idle');
      await this.ui.error(e, 'Could not save the note.');
    }
  }

  setMode(m: 'write' | 'preview') {
    if (m === 'preview') this.preview.set(renderMarkdown(this.content));
    this.mode.set(m);
  }

  /** Markdown toolbar: wraps the selection or prefixes the current lines. */
  format(kind: 'bold' | 'italic' | 'heading' | 'list' | 'checklist' | 'quote' | 'code' | 'link') {
    const ta = this.textarea()?.nativeElement;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const sel = value.slice(s, e);
    const wrap = (before: string, after = before, placeholder = 'text') => {
      const inner = sel || placeholder;
      this.content = value.slice(0, s) + before + inner + after + value.slice(e);
      return [s + before.length, s + before.length + inner.length];
    };
    const prefix = (p: string) => {
      const lineStart = value.lastIndexOf('\n', s - 1) + 1;
      const block = value.slice(lineStart, e);
      const out = block.split('\n').map((l) => p + l).join('\n');
      this.content = value.slice(0, lineStart) + out + value.slice(e);
      return [lineStart + p.length, lineStart + out.length];
    };
    let range: number[];
    switch (kind) {
      case 'bold': range = wrap('**'); break;
      case 'italic': range = wrap('_'); break;
      case 'code': range = sel.includes('\n') ? wrap('```\n', '\n```', 'code') : wrap('`'); break;
      case 'link': range = wrap('[', '](https://)', 'link text'); break;
      case 'heading': range = prefix('## '); break;
      case 'list': range = prefix('- '); break;
      case 'checklist': range = prefix('- [ ] '); break;
      case 'quote': range = prefix('> '); break;
    }
    ta.value = this.content;
    ta.focus();
    ta.setSelectionRange(range[0], range[1]);
    this.changed();
  }

  async togglePin() {
    await this.ensureSaved();
    const n = this.note();
    if (n) await this.data.update('notes', n.id, { is_pinned: !n.is_pinned });
  }
  async toggleFavorite() {
    await this.ensureSaved();
    const n = this.note();
    if (n) await this.data.update('notes', n.id, { is_favorite: !n.is_favorite });
  }
  async toggleArchive() {
    await this.ensureSaved();
    const n = this.note();
    if (!n) return;
    await this.data.update('notes', n.id, { is_archived: !n.is_archived });
    await this.ui.success(n.is_archived ? 'Note restored' : 'Note archived');
    if (!n.is_archived) void this.router.navigateByUrl('/notes');
  }

  async remove() {
    const n = this.note();
    if (!n) return void this.router.navigateByUrl('/notes');
    const ok = await this.ui.confirm({ header: 'Delete note?', message: 'This note and its attachments will be permanently deleted.', confirmText: 'Delete', destructive: true });
    if (!ok) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    await this.data.remove('notes', n.id);
    await this.ui.success('Note deleted');
    void this.router.navigateByUrl('/notes', { replaceUrl: true });
  }

  private async ensureSaved() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    if (!this.noteId() || this.saveState() === 'saving') await this.persist();
  }

  // ----------------------------------------------------------- attachments

  async addAttachment() {
    if (!this.network.online()) return void this.ui.toast('Connect to the internet to attach files.', 'warning');
    await this.ensureSaved();
    const n = this.note();
    if (!n) return void this.ui.toast('Write something first, then attach files.', 'info');
    if (n._status !== 'synced') {
      await this.ui.toast('Syncing this note first…', 'info');
      return;
    }
    const file = await pickFile('application/pdf,image/jpeg,image/png,image/webp,text/plain');
    if (!file) return;
    this.uploading.set(true);
    let path: string | null = null;
    try {
      const mime = await this.storage.validate(file, 'attachments');
      path = await this.storage.upload('attachments', file, mime);
      const res = await this.api.post<{ data: NoteAttachment & { id: string } }>('/note-attachments', { note_id: n.id, storage_path: path, file_name: file.name.slice(0, 255), mime_type: mime, size_bytes: file.size });
      await this.data.putServerRow('note_attachments', res.data);
      await this.ui.success('File attached');
    } catch (e) {
      if (path) await this.storage.remove('attachments', path).catch(() => undefined);
      await this.ui.error(e);
    } finally {
      this.uploading.set(false);
    }
  }

  async openAttachment(a: NoteAttachment) {
    try {
      const blob = await this.storage.download('attachments', a.storage_path);
      await saveFile(blob, a.file_name, a.mime_type);
    } catch (e) {
      await this.ui.error(e);
    }
  }

  async removeAttachment(a: NoteAttachment) {
    const ok = await this.ui.confirm({ header: 'Remove attachment?', message: `"${a.file_name}" will be deleted.`, confirmText: 'Remove', destructive: true });
    if (!ok) return;
    await this.data.remove('note_attachments', a.id);
  }

  size(n: number) {
    return fileSize(n);
  }
  created(n: Note) {
    return formatDate(n.created_at);
  }
}
