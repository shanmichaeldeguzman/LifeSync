import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createLogger } from './utils/logger.js';

/** Standalone HTTP server (local development, Render, any Node host). */
const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);
const app = createApp({ env, logger });

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'LifeSync API listening');
});

const shutdown = (signal: string) => {
  logger.info({ signal }, 'Shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
