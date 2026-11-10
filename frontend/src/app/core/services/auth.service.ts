import { Injectable, computed, inject, signal } from '@angular/core';
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';
import { SupabaseService } from './supabase.service';

/** Maps Supabase auth errors to clear, user-facing messages. */
export function friendlyAuthError(err: unknown): string {
  const e = err as { message?: string; code?: string; status?: number };
  const msg = (e?.message ?? '').toLowerCase();
  if (e?.code === 'invalid_credentials' || msg.includes('invalid login')) return 'Incorrect email or password.';
  if (e?.code === 'email_not_confirmed' || msg.includes('not confirmed')) return 'Please verify your email address before signing in.';
  if (e?.code === 'user_already_exists' || msg.includes('already registered')) return 'An account with this email already exists.';
  if (e?.code === 'weak_password' || msg.includes('password should')) return 'Choose a stronger password (at least 8 characters with letters and numbers).';
  if (e?.code === 'same_password') return 'Your new password must be different from the current one.';
  if (e?.status === 429 || msg.includes('rate limit')) return 'Too many attempts. Please wait a moment and try again.';
  if (msg.includes('failed to fetch') || msg.includes('network')) return 'Unable to reach the server. Check your connection.';
  return e?.message || 'Something went wrong. Please try again.';
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly supabase = inject(SupabaseService);

  readonly session = signal<Session | null>(null);
  readonly user = computed<User | null>(() => this.session()?.user ?? null);
  readonly isAuthenticated = computed(() => !!this.session());
  readonly initialized = signal(false);
  /** Set when the user arrived through a password-recovery link. */
  readonly recoveryMode = signal(false);

  private initPromise?: Promise<void>;
  private listeners: ((event: AuthChangeEvent, session: Session | null) => void)[] = [];

  /** Resolves once the persisted session (if any) has been restored. */
  init(): Promise<void> {
    if (!this.supabase.configured) {
      this.initialized.set(true);
      return Promise.resolve();
    }
    this.initPromise ??= (async () => {
      const client = this.supabase.client;
      client.auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY') this.recoveryMode.set(true);
        this.session.set(session);
        for (const l of this.listeners) l(event, session);
      });
      const { data } = await client.auth.getSession();
      this.session.set(data.session);
      this.initialized.set(true);
    })();
    return this.initPromise;
  }

  onChange(listener: (event: AuthChangeEvent, session: Session | null) => void) {
    this.listeners.push(listener);
  }

  async accessToken(): Promise<string | null> {
    await this.init();
    const { data } = await this.supabase.client.auth.getSession();
    return data.session?.access_token ?? null;
  }

  async refresh(): Promise<string | null> {
    const { data, error } = await this.supabase.client.auth.refreshSession();
    if (error) return null;
    return data.session?.access_token ?? null;
  }

  async signIn(email: string, password: string) {
    const { error } = await this.supabase.client.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error(friendlyAuthError(error));
  }

  /** Returns true when the email must be verified before signing in. */
  async signUp(fullName: string, email: string, password: string): Promise<boolean> {
    const { data, error } = await this.supabase.client.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { full_name: fullName.trim() },
        emailRedirectTo: `${environment.appUrl}/auth/login?verified=1`,
      },
    });
    if (error) throw new Error(friendlyAuthError(error));
    // Supabase returns a user with no identities when the email is already registered.
    if (data.user && data.user.identities?.length === 0) {
      throw new Error('An account with this email already exists.');
    }
    return !data.session;
  }

  async resendVerification(email: string) {
    const { error } = await this.supabase.client.auth.resend({
      type: 'signup',
      email: email.trim(),
      options: { emailRedirectTo: `${environment.appUrl}/auth/login?verified=1` },
    });
    if (error) throw new Error(friendlyAuthError(error));
  }

  async sendPasswordReset(email: string) {
    const { error } = await this.supabase.client.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${environment.appUrl}/auth/reset-password`,
    });
    if (error) throw new Error(friendlyAuthError(error));
  }

  async updatePassword(newPassword: string) {
    const { error } = await this.supabase.client.auth.updateUser({ password: newPassword });
    if (error) throw new Error(friendlyAuthError(error));
    this.recoveryMode.set(false);
  }

  /** Verifies the current password before sensitive changes. */
  async verifyPassword(password: string): Promise<boolean> {
    const email = this.user()?.email;
    if (!email) return false;
    const { error } = await this.supabase.client.auth.signInWithPassword({ email, password });
    return !error;
  }

  async updateEmail(newEmail: string) {
    const { error } = await this.supabase.client.auth.updateUser(
      { email: newEmail.trim() },
      { emailRedirectTo: `${environment.appUrl}/settings?email_changed=1` },
    );
    if (error) throw new Error(friendlyAuthError(error));
  }

  async signOut() {
    await this.supabase.client.auth.signOut({ scope: 'local' });
    this.session.set(null);
  }
}
