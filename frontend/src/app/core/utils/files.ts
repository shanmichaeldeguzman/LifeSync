import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Saves a file for the user: a browser download on the web, or a file in the app's
 * cache shared via the system share sheet on Android/iOS.
 */
export async function saveFile(content: Blob | string, fileName: string, mimeType: string): Promise<void> {
  const blob = typeof content === 'string' ? new Blob([content], { type: mimeType }) : content;
  if (Capacitor.isNativePlatform()) {
    const data = await blobToBase64(blob);
    const written = await Filesystem.writeFile({ path: fileName, data, directory: Directory.Cache });
    await Share.share({ title: fileName, url: written.uri, dialogTitle: 'Save or share file' });
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Opens a file prompt and resolves with the chosen file (web + native WebView). */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    input.onchange = () => {
      resolve(input.files?.[0] ?? null);
      input.remove();
    };
    input.oncancel = () => {
      resolve(null);
      input.remove();
    };
    document.body.appendChild(input);
    input.click();
  });
}

/** Checks magic bytes so a renamed executable can't pass as a PDF or image. */
export async function sniffMimeType(file: Blob): Promise<string | null> {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const hex = [...head].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (hex.startsWith('25504446')) return 'application/pdf';
  if (hex.startsWith('ffd8ff')) return 'image/jpeg';
  if (hex.startsWith('89504e470d0a1a0a')) return 'image/png';
  if (hex.startsWith('52494646') && hex.slice(16, 24) === '57454250') return 'image/webp';
  return null;
}
