import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { SupabaseService } from '../services/supabase.service';

/** Only signed-in users may enter the app shell. */
export const authGuard: CanActivateFn = async () => {
  const router = inject(Router);
  if (!inject(SupabaseService).configured) return router.parseUrl('/setup');
  const auth = inject(AuthService);
  await auth.init();
  return auth.isAuthenticated() ? true : router.parseUrl('/auth/login');
};

/** Signed-in users skip the sign-in screens (except password recovery). */
export const guestGuard: CanActivateFn = async () => {
  const router = inject(Router);
  if (!inject(SupabaseService).configured) return router.parseUrl('/setup');
  const auth = inject(AuthService);
  await auth.init();
  return auth.isAuthenticated() && !auth.recoveryMode() ? router.parseUrl('/dashboard') : true;
};
