import { Injectable, effect, inject, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { DataService } from '../data/data.service';
import { SyncService } from '../data/sync.service';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { ReminderService } from './reminder.service';
import { StorageService } from './storage.service';
import { ThemeService } from './theme.service';
import { UiService } from './ui.service';
import type { Profile, UserPreferences } from '../models';

/**
 * Orchestrates the signed-in lifecycle: opens the user's local database, starts sync and
 * reminders on sign-in, and wipes local personal data on sign-out.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly auth = inject(AuthService);
  private readonly data = inject(DataService);
  private readonly sync = inject(SyncService);
  private readonly reminders = inject(ReminderService);
  private readonly storage = inject(StorageService);
  private readonly theme = inject(ThemeService);
  private readonly api = inject(ApiService);
  private readonly ui = inject(UiService);
  private readonly router = inject(Router);
  private appliedThemeFor?: string;

  constructor() {
    effect(() => {
      const user = this.auth.user();
      untracked(() => void this.onUserChanged(user?.id ?? null));
    });
    // On a device without its own theme choice, adopt the account's saved theme.
    effect(() => {
      const prefs = this.data.preferences();
      const uid = this.data.userId();
      if (prefs && uid && this.appliedThemeFor !== uid) {
        this.appliedThemeFor = uid;
        untracked(() => {
          if (!this.theme.hasLocalChoice()) this.theme.set(prefs.theme);
        });
      }
    });
  }

  private async onUserChanged(userId: string | null) {
    if (userId) {
      if (this.data.userId() === userId) return;
      await this.data.open(userId);
      this.sync.start();
      await this.reminders.start();
    } else if (this.data.userId()) {
      this.sync.stop();
      await this.reminders.stop();
      await this.data.close(false);
    }
  }

  /** Signs out after warning about unsynchronised changes; removes cached personal data. */
  async signOut(skipConfirm = false) {
    const pending = this.data.pendingCount();
    if (!skipConfirm && pending > 0) {
      const ok = await this.ui.confirm({
        header: 'Unsynced changes',
        message: `You have ${pending} change${pending === 1 ? '' : 's'} that haven't synced yet. Signing out will discard them from this device.`,
        confirmText: 'Sign out anyway',
        destructive: true,
      });
      if (!ok) return;
    }
    this.sync.stop();
    await this.reminders.stop();
    this.storage.clearCache();
    await this.data.close(true);
    await this.auth.signOut();
    await this.router.navigateByUrl('/auth/login', { replaceUrl: true });
  }

  /** Online-only profile update; refreshes the local cache. */
  async updateProfile(patch: Partial<Profile>): Promise<Profile> {
    const res = await this.api.patch<{ data: Profile }>('/profile', patch);
    await this.data.setMeta('profile', res.data);
    return res.data;
  }

  async updatePreferences(patch: Partial<UserPreferences>): Promise<UserPreferences> {
    const current = this.data.preferences();
    if (current) await this.data.setMeta('preferences', { ...current, ...patch });
    try {
      const res = await this.api.patch<{ data: UserPreferences }>('/preferences', patch);
      await this.data.setMeta('preferences', res.data);
      return res.data;
    } catch (e) {
      if (current) await this.data.setMeta('preferences', current);
      throw e;
    }
  }
}
