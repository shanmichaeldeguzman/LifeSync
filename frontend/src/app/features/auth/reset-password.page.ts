import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { IonButton, IonContent, IonIcon, IonSpinner } from '@ionic/angular';
import { AuthService } from '../../core/services/auth.service';
import { UiService } from '../../core/services/ui.service';
import { AuthLayoutComponent } from './auth-layout.component';
import { matchPassword, strongPassword } from './password';

/** Landing page for the password-recovery email link. */
@Component({
  selector: 'app-reset-password',
  imports: [IonContent, IonButton, IonIcon, IonSpinner, ReactiveFormsModule, RouterLink, AuthLayoutComponent],
  template: `
    <ion-content>
      <app-auth-layout heading="Choose a new password" subheading="Make it at least 8 characters with letters and numbers.">
        @if (!canReset()) {
          <div class="ls-banner warning"><ion-icon name="time-outline"></ion-icon>This reset link is invalid or has expired. Request a new one.</div>
          <p style="text-align:center;margin-top:20px"><a routerLink="/auth/forgot-password" style="font-weight:600">Request new link</a></p>
        } @else {
          <form class="ls-form" [formGroup]="form" (ngSubmit)="submit()" novalidate>
            <div>
              <label class="ls-field-label" for="pw">New password</label>
              <input id="pw" type="password" class="ls-native-input" formControlName="password" autocomplete="new-password" [class.invalid]="invalid('password')" />
              @if (invalid('password')) { <div class="ls-field-error">Use at least 8 characters with letters and numbers.</div> }
            </div>
            <div>
              <label class="ls-field-label" for="pw2">Confirm password</label>
              <input id="pw2" type="password" class="ls-native-input" formControlName="confirm" autocomplete="new-password" [class.invalid]="invalid('confirm')" />
              @if (invalid('confirm')) { <div class="ls-field-error">Passwords don't match.</div> }
            </div>
            @if (error()) { <div class="ls-banner danger"><ion-icon name="alert-circle"></ion-icon>{{ error() }}</div> }
            <ion-button type="submit" expand="block" [disabled]="loading()">
              @if (loading()) { <ion-spinner name="crescent"></ion-spinner> } @else { Update password }
            </ion-button>
          </form>
        }
      </app-auth-layout>
    </ion-content>
  `,
})
export class ResetPasswordPage {
  private readonly auth = inject(AuthService);
  private readonly ui = inject(UiService);
  private readonly router = inject(Router);
  readonly canReset = computed(() => this.auth.isAuthenticated());
  readonly loading = signal(false);
  readonly error = signal('');
  private readonly submitted = signal(false);

  readonly form = inject(FormBuilder).nonNullable.group({
    password: ['', [Validators.required, strongPassword]],
    confirm: ['', [Validators.required, matchPassword('password')]],
  });

  invalid(name: 'password' | 'confirm') {
    const c = this.form.controls[name];
    c.updateValueAndValidity({ emitEvent: false });
    return c.invalid && (c.touched || this.submitted());
  }

  async submit() {
    this.submitted.set(true);
    if (this.form.invalid || this.loading()) return;
    this.loading.set(true);
    this.error.set('');
    try {
      await this.auth.updatePassword(this.form.controls.password.value);
      await this.ui.success('Password updated. You are signed in.');
      await this.router.navigateByUrl('/dashboard', { replaceUrl: true });
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.loading.set(false);
    }
  }
}
