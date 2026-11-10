import { Injectable, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';

export type ThemeMode = 'system' | 'light' | 'dark';
const KEY = 'lifesync-theme';

/** Applies light / dark / system theme instantly and remembers the choice per device. */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly mode = signal<ThemeMode>(this.readStored());
  readonly isDark = signal(false);
  private readonly media = window.matchMedia('(prefers-color-scheme: dark)');

  constructor() {
    this.media.addEventListener('change', () => this.apply());
    this.apply();
  }

  /** True when the user picked a theme on this device (it then takes precedence). */
  hasLocalChoice(): boolean {
    try {
      return localStorage.getItem(KEY) !== null;
    } catch {
      return false;
    }
  }

  set(mode: ThemeMode) {
    this.mode.set(mode);
    try {
      localStorage.setItem(KEY, mode);
    } catch {
      /* storage unavailable: theme still applies for this session */
    }
    this.apply();
  }

  private readStored(): ThemeMode {
    try {
      const v = localStorage.getItem(KEY);
      return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
    } catch {
      return 'system';
    }
  }

  private apply() {
    const dark = this.mode() === 'dark' || (this.mode() === 'system' && this.media.matches);
    this.isDark.set(dark);
    document.documentElement.classList.toggle('ion-palette-dark', dark);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0f1117' : '#f7f8fc');
    if (Capacitor.isNativePlatform()) {
      StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => undefined);
      if (Capacitor.getPlatform() === 'android') {
        StatusBar.setBackgroundColor({ color: dark ? '#0f1117' : '#f7f8fc' }).catch(() => undefined);
      }
    }
  }
}
