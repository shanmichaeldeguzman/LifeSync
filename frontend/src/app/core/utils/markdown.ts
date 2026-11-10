import DOMPurify from 'dompurify';
import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: true });

/** Renders user Markdown to sanitized HTML (no scripts, handlers or unsafe URLs). */
export function renderMarkdown(src: string): string {
  // Render GFM checklists as symbols (form inputs are stripped by the sanitizer).
  const prepared = (src ?? '').replace(/^(\s*[-*+]\s+)\[( |x|X)\]\s+/gm, (_m, bullet: string, c: string) => `${bullet}${c.trim() ? '☑' : '☐'} `);
  const html = marked.parse(prepared, { async: false });
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'iframe', 'form', 'input', 'button', 'object', 'embed'],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|#)/i,
  });
}

/** Plain-text excerpt of Markdown for previews and search. */
export function markdownExcerpt(src: string, max = 160): string {
  const text = (src ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)]\([^)]*\)/g, '$1')
    .replace(/^(\s*[-*+]\s+)\[[ xX]]\s*/gm, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_~]{1,3}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}
