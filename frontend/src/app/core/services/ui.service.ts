import { Injectable, inject } from '@angular/core';
import { AlertController, ToastController } from '@ionic/angular';

/** Consistent toasts and confirmation dialogs across the app. */
@Injectable({ providedIn: 'root' })
export class UiService {
  private readonly toasts = inject(ToastController);
  private readonly alerts = inject(AlertController);

  async toast(message: string, kind: 'success' | 'error' | 'info' | 'warning' = 'success', duration = 2600) {
    const icon = { success: 'checkmark-circle', error: 'alert-circle', info: 'information-circle', warning: 'warning' }[kind];
    const color = { success: 'dark', error: 'danger', info: 'dark', warning: 'warning' }[kind];
    const t = await this.toasts.create({
      message,
      duration,
      icon,
      color,
      position: 'bottom',
      cssClass: 'ls-toast',
      // On phones, float above the bottom navigation instead of underneath it.
      positionAnchor: window.innerWidth < 992 && document.getElementById('ls-bottom-nav') ? 'ls-bottom-nav' : undefined,
      buttons: [{ icon: 'close', role: 'cancel', side: 'end' }],
      swipeGesture: 'vertical',
    });
    await t.present();
  }

  success(message: string) {
    return this.toast(message, 'success');
  }

  error(err: unknown, fallback = 'Something went wrong. Please try again.') {
    const message = (err as Error)?.message || fallback;
    return this.toast(message, 'error', 4000);
  }

  /** Confirmation for destructive or important actions. Resolves true when confirmed. */
  async confirm(opts: { header: string; message: string; confirmText?: string; destructive?: boolean }): Promise<boolean> {
    const alert = await this.alerts.create({
      header: opts.header,
      message: opts.message,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: opts.confirmText ?? 'Confirm', role: 'confirm', cssClass: opts.destructive ? 'alert-button-danger' : '' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    return role === 'confirm';
  }

  /** Prompt with inputs; resolves the values or null if cancelled. */
  async prompt(opts: {
    header: string;
    message?: string;
    inputs: { name: string; type?: 'text' | 'password' | 'email' | 'number'; placeholder?: string; value?: string }[];
    confirmText?: string;
  }): Promise<Record<string, string> | null> {
    const alert = await this.alerts.create({
      header: opts.header,
      message: opts.message,
      inputs: opts.inputs.map((i) => ({ ...i, type: i.type ?? 'text', attributes: { 'aria-label': i.placeholder ?? i.name } })),
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: opts.confirmText ?? 'OK', role: 'confirm' },
      ],
    });
    await alert.present();
    const { role, data } = await alert.onDidDismiss();
    return role === 'confirm' ? ((data?.values ?? {}) as Record<string, string>) : null;
  }
}
