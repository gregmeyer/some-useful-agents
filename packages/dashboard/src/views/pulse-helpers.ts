/**
 * Shared helpers for Pulse tile rendering: HTML escaping, markdown,
 * JSON detection, and value stringification.
 */

/** HTML-escape a string for safe insertion into markup. */
export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Convert any value to a display string. Handles objects that would show as [object Object]. */
export function stringify(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  try { return JSON.stringify(val, null, 2); } catch { return String(val); }
}

/**
 * Lightweight markdown to HTML. Handles the common patterns agents produce:
 * headers, bold, italic, links, tables, lists, inline code, line breaks.
 */
export function renderMarkdown(text: string): string {
  let h = esc(text);

  h = h.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="pulse-tile__code">$2</pre>');
  h = h.replace(/`([^`]+)`/g, '<code style="background:var(--color-surface-raised);padding:0 var(--space-1);border-radius:3px;font-size:var(--font-size-xs);">$1</code>');
  h = h.replace(/^### (.+)$/gm, '<strong style="font-size:var(--font-size-sm);display:block;margin-top:var(--space-2);">$1</strong>');
  h = h.replace(/^## (.+)$/gm, '<strong style="font-size:var(--font-size-md);display:block;margin-top:var(--space-2);">$1</strong>');
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/\*(.+?)\*/g, '<em>$1</em>');
  h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:var(--color-primary);" target="_blank" rel="noopener">$1</a>');

  const tableRe = /^(\|.+\|)\n(\|[-| :]+\|)\n((?:\|.+\|\n?)+)/gm;
  h = h.replace(tableRe, (_, headerRow: string, _sep: string, bodyRows: string) => {
    const headers = headerRow.split('|').filter(Boolean).map((c: string) => c.trim());
    const rows = bodyRows.trim().split('\n').map((r: string) => r.split('|').filter(Boolean).map((c: string) => c.trim()));
    return '<table class="pulse-table" style="margin:var(--space-2) 0;"><thead><tr>' + headers.map((h: string) => `<th>${h}</th>`).join('') + '</tr></thead><tbody>' + rows.map((r: string[]) => '<tr>' + r.map((c: string) => `<td>${c}</td>`).join('') + '</tr>').join('') + '</tbody></table>';
  });

  h = h.replace(/^- (.+)$/gm, '<li style="margin-left:var(--space-4);list-style:disc;">$1</li>');
  h = h.replace(/\n{2,}/g, '<br><br>');
  h = h.replace(/\n/g, '<br>');

  return h;
}

/** Check if a string looks like JSON (starts with { or [). */
export function looksLikeJson(s: string): boolean {
  const t = s.trimStart();
  if (!t.startsWith('{') && !t.startsWith('[')) return false;
  try { JSON.parse(t); return true; } catch { return false; }
}

/** Pretty-print a JSON string with 2-space indent. */
export function prettyJson(s: string): string {
  try { return JSON.stringify(JSON.parse(s.trim()), null, 2); } catch { return s; }
}
