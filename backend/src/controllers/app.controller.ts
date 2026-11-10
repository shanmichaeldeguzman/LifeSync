import type { Request, Response } from 'express';
import type { SupabaseFactory } from '../config/supabase.js';
import { auth } from '../middleware/auth.js';
import * as account from '../services/account.service.js';
import { dashboardSummary } from '../services/dashboard.service.js';
import * as finance from '../services/finance.service.js';
import { pullChanges } from '../services/sync.service.js';
import { fromDbError } from '../utils/http-error.js';
import type { Logger } from '../utils/logger.js';

/** Controllers for non-CRUD endpoints (sync, dashboard, finance, notifications, account). */
export function appController(factory: SupabaseFactory, logger: Logger) {
  return {
    syncPull: async (req: Request, res: Response) => {
      res.set('Cache-Control', 'no-store').json(await pullChanges(auth(req), req.query.since));
    },
    dashboard: async (req: Request, res: Response) => {
      res.json({ data: await dashboardSummary(auth(req), req.query) });
    },
    financeSummary: async (req: Request, res: Response) => {
      res.json({ data: await finance.monthlySummary(auth(req), req.query.month) });
    },
    financeExport: async (req: Request, res: Response) => {
      const csv = await finance.exportTransactionsCsv(auth(req), req.query);
      const stamp = new Date().toISOString().slice(0, 10);
      res
        .set('Content-Type', 'text/csv; charset=utf-8')
        .set('Content-Disposition', `attachment; filename="lifesync-transactions-${stamp}.csv"`)
        .set('Cache-Control', 'no-store')
        .send('﻿' + csv);
    },
    financeRunRecurring: async (req: Request, res: Response) => {
      res.json({ data: { created: await finance.runRecurring(auth(req)) } });
    },
    notificationsRefresh: async (req: Request, res: Response) => {
      const { data, error } = await auth(req).db.rpc('refresh_my_notifications');
      if (error) throw fromDbError(error);
      res.json({ data: { created: Number(data ?? 0) } });
    },
    notificationsReadAll: async (req: Request, res: Response) => {
      const ctx = auth(req);
      const { data, error } = await ctx.db
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .is('read_at', null)
        .select('id');
      if (error) throw fromDbError(error);
      res.json({ data: { updated: data?.length ?? 0 } });
    },
    getProfile: async (req: Request, res: Response) => {
      res.json({ data: await account.getProfile(auth(req)) });
    },
    updateProfile: async (req: Request, res: Response) => {
      res.json({ data: await account.updateProfile(auth(req), req.body) });
    },
    updatePreferences: async (req: Request, res: Response) => {
      res.json({ data: await account.updatePreferences(auth(req), req.body) });
    },
    exportData: async (req: Request, res: Response) => {
      const data = await account.exportData(auth(req));
      const stamp = new Date().toISOString().slice(0, 10);
      res
        .set('Content-Disposition', `attachment; filename="lifesync-export-${stamp}.json"`)
        .set('Cache-Control', 'no-store')
        .json(data);
    },
    deleteAccount: async (req: Request, res: Response) => {
      await account.deleteAccount(auth(req), factory, req.body, logger);
      res.status(204).end();
    },
  };
}
