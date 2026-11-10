import pino from 'pino';

/**
 * Structured logger. Authorization headers, cookies and request bodies are never logged,
 * so tokens and personal data (notes, finances, documents) stay out of log storage.
 */
export function createLogger(level: string) {
  return pino({
    level,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.body',
        'res.headers["set-cookie"]',
        '*.password',
        '*.token',
      ],
      remove: true,
    },
  });
}
export type Logger = ReturnType<typeof createLogger>;
