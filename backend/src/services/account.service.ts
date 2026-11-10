import { z } from 'zod';
import type { SupabaseFactory } from '../config/supabase.js';
import type { AuthContext } from '../middleware/auth.js';
import { HttpError, fromDbError } from '../utils/http-error.js';
import { ProfileUpdate, PreferencesUpdate } from '../validation/schemas.js';
import type { Logger } from '../utils/logger.js';

const BUCKETS = ['documents', 'attachments', 'avatars'] as const;

export async function getProfile(ctx: AuthContext) {
  const [profile, preferences] = await Promise.all([
    ctx.db.from('profiles').select('*').maybeSingle(),
    ctx.db.from('user_preferences').select('*').maybeSingle(),
  ]);
  if (profile.error) throw fromDbError(profile.error);
  if (preferences.error) throw fromDbError(preferences.error);
  if (!profile.data) throw HttpError.notFound('Profile not found');
  return { profile: profile.data, preferences: preferences.data, email: ctx.email };
}

export async function updateProfile(ctx: AuthContext, body: unknown) {
  const patch = ProfileUpdate.parse(body);
  if (patch.avatar_path && !patch.avatar_path.startsWith(`${ctx.userId}/`)) {
    throw HttpError.badRequest('Invalid avatar location');
  }
  if (Object.keys(patch).length === 0) throw HttpError.badRequest('No changes were provided');
  const { data, error } = await ctx.db.from('profiles').update(patch).eq('id', ctx.userId).select('*').single();
  if (error) throw fromDbError(error);
  return data;
}

export async function updatePreferences(ctx: AuthContext, body: unknown) {
  const patch = PreferencesUpdate.parse(body);
  if (Object.keys(patch).length === 0) throw HttpError.badRequest('No changes were provided');
  const { data, error } = await ctx.db.from('user_preferences').update(patch).eq('user_id', ctx.userId).select('*').single();
  if (error) throw fromDbError(error);
  return data;
}

/** Full personal-data export (GDPR-style portability). Runs under RLS. */
export async function exportData(ctx: AuthContext) {
  const { data, error } = await ctx.db.rpc('export_my_data');
  if (error) throw fromDbError(error);
  return { ...(data as object), account: { id: ctx.userId, email: ctx.email } };
}

const DeleteAccountBody = z.object({
  password: z.string().min(1, 'Password is required'),
  confirm: z.literal('DELETE', { message: 'Type DELETE to confirm' }),
});

/**
 * Permanently deletes the account. The password is re-verified first, then all stored
 * files are removed and the auth user is deleted (which cascades to every table).
 */
export async function deleteAccount(ctx: AuthContext, factory: SupabaseFactory, body: unknown, logger: Logger) {
  const { password } = DeleteAccountBody.parse(body);
  if (!ctx.email) throw HttpError.badRequest('This account cannot be verified by password');

  const verifier = factory.anon();
  const { data: signIn, error: signInError } = await verifier.auth.signInWithPassword({ email: ctx.email, password });
  if (signInError || signIn.user?.id !== ctx.userId) {
    throw new HttpError(403, 'invalid_password', 'The password you entered is incorrect.');
  }

  const admin = factory.admin();
  for (const bucket of BUCKETS) {
    for (let round = 0; round < 50; round++) {
      const { data: files, error } = await admin.storage.from(bucket).list(ctx.userId, { limit: 1000 });
      if (error) {
        logger.warn({ bucket }, 'Could not list files during account deletion');
        break;
      }
      if (!files || files.length === 0) break;
      const { error: removeError } = await admin.storage.from(bucket).remove(files.map((f) => `${ctx.userId}/${f.name}`));
      if (removeError) {
        logger.warn({ bucket }, 'Could not remove files during account deletion');
        break;
      }
    }
  }

  const { error } = await admin.auth.admin.deleteUser(ctx.userId);
  if (error) {
    logger.error({ status: error.status }, 'Account deletion failed');
    throw new HttpError(500, 'delete_failed', 'We could not delete your account. Please try again.');
  }
}
