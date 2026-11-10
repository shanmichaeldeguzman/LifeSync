import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { RESOURCES } from '../config/resources.js';
import type { SupabaseFactory } from '../config/supabase.js';
import { appController } from '../controllers/app.controller.js';
import { resourceController } from '../controllers/resource.controller.js';
import type { Logger } from '../utils/logger.js';

/**
 * All authenticated API routes. Mounted under /api behind `requireAuth`.
 *
 *   GET    /sync/pull?since=ISO              incremental offline sync
 *   GET    /dashboard/summary                dashboard snapshot
 *   GET    /finance/summary?month=YYYY-MM    monthly totals, breakdown, budgets, trend
 *   GET    /finance/export.csv               CSV export of transactions
 *   POST   /finance/recurring/run            materialise due recurring transactions
 *   POST   /notifications/refresh            generate due reminders
 *   POST   /notifications/read-all           mark all as read
 *   GET    /profile | PATCH /profile | PATCH /preferences
 *   GET    /account/export | DELETE /account
 *   CRUD   /<resource>[/:id]                 see config/resources.ts
 */
export function buildApiRouter(factory: SupabaseFactory, logger: Logger): Router {
  const router = Router();
  const app = appController(factory, logger);

  const sensitiveLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => req.auth?.userId ?? 'anonymous',
    message: { error: { code: 'rate_limited', message: 'Too many attempts. Please try again later.' } },
  });

  router.get('/sync/pull', app.syncPull);
  router.get('/dashboard/summary', app.dashboard);

  router.get('/finance/summary', app.financeSummary);
  router.get('/finance/export.csv', app.financeExport);
  router.post('/finance/recurring/run', app.financeRunRecurring);

  router.post('/notifications/refresh', app.notificationsRefresh);
  router.post('/notifications/read-all', app.notificationsReadAll);

  router.get('/profile', app.getProfile);
  router.patch('/profile', app.updateProfile);
  router.patch('/preferences', app.updatePreferences);
  router.get('/account/export', app.exportData);
  router.delete('/account', sensitiveLimiter, app.deleteAccount);

  for (const config of RESOURCES) {
    const c = resourceController(config, logger);
    const base = `/${config.path}`;
    router.get(base, c.list);
    router.post(base, c.create);
    router.get(`${base}/:id`, c.get);
    router.patch(`${base}/:id`, c.update);
    router.delete(`${base}/:id`, c.remove);
    if (config.storageBucket) router.get(`${base}/:id/file-url`, c.fileUrl);
  }

  return router;
}
