/**
 * Minimal HTML rendering helpers. No template engine — tagged template
 * literals + an explicit "already-escaped" wrapper are enough for the
 * amount of HTML this package produces.
 *
 * Rule: every interpolation in `html\`...\`` is escaped unless it's
 * already a SafeHtml (produced by another `html()` call or `unsafeHtml()`).
 * Pass user data into `${}` directly — never via .toString().
 */

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escape(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);
}

const SAFE_BRAND = Symbol('SafeHtml');

export interface SafeHtml {
  readonly [SAFE_BRAND]: true;
  readonly value: string;
  toString(): string;
}

function makeSafe(value: string): SafeHtml {
  return {
    [SAFE_BRAND]: true,
    value,
    toString() { return value; },
  };
}

function isSafe(v: unknown): v is SafeHtml {
  return typeof v === 'object' && v !== null && (v as SafeHtml)[SAFE_BRAND] === true;
}

/** Mark an already-escaped string as safe to inline without further escaping. */
export function unsafeHtml(raw: string): SafeHtml {
  return makeSafe(raw);
}

/**
 * Tagged template for HTML. Interpolated values are escaped unless they
 * were produced by another `html()` or `unsafeHtml()` call. Arrays are
 * joined without a separator (convenient for row loops).
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Array.isArray(v)) {
      out += v.map((item) => (isSafe(item) ? item.value : escape(item))).join('');
    } else if (isSafe(v)) {
      out += v.value;
    } else {
      out += escape(v);
    }
    out += strings[i + 1];
  }
  return makeSafe(out);
}

/** Render a SafeHtml to its string representation for sending over HTTP. */
export function render(h: SafeHtml): string {
  return h.value;
}
