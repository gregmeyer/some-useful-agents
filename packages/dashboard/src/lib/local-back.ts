/**
 * A form's `back` path, when it's a page on this dashboard. The dashboard
 * sends `Referrer-Policy: no-referrer`, so a form that should return you to
 * where you were carries the path itself. Anything that could leave the
 * site (`//host`, `/\host`, a full URL, whitespace) is refused: undefined.
 */
export function localBack(v: unknown): string | undefined {
  return typeof v === 'string' && v.length <= 500 && /^\/(?![/\\])[^\s\\]*$/.test(v) ? v : undefined;
}
