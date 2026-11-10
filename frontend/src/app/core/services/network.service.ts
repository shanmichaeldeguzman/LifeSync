import { Injectable, signal } from '@angular/core';
import { Network } from '@capacitor/network';

/** Reactive online/offline state (Capacitor Network on native, navigator events on web). */
@Injectable({ providedIn: 'root' })
export class NetworkService {
  readonly online = signal(typeof navigator === 'undefined' ? true : navigator.onLine);
  private readonly callbacks: (() => void)[] = [];

  constructor() {
    Network.getStatus()
      .then((s) => this.online.set(s.connected))
      .catch(() => undefined);
    Network.addListener('networkStatusChange', (s) => this.set(s.connected)).catch(() => {
      window.addEventListener('online', () => this.set(true));
      window.addEventListener('offline', () => this.set(false));
    });
  }

  /** Registers a callback fired whenever connectivity is restored. */
  onReconnect(cb: () => void) {
    this.callbacks.push(cb);
  }

  private set(connected: boolean) {
    const wasOffline = !this.online();
    this.online.set(connected);
    if (connected && wasOffline) this.callbacks.forEach((cb) => cb());
  }
}
