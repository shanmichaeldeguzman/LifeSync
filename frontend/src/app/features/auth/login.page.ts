import { Component, inject, input, signal, type OnInit } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { IonButton, IonContent, IonIcon, IonSpinner } from '@ionic/angular';
import { AuthService } from '../../core/services/auth.service';
import { UiService } from '../../core/services/ui.service';
import { AuthLayoutComponent } from './auth-layout.component';

@Component({
  selector: 'app-login',
  imports: [IonContent, IonButton, IonIcon, IonSpinner, ReactiveFormsModule, RouterLink, AuthLayoutComponent],
  template: `
    <ion-content>
      <app-auth-layout heading="Welcome back" subheading="Sign in to continue organizing your life.">
        @if (verified()) {
          <div class="ls-banner" style="margin-bottom:18px"><ion-icon name="checkmark-circle"></ion-icon>Email verified. You can sign in now.</div>
        }
        @if (unverifiedEmail()) {
          <div class="ls-banner warning" style="margin-bottom:18px">
            <ion-icon name="mail-unread-outline"></ion-icon>
            <span>Please verify your email first. <button class="link" type="button" (click)="resend()" [disabled]="resending()">Resend link</button></span>
          </div>
        }
        <form class="ls-form" [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <div>
            <label class="ls-field-label" for="email">Email</label>
            <input id="email" type="email" class="ls-native-input" formControlName="email" autocomplete="email" inputmode="email" placeholder="you@example.com" [class.invalid]="invalid('email')" />
            @if (invalid('email')) { <div class="ls-field-error">Enter a valid email address.</div> }
          </div>
          <div>
            <label class="ls-field-label" for="password">Password</label>
            <div class="pw">
              <input id="password" [type]="showPw() ? 'text' : 'password'" class="ls-native-input" formControlName="password" autocomplete="current-password" placeholder="Your password" [class.invalid]="invalid('password')" />
              <button type="button" class="ls-icon-btn ghost" (click)="showPw.set(!showPw())" [attr.aria-label]="showPw() ? 'Hide password' : 'Show password'"><ion-icon [name]="showPw() ? 'eye-off-outline' : 'eye-outline'"></ion-icon></button>
            </div>
            @if (invalid('password')) { <div class="ls-field-error">Enter your password.</div> }
          </div>
          <div class="row"><a routerLink="/auth/forgot-password">Forgot password?</a></div>
          @if (error()) { <div class="ls-banner danger"><ion-icon name="alert-circle"></ion-icon>{{ error() }}</div> }
          <ion-button type="submit" expand="block" [disabled]="loading()">
            @if (loading()) { <ion-spinner name="crescent"></ion-spinner> } @else { Sign in }
          </ion-button>
        </form>
        <p class="switch">New to LifeSync? <a routerLink="/auth/register">Create an account</a></p>
      </app-auth-layout>
    </ion-content>
  `,
  styles: `
    .pw { position: relative; }
    .pw .ls-icon-btn { position: absolute; right: 5px; top: 5px; }
    .pw input { padding-right: 48px; }
    .row { display: flex; justify-content: flex-end; margin-top: -6px; font-size: 0.86rem; font-weight: 600; }
    .row a, .switch a { text-decoration: none; font-weight: 600; }
    .switch { text-align: center; color: var(--ls-text-2); margin-top: 26px; font-size: 0.92rem; }
    .link { background: none; border: 0; color: var(--ion-color-primary); font-weight: 700; cursor: pointer; padding: 0; font: inherit; }
  `,
})
export class LoginPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly ui = inject(UiService);
  private readonly router = inject(Router);

  /** Query param set by the email-verification redirect. */
  readonly verifiedParam = input<string | undefined>(undefined, { alias: 'verified' });
  readonly verified = signal(false);
  readonly loading = signal(false);
  readonly resending = signal(false);
  readonly showPw = signal(false);
  readonly error = signal('');
  readonly unverifiedEmail = signal('');
  private submitted = signal(false);

  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });

  ngOnInit() {
    this.verified.set(this.verifiedParam() === '1');
  }

  invalid(name: 'email' | 'password') {
    const c = this.form.controls[name];
    return c.invalid && (c.touched || this.submitted());
  }

  async submit() {
    this.submitted.set(true);
    this.error.set('');
    if (this.form.invalid || this.loading()) return;
    this.loading.set(true);
    try {
      const { email, password } = this.form.getRawValue();
      await this.auth.signIn(email, password);
      await this.router.navigateByUrl('/dashboard', { replaceUrl: true });
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('verify your email')) this.unverifiedEmail.set(this.form.controls.email.value);
      else this.error.set(msg);
    } finally {
      this.loading.set(false);
    }
  }

  async resend() {
    this.resending.set(true);
    try {
      await this.auth.resendVerification(this.unverifiedEmail());
      await this.ui.success('Verification email sent. Check your inbox.');
    } catch (e) {
      await this.ui.error(e);
    } finally {
      this.resending.set(false);
    }
  }
}
