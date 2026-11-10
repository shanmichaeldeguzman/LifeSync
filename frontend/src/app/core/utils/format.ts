import type { DocumentCategory, GoalCategory, NotificationType, PaymentMethod, Priority, TaskStatus } from '../models';

const formatters = new Map<string, Intl.NumberFormat>();

/** Locale-aware currency formatting; `hidden` masks amounts for privacy. */
export function money(amount: number | string | null | undefined, currency = 'USD', hidden = false): string {
  if (hidden) return '••••';
  const n = Number(amount ?? 0);
  const key = currency;
  let f = formatters.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 });
    } catch {
      f = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    formatters.set(key, f);
  }
  return f.format(n);
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const PRIORITY_META: Record<Priority, { label: string; chip: string; color: string; rank: number }> = {
  urgent: { label: 'Urgent', chip: 'danger', color: '#EF4444', rank: 0 },
  high: { label: 'High', chip: 'warning', color: '#F59E0B', rank: 1 },
  medium: { label: 'Medium', chip: 'primary', color: '#635BFF', rank: 2 },
  low: { label: 'Low', chip: '', color: '#94A3B8', rank: 3 },
};

export const STATUS_META: Record<TaskStatus, { label: string; chip: string }> = {
  pending: { label: 'Pending', chip: '' },
  in_progress: { label: 'In progress', chip: 'info' },
  completed: { label: 'Completed', chip: 'success' },
};

export const PAYMENT_METHODS: { value: PaymentMethod; label: string; icon: string }[] = [
  { value: 'cash', label: 'Cash', icon: 'cash-outline' },
  { value: 'debit_card', label: 'Debit card', icon: 'card-outline' },
  { value: 'credit_card', label: 'Credit card', icon: 'card-outline' },
  { value: 'bank_transfer', label: 'Bank transfer', icon: 'swap-horizontal-outline' },
  { value: 'e_wallet', label: 'E-wallet', icon: 'phone-portrait-outline' },
  { value: 'check', label: 'Check', icon: 'document-text-outline' },
  { value: 'other', label: 'Other', icon: 'ellipsis-horizontal-outline' },
];

export const GOAL_CATEGORIES: { value: GoalCategory; label: string; icon: string; color: string }[] = [
  { value: 'personal', label: 'Personal', icon: 'person-outline', color: '#635BFF' },
  { value: 'professional', label: 'Professional', icon: 'briefcase-outline', color: '#0EA5E9' },
  { value: 'academic', label: 'Academic', icon: 'school-outline', color: '#F59E0B' },
  { value: 'financial', label: 'Financial', icon: 'wallet-outline', color: '#22C55E' },
  { value: 'health', label: 'Health', icon: 'fitness-outline', color: '#EC4899' },
  { value: 'other', label: 'Other', icon: 'flag-outline', color: '#64748B' },
];

export const DOCUMENT_CATEGORIES: { value: DocumentCategory; label: string; icon: string }[] = [
  { value: 'identification', label: 'Identification', icon: 'id-card-outline' },
  { value: 'medical', label: 'Medical', icon: 'medkit-outline' },
  { value: 'financial', label: 'Financial', icon: 'wallet-outline' },
  { value: 'education', label: 'Education', icon: 'school-outline' },
  { value: 'legal', label: 'Legal', icon: 'shield-checkmark-outline' },
  { value: 'insurance', label: 'Insurance', icon: 'umbrella-outline' },
  { value: 'travel', label: 'Travel', icon: 'airplane-outline' },
  { value: 'work', label: 'Work', icon: 'briefcase-outline' },
  { value: 'home', label: 'Home', icon: 'home-outline' },
  { value: 'other', label: 'Other', icon: 'folder-outline' },
];

export const NOTIFICATION_META: Record<NotificationType, { icon: string; color: string; label: string }> = {
  task: { icon: 'checkbox-outline', color: '#635BFF', label: 'Tasks' },
  event: { icon: 'calendar-outline', color: '#0EA5E9', label: 'Events' },
  habit: { icon: 'leaf-outline', color: '#22C55E', label: 'Habits' },
  budget: { icon: 'wallet-outline', color: '#F59E0B', label: 'Budgets' },
  document: { icon: 'document-text-outline', color: '#8B5CF6', label: 'Documents' },
  goal: { icon: 'flag-outline', color: '#EC4899', label: 'Goals' },
  system: { icon: 'information-circle-outline', color: '#64748B', label: 'System' },
};

/** Palette offered in color pickers. */
export const COLOR_CHOICES = ['#635BFF', '#8B5CF6', '#EC4899', '#EF4444', '#F97316', '#F59E0B', '#22C55E', '#14B8A6', '#0EA5E9', '#64748B'];

/** Icons offered for categories and habits (all registered in icons.ts). */
export const ICON_CHOICES = [
  'person-outline', 'briefcase-outline', 'school-outline', 'cart-outline', 'home-outline', 'heart-outline',
  'fitness-outline', 'book-outline', 'cafe-outline', 'restaurant-outline', 'car-outline', 'airplane-outline',
  'water-outline', 'moon-outline', 'sunny-outline', 'leaf-outline', 'musical-notes-outline', 'code-slash-outline',
  'brush-outline', 'bulb-outline', 'medkit-outline', 'paw-outline', 'game-controller-outline', 'walk-outline',
  'bicycle-outline', 'barbell-outline', 'pencil-outline', 'people-outline', 'cash-outline', 'gift-outline',
  'film-outline', 'bag-outline', 'flash-outline', 'laptop-outline', 'pricetag-outline', 'wallet-outline',
];

export function initials(name: string | null | undefined, email?: string | null): string {
  const source = (name || email || '?').trim();
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}

/** Short, filesystem-safe version of a user-supplied filename. */
export function safeFileName(name: string): string {
  const cleaned = name.normalize('NFKD').replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '-').slice(-80);
  return cleaned || 'file';
}
