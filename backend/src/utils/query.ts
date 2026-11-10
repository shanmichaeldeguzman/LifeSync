import { z } from 'zod';

export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * Makes free text safe to embed in a PostgREST `or=(...)` ilike filter:
 * strips the filter-grammar characters and escapes LIKE wildcards.
 */
export function sanitizeSearch(raw: string): string {
  return raw
    .slice(0, 100)
    .replace(/[,()"\\:]/g, ' ')
    .replace(/[%_*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
