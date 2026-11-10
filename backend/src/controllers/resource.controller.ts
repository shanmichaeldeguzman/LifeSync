import type { Request, Response } from 'express';
import { z } from 'zod';
import type { ResourceConfig } from '../config/resources.js';
import { auth } from '../middleware/auth.js';
import { CrudService } from '../services/crud.service.js';
import { HttpError, fromDbError } from '../utils/http-error.js';
import type { Logger } from '../utils/logger.js';

/** Thin HTTP adapter over CrudService for one resource. */
export function resourceController(config: ResourceConfig, logger: Logger) {
  const service = new CrudService(config, logger);

  return {
    list: async (req: Request, res: Response) => {
      res.json(await service.list(auth(req), req.query as Record<string, unknown>));
    },
    get: async (req: Request, res: Response) => {
      res.json({ data: await service.get(auth(req), String(req.params.id)) });
    },
    create: async (req: Request, res: Response) => {
      const { row, created } = await service.create(auth(req), req.body);
      res.status(created ? 201 : 200).json({ data: row });
    },
    update: async (req: Request, res: Response) => {
      const force = req.query.force === 'true';
      res.json({ data: await service.update(auth(req), String(req.params.id), req.body, force) });
    },
    remove: async (req: Request, res: Response) => {
      await service.remove(auth(req), String(req.params.id));
      res.status(204).end();
    },
    /** Short-lived signed URL for a private file (never a public URL). */
    fileUrl: async (req: Request, res: Response) => {
      if (!config.storageBucket) throw HttpError.notFound();
      const ctx = auth(req);
      const row = await service.get(ctx, String(req.params.id));
      const download = z.enum(['true', 'false']).optional().parse(req.query.download) === 'true';
      const { data, error } = await ctx.db.storage
        .from(config.storageBucket)
        .createSignedUrl(String(row.storage_path), 60, download ? { download: String(row.file_name) } : undefined);
      if (error || !data) throw fromDbError({ code: 'storage' });
      res.set('Cache-Control', 'no-store').json({ data: { url: data.signedUrl, expiresIn: 60 } });
    },
  };
}
