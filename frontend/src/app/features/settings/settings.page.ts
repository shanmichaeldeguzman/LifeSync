import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { IonButton, IonContent, IonHeader, IonIcon, IonSpinner, IonTitle, IonToolbar } from '@ionic/angular';
import { DataService } from '../../core/data/data.service';
import type { DashboardWidget, UserPreferences } from '../../core/models';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { NetworkService } from '../../core/services/network.service';
import { ReminderService } from '../../core/services/reminder.service';
import { SessionService } from '../../core/services/session.service';
import { StorageService } from '../../core/services/storage.service';
import { ThemeService, type ThemeMode } from '../../core/services/theme.service';
import { UiService } from '../../core/services/ui.service';
import { pickFile, saveFile } from '../../core/utils/files';
import { initials } from '../../core/utils/format';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { passwordScore, strongPassword } from '../auth/password';

const WIDGETS: { id: DashboardWidget; label: string; icon: string }[] = [
  { id: 'tasks', label: 'Tasks', icon: 'checkbox-outline' },
  { id: 'events', label: 'Upcoming events', icon: 'calendar-outline' },
  { id: 'habits', label: 'Habits', icon: 'leaf-outline' },
  { id: 'finance', label: 'Finance', icon: 'wallet-outline' },
  { id: 'goals', label: 'Goals', icon: 'flag-outline' },
  { id: 'notes', label: 'Recent notes', icon: 'document-text-outline' },
  { id: 'reminders', label: 'Reminders', icon: 'notifications-outline' },
];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'PHP', 'JPY', 'CNY', 'INR', 'AUD', 'CAD', 'SGD', 'HKD', 'KRW', 'MXN', 'BRL', 'ZAR', 'AED', 'SAR', 'IDR', 'MYR', 'THB', 'VND', 'NZD', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'TRY', 'NGN', 'KES'];

@Component({
  selector: 'app-settings',
  imports: [IonHeader, IonToolbar, IonTitle, IonButton, IonContent, IonIcon, IonSpinner, FormsModule, RouterLink, AvatarComponent],
  templateUrl: './settings.page.html',
  styleUrl: './settings.page.scss',
})
export class SettingsPage {
  readonly data = inject(DataService);
  readonly auth = inject(AuthService);
  readonly network = inject(NetworkService);
  readonly reminders = inject(ReminderService);
  readonly theme = inject(ThemeService);
  private readonly session = inject(SessionService);
  private readonly storage = inject(StorageService);
  private readonly api = inject(ApiService);
  private readonly ui = inject(UiService);

  readonly section = input<string | undefined>(undefined);
  readonly widgetsMeta = WIDGETS;
  readonly currencies = CURRENCIES;
  readonly timezones: string[] = (() => {
    try {
      return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone');
    } catch {
      return ['UTC'];
    }
  })();
  readonly version = '1.0.0';
  readonly platform = Capacitor.getPlatform();

  readonly prefs = computed(() => this.data.preferences());
  readonly userInitials = computed(() => initials(this.data.profile()?.full_name, this.auth.user()?.email));

  // Profile form
  fullName = '';
  timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  currency = 'USD';
  readonly savingProfile = signal(false);
  readonly uploadingAvatar = signal(false);
  private profileLoaded = false;

  // Password form
  currentPassword = '';
  newPassword = '';
  confirmPassword = '';
  readonly passwordError = signal('');
  readonly savingPassword = signal(false);

  readonly exporting = signal(false);
  readonly deleting = signal(false);

  constructor() {
    effect(() => {
      const p = this.data.profile();
      if (p && !this.profileLoaded) {
        untracked(() => {
          this.profileLoaded = true;
          this.fullName = p.full_name;
          this.timezone = p.timezone === 'UTC' && this.timezone !== 'UTC' ? this.timezone : p.timezone;
          this.currency = p.currency;
        });
      }
    });
    effect(() => {
      const s = this.section();
      if (s) untracked(() => setTimeout(() => document.getElementById(`section-${s}`)?.scrollIntoView({ behavior: 'smooth' }), 400));
    });
  }

  pwScore() {
    return passwordScore(this.newPassword);
  }

  private requireOnline(): boolean {
    if (this.network.online()) return true;
    void this.ui.toast('Connect to the internet to change account settings.', 'warning');
    return false;
  }

  // ------------------------------------------------------------- profile
  async saveProfile() {
    if (!this.requireOnline() || this.savingProfile()) return;
    if (this.fullName.trim().length > 120) return void this.ui.toast('Name is too long.', 'warning');
    this.savingProfile.set(true);
    try {
      await this.session.updateProfile({ full_name: this.fullName.trim(), timezone: this.timezone, currency: this.currency });
      await this.ui.success('Profile saved');
    } catch (e) {
      await this.ui.error(e);
    } finally {
      this.savingProfile.set(false);
    }
  }

  async changeAvatar() {
    if (!this.requireOnline()) return;
    let file: File | null = null;
    if (Capacitor.isNativePlatform()) {
      try {
        const photo = await Camera.getPhoto({ resultType: CameraResultType.Uri, source: CameraSource.Prompt, quality: 80, width: 512, height: 512 });
        if (photo.webPath) {
          const blob = await (await fetch(photo.webPath)).blob();
          file = new File([blob], `avatar.${photo.format === 'png' ? 'png' : 'jpg'}`, { type: blob.type || 'image/jpeg' });
        }
      } catch {
        return;
      }
    } else {
      file = await pickFile('image/jpeg,image/png,image/webp');
    }
    if (!file) return;
    this.uploadingAvatar.set(true);
    const old = this.data.profile()?.avatar_path;
    try {
      const mime = await this.storage.validate(file, 'avatars');
      const path = await this.storage.upload('avatars', file, mime);
      await this.session.updateProfile({ avatar_path: path });
      if (old) await this.storage.remove('avatars', old).catch(() => undefined);
      await this.ui.success('Profile photo updated');
    } catch (e) {
      await this.ui.error(e);
    } finally {
      this.uploadingAvatar.set(false);
    }
  }

