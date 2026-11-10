import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IonButton, IonContent, IonIcon, IonSpinner } from '@ionic/angular';
import { AuthService } from '../../core/services/auth.service';
import { AuthLayoutComponent } from './auth-layout.component';

@Component({
  selector: 'app-forgot-password',
  imports: [IonContent, IonButton, IonIcon, IonSpinner, ReactiveFormsModule, RouterLink, AuthLayoutComponent],
  template: `
    <ion-content>
      <app-auth-layout heading="Reset your password" subheading="Enter your account email and we'll send you a secure reset link.">
        @if (sent()) {
          <div class="ls-banner"><ion-icon name="mail-unread-outline"></ion-icon>If an account exists for that email, a reset link is on its way. The link expires in one hour.</div>
        } @else {
          <form class="ls-form" [formGroup]="form" (ngSubmit)="submit()" novalidate>
            <div>
              <label class="ls-field-label" for="email">Email</label>
              <input id="email" type="email" class="ls-native-input" formControlName="email" autocomplete="email" placeholder="you@example.com" [class.invalid]="invalid()" />
              @if (invalid()) { <div class="ls-field-error">Enter a valid email address.</div> }
            </div>
            @if (error()) { <div class="ls-banner danger"><ion-icon name="alert-circle"></ion-icon>{{ error() }}</div> }
            <ion-button type="submit" expand="block" [disabled]="loading()">
              @if (loading()) { <ion-spinner name="crescent"></ion-spinner> } @else { Send reset link }
            </ion-button>
          </form>
        }
        <p style="text-align:center;margin-top:26px"><a routerLink="/auth/login" style="font-weight:600;text-decoration:none">Back to sign in</a></p>
      </app-auth-layout>
    </ion-content>
  `,
})
export class ForgotPasswordPage {
  private readonly auth = inject(AuthService);
  readonly form = inject(FormBuilder).nonNullable.group({ email: ['', [Validators.required, Validators.email]] });
  readonly loading = signal(false);
  readonly sent = signal(false);
  readonly error = signal('');
  private readonly submitted = signal(false);

  invalid() {
    const c = this.form.controls.email;
    return c.invalid && (c.touched || this.submitted());
  }

  async submit() {
    this.submitted.set(true);
    if (this.form.invalid || this.loading()) return;
    this.loading.set(true);
    this.error.set('');
    try {
      await this.auth.sendPasswordReset(this.form.controls.email.value);
      this.sent.set(true);
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.loading.set(false);
    }
  }
}
