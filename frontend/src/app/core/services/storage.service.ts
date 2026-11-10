import { Injectable, inject } from '@angular/core';
import { DataService } from '../data/data.service';
import { uuid } from '../data/local-db';
import { safeFileName } from '../utils/format';
import { sniffMimeType } from '../utils/files';
import { SupabaseService } from './supabase.service';

export type Bucket = 'documents' | 'attachments' | 'avatars';

const LIMITS: Record<Bucket, { maxBytes: number; types: string[] }> = {
  documents: { maxBytes: 10 * 1024 * 1024, types: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] },
  attachments: { maxBytes: 10 * 1024 * 1024, types: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/plain'] },
  avatars: { maxBytes: 2 * 1024 * 1024, types: ['image/jpeg', 'image/png', 'image/webp'] },
};

/**
 * Private file storage. Files are uploaded straight to private Supabase Storage buckets
 * under the user's own folder; bucket policies (RLS) and bucket size/type limits are
 * enforced server-side. Files are only ever read with the user's own session.
 */
@Injectable({ providedIn: 'root' })
export class StorageService {
  private readonly supabase = inject(SupabaseService);
  private readonly data = inject(DataService);
  private readonly blobCache = new Map<string, string>();

  /** Validates size + real content type. Returns the detected MIME type. */
  async validate(file: File, bucket: Bucket): Promise<string> {
    const limit = LIMITS[bucket];
    if (file.size === 0) throw new Error('This file is empty.');
    if (file.size > limit.maxBytes) throw new Error(`Files must be ${limit.maxBytes / 1024 / 1024} MB or smaller.`);
    const sniffed = await sniffMimeType(file);
    const type = sniffed ?? (file.type === 'text/plain' ? 'text/plain' : null);
    if (!type || !limit.types.includes(type)) {
      const names = limit.types.map((t) => t.split('/')[1].toUpperCase()).join(', ');
      throw new Error(`Unsupported file type. Allowed: ${names}.`);
    }
    return type;
  }

  /** Uploads to `<userId>/<uuid>-<name>` and returns the storage path. */
  async upload(bucket: Bucket, file: File, mimeType: string): Promise<string> {
    const userId = this.data.userId();
    if (!userId) throw new Error('You are signed out.');
    const path = `${userId}/${uuid()}-${safeFileName(file.name)}`;
    const { error } = await this.supabase.client.storage.from(bucket).upload(path, file, { contentType: mimeType, upsert: false });
    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('exceeded') || msg.includes('too large')) throw new Error('This file is too large.');
      if (msg.includes('mime')) throw new Error('This file type is not allowed.');
      throw new Error('Upload failed. Please check your connection and try again.');
    }
    return path;
  }

  async remove(bucket: Bucket, path: string): Promise<void> {
    await this.supabase.client.storage.from(bucket).remove([path]);
  }

  /** Downloads a private file with the user's session. */
  async download(bucket: Bucket, path: string): Promise<Blob> {
    const { data, error } = await this.supabase.client.storage.from(bucket).download(path);
    if (error || !data) throw new Error('Could not load the file. Check your connection.');
    return data;
  }

  /** Object URL for previews, cached for the session. */
  async objectUrl(bucket: Bucket, path: string): Promise<string> {
    const key = `${bucket}/${path}`;
    const cached = this.blobCache.get(key);
    if (cached) return cached;
    const url = URL.createObjectURL(await this.download(bucket, path));
    this.blobCache.set(key, url);
    return url;
  }

  clearCache() {
    for (const url of this.blobCache.values()) URL.revokeObjectURL(url);
    this.blobCache.clear();
  }
}
