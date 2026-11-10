import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { IonButton, IonContent, IonIcon, IonSpinner } from '@ionic/angular';
import { AuthService } from '../../core/services/auth.service';
import { UiService } from '../../core/services/ui.service';
import { AuthLayoutComponent } from './auth-layout.component';
import { passwordScore, strongPassword } from './password';

@Component({
  selector: 'app-register',
  imports: [IonContent, IonButton, IonIcon, IonSpinner, ReactiveFormsModule, RouterLink, AuthLayoutComponent],
  template: `
    <ion-content>
      @if (sentTo()) {
        <app-auth-layout heading="Check your inbox" [subheading]="'We sent a verification link to ' + sentTo() + '. Open it to activate your account.'">
          <div class="ls-card" style="text-align:center">
            <div class="ls-icon-tile" style="width:64px;height:64px;font-size:30px;margin:0 auto 14px"><ion-icon name="mail-unread-outline"></ion-icon></div>
            <p class="ls-muted ls-small">Didn't get it? Check spam, or resend the link.</p>
            <ion-button fill="outline" (click)="resend()" [disabled]="loading()">Resend email</ion-button>
          </div>
          <p class="switch"><a routerLink="/auth/login">Back to sign in</a></p>
        </app-auth-layout>
      } @else {
        <app-auth-layout heading="Create your account" subheading="Start organizing your day in less than a minute.">
          <form class="ls-form" [formGroup]="form" (ngSubmit)="submit()" novalidate>
            <div>
              <label class="ls-field-label" for="name">Full name</label>
              <input id="name" class="ls-native-input" formControlName="fullName" autocomplete="name" placeholder="Alex Johnson" [class.invalid]="invalid('fullName')" />
              @if (invalid('fullName')) { <div class="ls-field-error">Please enter your name.</div> }
            </div>
            <div>
              <label class="ls-field-label" for="email">Email</label>
              <input id="email" type="email" class="ls-native-input" formControlName="email" autocomplete="email" inputmode="email" placeholder="you@example.com" [class.invalid]="invalid('email')" />
              @if (invalid('email')) { <div class="ls-field-error">Enter a valid email address.</div> }
            </div>
            <div>
              <label class="ls-field-label" for="password">Password</label>
              <input id="password" type="password" class="ls-native-input" formControlName="password" autocomplete="new-password" placeholder="At least 8 characters" [class.invalid]="invalid('password')" />
              <div class="meter" aria-hidden="true">
                @for (i of [0, 1, 2, 3]; track i) { <span [class.on]="score() > i" [attr.data-score]="score()"></span> }
              </div>
              @if (invalid('password')) { <div class="ls-field-error">Use at least 8 characters with letters and numbers.</div> }
            </div>
            <label class="terms">
              <input type="checkbox" formControlName="terms" />
              <span>I understand LifeSync stores my data privately in my account and I can export or delete it at any time.</span>
            </label>
            @if (invalid('terms')) { <div class="ls-field-error" style="margin-top:-8px">Please confirm to continue.</div> }
            @if (error()) { <div class="ls-banner danger"><ion-icon name="alert-circle"></ion-icon>{{ error() }}</div> }
            <ion-button type="submit" expand="block" [disabled]="loading()">
              @if (loading()) { <ion-spinner name="crescent"></ion-spinner> } @else { Create account }
            </ion-button>
          </form>
          <p class="switch">Already have an account? <a routerLink="/auth/login">Sign in</a></p>
        </app-auth-layout>
      }
    </ion-content>
  `,
  styles: `
    .switch { text-align: center; color: var(--ls-text-2); margin-top: 26px; font-size: 0.92rem; }
    .switch a { font-weight: 600; text-decoration: none; }
    .meter { display: flex; gap: 6px; margin-top: 8px; }
    .meter span { flex: 1; height: 4px; border-radius: 4px; background: var(--ls-surface-2); transition: background 0.2s; }
    .meter span.on[data-score='1'] { background: var(--ion-color-danger); }
    .meter span.on[data-score='2'] { background: var(--ion-color-warning); }
    .meter span.on[data-score='3'], .meter span.on[data-score='4'] { background: var(--ion-color-success); }
    .terms { display: flex; gap: 10px; align-items: flex-start; font-size: 0.84rem; color: var(--ls-text-2); line-height: 1.45; cursor: pointer; }
    .terms input { margin-top: 3px; width: 17px; height: 17px; accent-color: var(--ion-color-primary); flex-shrink: 0; }
  `,
})
export class RegisterPage {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly ui = inject(UiService);
  private readonly router = inject(Router);

  readonly loading = signal(false);
  readonly error = signal('');
  readonly sentTo = signal('');
  private readonly submitted = signal(false);

  readonly form = this.fb.nonNullable.group({
    fullName: ['', [Validators.required, Validators.maxLength(120)]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, strongPassword]],
    terms: [false, Validators.requiredTrue],
  });
  private readonly pw = toSignal(this.form.controls.password.valueChanges, { initialValue: '' });
  readonly score = computed(() => passwordScore(this.pw()));

  invalid(name: 'fullName' | 'email' | 'password' | 'terms') {
    const c = this.form.controls[name];
    return c.invalid && (c.touched || this.submitted());
  }

  async submit() {
    this.submitted.set(true);
    this.error.set('');
    if (this.form.invalid || this.loading()) return;
    this.loading.set(true);
    try {
      const { fullName, email, password } = this.form.getRawValue();
      const needsVerification = await this.auth.signUp(fullName, email, password);
      if (needsVerification) this.sentTo.set(email.trim());
      else await this.router.navigateByUrl('/dashboard', { replaceUrl: true });
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.loading.set(false);
    }
  }

  async resend() {
    this.loading.set(true);
    try {
      await this.auth.resendVerification(this.sentTo());
      await this.ui.success('Verification email sent again.');
    } catch (e) {
      await this.ui.error(e);
    } finally {
      this.loading.set(false);
    }
  }
}