  async removeAvatar() {
    const old = this.data.profile()?.avatar_path;
    if (!old || !this.requireOnline()) return;
    await this.session.updateProfile({ avatar_path: null });
    await this.storage.remove('avatars', old).catch(() => undefined);
    await this.ui.success('Profile photo removed');
  }

  // ------------------------------------------------------------- account
  async changeEmail() {
    if (!this.requireOnline()) return;
    const res = await this.ui.prompt({ header: 'Change email', message: 'We will send a confirmation link to your new address. The change takes effect after you confirm it.', inputs: [{ name: 'email', type: 'email', placeholder: 'New email address' }], confirmText: 'Send link' });
    const email = res?.['email']?.trim();
    if (!email) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return void this.ui.toast('Enter a valid email address.', 'warning');
    try {
      await this.auth.updateEmail(email);
      await this.ui.success('Check both inboxes to confirm the change.');
    } catch (e) {
      await this.ui.error(e);
    }
  }

  async changePassword() {
    this.passwordError.set('');
    if (!this.requireOnline() || this.savingPassword()) return;
    if (!this.currentPassword) return this.passwordError.set('Enter your current password.');
    if (strongPassword({ value: this.newPassword } as never)) return this.passwordError.set('Use at least 8 characters with letters and numbers.');
    if (this.newPassword !== this.confirmPassword) return this.passwordError.set("New passwords don't match.");
    this.savingPassword.set(true);
    try {
      if (!(await this.auth.verifyPassword(this.currentPassword))) {
        this.passwordError.set('Your current password is incorrect.');
        return;
      }
      await this.auth.updatePassword(this.newPassword);
      this.currentPassword = this.newPassword = this.confirmPassword = '';
      await this.ui.success('Password changed');
    } catch (e) {
      this.passwordError.set((e as Error).message);
    } finally {
      this.savingPassword.set(false);
    }
  }

  // ---------------------------------------------------------- preferences
  setTheme(mode: ThemeMode) {
    this.theme.set(mode);
    if (this.network.online()) void this.savePrefs({ theme: mode }, false);
  }

  async savePrefs(patch: Partial<UserPreferences>, toast = true) {
    if (!this.requireOnline()) return;
    try {
      await this.session.updatePreferences(patch);
      if (toast) await this.ui.success('Preferences saved');
    } catch (e) {
      await this.ui.error(e);
    }
  }

  widgetEnabled(id: DashboardWidget) {
    return this.prefs()?.dashboard_widgets.includes(id) ?? true;
  }
  orderedWidgets() {
    const enabled = this.prefs()?.dashboard_widgets ?? WIDGETS.map((w) => w.id);
    const rest = WIDGETS.map((w) => w.id).filter((id) => !enabled.includes(id));
    return [...enabled, ...rest].map((id) => WIDGETS.find((w) => w.id === id)!);
  }
  async toggleWidget(id: DashboardWidget) {
    const current = this.prefs()?.dashboard_widgets ?? WIDGETS.map((w) => w.id);
    const next = current.includes(id) ? current.filter((w) => w !== id) : [...current, id];
    await this.savePrefs({ dashboard_widgets: next }, false);
  }
  async moveWidget(id: DashboardWidget, dir: -1 | 1) {
    const list = [...(this.prefs()?.dashboard_widgets ?? [])];
    const i = list.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    await this.savePrefs({ dashboard_widgets: list }, false);
  }

  // --------------------------------------------------------- privacy/data
  async exportData() {
    if (!this.requireOnline()) return;
    this.exporting.set(true);
    try {
      const data = await this.api.get<unknown>('/account/export', undefined, 60000);
      await saveFile(JSON.stringify(data, null, 2), `lifesync-export-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
      await this.ui.success('Your data export is ready');
    } catch (e) {
      await this.ui.error(e, 'Export failed.');
    } finally {
      this.exporting.set(false);
    }
  }

  async deleteAccount() {
    if (!this.requireOnline()) return;
    const ok = await this.ui.confirm({
      header: 'Delete your account?',
      message: 'This permanently deletes your profile, tasks, events, notes, habits, finances, documents, goals and notifications. This cannot be undone. Consider exporting your data first.',
      confirmText: 'Continue',
      destructive: true,
    });
    if (!ok) return;
    const res = await this.ui.prompt({
      header: 'Confirm deletion',
      message: 'Enter your password and type DELETE to confirm.',
      inputs: [
        { name: 'password', type: 'password', placeholder: 'Password' },
        { name: 'confirm', placeholder: 'Type DELETE' },
      ],
      confirmText: 'Delete forever',
    });
    if (!res) return;
    if (res['confirm'] !== 'DELETE') return void this.ui.toast('Type DELETE in capital letters to confirm.', 'warning');
    this.deleting.set(true);
    try {
      await this.api.delete('/account', { password: res['password'], confirm: 'DELETE' });
      await this.ui.success('Your account and data have been deleted.');
      await this.session.signOut(true);
    } catch (e) {
      await this.ui.error(e);
    } finally {
      this.deleting.set(false);
    }
  }

  signOut() {
    void this.session.signOut();
  }
}
