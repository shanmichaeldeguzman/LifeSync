import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import { randomUUID } from 'node:crypto';
import type { Env } from './config/env.js';
import { createSupabaseFactory, type SupabaseFactory } from './config/supabase.js';
import { requireAuth, supabaseTokenVerifier, type TokenVerifier } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { buildApiRouter } from './routes/index.js';
import { createLogger, type Logger } from './utils/logger.js';

export interface AppDeps {
  env: Env;
  factory?: SupabaseFactory;
  verifyToken?: TokenVerifier;
  logger?: Logger;
}

/** Builds the Express application. Dependencies are injectable for testing. */
export function createApp({ env, factory, verifyToken, logger }: AppDeps): Express {
  const log = logger ?? createLogger(env.LOG_LEVEL);
  const supabase = factory ?? createSupabaseFactory(env);
  const verify = verifyToken ?? supabaseTokenVerifier(supabase);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind Vercel / Render proxies: needed for correct client IPs

  app.use(
    pinoHttp({
      logger: log,
      genReqId: (req) => (req.headers['x-request-id'] as string) ?? randomUUID(),
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: String(req.url).split('?')[0] }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } } }));
  app.use(
    cors({
      origin(origin, callback) {
        // Allow non-browser clients (no Origin header) and configured frontends only.
        if (!origin || env.CORS_ORIGINS.includes(origin)) return callback(null, true);
        return callback(null, false);
      },
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
      exposedHeaders: ['Content-Disposition'],
      maxAge: 86400,
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  app.use(
    '/api',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 1000,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: { code: 'rate_limited', message: 'Too many requests. Please slow down.' } },
    }),
  );

  app.get('/api/health', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ status: 'ok', service: 'lifesync-api', time: new Date().toISOString() });
  });

  app.use('/api', requireAuth(supabase, verify), buildApiRouter(supabase, log));

  app.use(notFoundHandler);
  app.use(errorHandler(log));
  return app;
}
