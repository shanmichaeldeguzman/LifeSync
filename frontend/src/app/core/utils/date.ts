/** Date helpers operating in the device's local timezone. */

export const DAY_MS = 86_400_000;
export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAYS_MIN = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const pad = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD for a local date. */
export function dateKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parses YYYY-MM-DD as a local date (midnight). */
export function parseDateKey(key: string): Date {
  const [y, m, d] = key.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
export function addMonths(d: Date, n: number): Date {
  const r = new Date(d);
  const day = r.getDate();
  r.setDate(1);
  r.setMonth(r.getMonth() + n);
  r.setDate(Math.min(day, daysInMonth(r)));
  return r;
}
export function daysInMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}
export function startOfWeek(d: Date, weekStartsOn = 0): Date {
  const s = startOfDay(d);
  const diff = (s.getDay() - weekStartsOn + 7) % 7;
  return addDays(s, -diff);
}
export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
export function monthKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
export function monthStartKey(d: Date = new Date()): string {
  return `${monthKey(d)}-01`;
}
export function diffInDays(a: Date, b: Date): number {
  return Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / DAY_MS);
}

/** Value for <input type="datetime-local"> from an ISO string. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${dateKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** ISO string from an <input type="datetime-local"> value. */
export function fromLocalInput(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export function formatTime(d: Date | string): string {
  return new Date(d).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
export function formatDate(d: Date | string, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }): string {
  const date = typeof d === 'string' && d.length === 10 ? parseDateKey(d) : new Date(d);
  return date.toLocaleDateString(undefined, opts);
}

/** "Today", "Tomorrow", "Yesterday", weekday within a week, otherwise a short date. */
export function relativeDay(d: Date | string): string {
  const date = typeof d === 'string' && d.length === 10 ? parseDateKey(d) : new Date(d);
  const diff = diffInDays(date, new Date());
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return date.toLocaleDateString(undefined, { weekday: 'long' });
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

/** "Today, 3:00 PM" style label for a timestamp. */
export function relativeDateTime(iso: string): string {
  return `${relativeDay(iso)}, ${formatTime(iso)}`;
}

/** Human "time ago" label. */
export function timeAgo(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.round(h / 24);
  if (days < 7) return `${days} d ago`;
  return formatDate(iso, { month: 'short', day: 'numeric' });
}

export function greeting(d = new Date()): string {
  const h = d.getHours();
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}
