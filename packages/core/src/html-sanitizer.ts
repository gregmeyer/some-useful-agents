/**
 * Tag/attribute allowlist sanitizer for AI-generated HTML.
 *
 * Trade-off: zero deps + small attack surface. We strip every tag we
 * don't recognize (keeping the tag's text content), strip every attribute
 * not in the allowlist, and forbid javascript: / data: URLs except for
 * inline images (data:image/...). This is intentionally restrictive —
 * agents authoring fancy HTML can iterate on prompts to stay inside.
 *
 * NOT a CSP replacement. Templates still render inside the dashboard's
 * existing CSP, which already blocks remote scripts and external fonts.
 */

// Lowercase keys; original case looked up via SVG_CASED_TAGS for emission.
const ALLOWED_TAGS = new Set<string>([
  // Block + inline text
  'div', 'span', 'p', 'br', 'hr', 'pre', 'code', 'small', 'strong', 'em', 'b', 'i', 'u',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  // Lists
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  // Tables
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  // Sections / semantic
  'section', 'article', 'header', 'footer', 'nav', 'aside', 'main', 'figure', 'figcaption',
  // Quote / details
  'blockquote', 'q', 'details', 'summary',
  // Media
  'img', 'a',
  // SVG (whitelist of common shapes + text)
  'svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'defs', 'use', 'symbol', 'title', 'desc', 'lineargradient',
  'radialgradient', 'stop', 'clippath', 'mask',
]);

const SVG_CASED_TAGS: Record<string, string> = {
  lineargradient: 'linearGradient',
  radialgradient: 'radialGradient',
  clippath: 'clipPath',
};

const SELF_CLOSING = new Set<string>(['br', 'hr', 'img', 'col']);

const COMMON_ATTRS = new Set<string>([
  'class', 'style', 'id', 'role', 'title', 'lang', 'dir', 'tabindex',
]);

const TAG_SPECIFIC_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'rel', 'target']),
  img: new Set(['src', 'alt', 'width', 'height', 'loading']),
  td: new Set(['colspan', 'rowspan', 'headers', 'scope']),
  th: new Set(['colspan', 'rowspan', 'headers', 'scope', 'abbr']),
  col: new Set(['span']),
  colgroup: new Set(['span']),
  table: new Set(['summary']),
  details: new Set(['open']),
  // SVG core + presentation. Keys are LOWERCASED — emission preserves
  // original case via SVG_CASED_ATTRS where required.
  svg: new Set(['viewbox', 'xmlns', 'width', 'height', 'fill', 'stroke', 'stroke-width', 'preserveaspectratio']),
  g: new Set(['transform', 'fill', 'stroke', 'stroke-width', 'opacity']),
  path: new Set(['d', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'fill-rule', 'clip-rule', 'opacity', 'transform']),
  circle: new Set(['cx', 'cy', 'r', 'fill', 'stroke', 'stroke-width', 'opacity', 'transform']),
  ellipse: new Set(['cx', 'cy', 'rx', 'ry', 'fill', 'stroke', 'stroke-width', 'opacity', 'transform']),
  rect: new Set(['x', 'y', 'width', 'height', 'rx', 'ry', 'fill', 'stroke', 'stroke-width', 'opacity', 'transform']),
  line: new Set(['x1', 'y1', 'x2', 'y2', 'stroke', 'stroke-width', 'stroke-linecap', 'opacity', 'transform']),
  polyline: new Set(['points', 'fill', 'stroke', 'stroke-width', 'opacity', 'transform']),
  polygon: new Set(['points', 'fill', 'stroke', 'stroke-width', 'opacity', 'transform']),
  text: new Set(['x', 'y', 'dx', 'dy', 'fill', 'stroke', 'font-size', 'font-family', 'font-weight', 'text-anchor', 'dominant-baseline', 'transform']),
  tspan: new Set(['x', 'y', 'dx', 'dy', 'fill', 'font-size', 'font-weight']),
  use: new Set(['href', 'x', 'y', 'width', 'height']),
  symbol: new Set(['viewbox']),
  lineargradient: new Set(['x1', 'y1', 'x2', 'y2', 'gradientunits', 'gradienttransform']),
  radialgradient: new Set(['cx', 'cy', 'r', 'fx', 'fy', 'gradientunits', 'gradienttransform']),
  stop: new Set(['offset', 'stop-color', 'stop-opacity']),
  clippath: new Set(['clippathunits']),
  mask: new Set(['maskunits', 'x', 'y', 'width', 'height']),
};

const URL_ATTRS = new Set(['href', 'src']);

/**
 * SVG attrs that must preserve camelCase. Stored lowercase here for
 * lookup; the canonical case is what we emit.
 */
const SVG_CASED_ATTRS: Record<string, string> = {
  viewbox: 'viewBox',
  preserveaspectratio: 'preserveAspectRatio',
  gradientunits: 'gradientUnits',
  gradienttransform: 'gradientTransform',
  clippath: 'clipPath',
  clippathunits: 'clipPathUnits',
  maskunits: 'maskUnits',
  textanchor: 'text-anchor', // already kebab in spec
};

function isAttrAllowed(tag: string, attr: string): boolean {
  if (attr.startsWith('aria-') || attr.startsWith('data-')) return true;
  if (COMMON_ATTRS.has(attr)) return true;
  return TAG_SPECIFIC_ATTRS[tag]?.has(attr) ?? false;
}

/**
 * Reject URLs that could exfiltrate or execute. Only http(s), mailto, and
 * data:image/* are allowed; everything else (javascript:, vbscript:, data:
 * with non-image MIME, file:) is dropped.
 */
function isSafeUrl(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  // Anchor / relative paths are safe.
  if (v.startsWith('#') || v.startsWith('/') || v.startsWith('./') || v.startsWith('../')) return true;
  // Explicit safe schemes.
  const lower = v.toLowerCase();
  if (lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('mailto:')) return true;
  if (lower.startsWith('data:image/')) return true;
  // Anything else with a scheme is rejected.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(v)) return false;
  // Bare relative path (no scheme, no leading /) — safe.
  return true;
}

/** Kill javascript: and expression() in inline style. Cheap but effective. */
function sanitizeStyle(value: string): string {
  // Remove anything that looks like url(javascript:...) or expression(...).
  let s = value.replace(/expression\s*\(/gi, '');
  s = s.replace(/url\s*\(\s*['"]?\s*javascript:[^)]*\)/gi, '');
  s = s.replace(/url\s*\(\s*['"]?\s*vbscript:[^)]*\)/gi, '');
  s = s.replace(/javascript\s*:/gi, '');
  return s;
}

interface ParsedAttrs {
  rawTagBody: string;
  attrs: Record<string, string>;
}

function parseAttrs(tagBody: string): ParsedAttrs {
  const attrs: Record<string, string> = {};
  // Match name="value" | name='value' | name=value | name (boolean)
  const re = /([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g;
  let m: RegExpExecArray | null;
  // Skip past the tag name
  const skip = tagBody.match(/^[a-zA-Z][a-zA-Z0-9-]*/);
  re.lastIndex = skip ? skip[0].length : 0;
  while ((m = re.exec(tagBody)) !== null) {
    const name = m[1].toLowerCase();
    const value = m[2] ?? m[3] ?? m[4] ?? '';
    attrs[name] = value;
  }
  return { rawTagBody: tagBody, attrs };
}

function buildAttrString(tag: string, attrs: Record<string, string>): string {
  const parts: string[] = [];
  for (const [name, raw] of Object.entries(attrs)) {
    if (!isAttrAllowed(tag, name)) continue;
    if (name.startsWith('on')) continue; // belt + suspenders
    let value = raw;
    if (URL_ATTRS.has(name)) {
      if (!isSafeUrl(value)) continue;
    }
    if (name === 'style') {
      value = sanitizeStyle(value);
    }
    const emitName = SVG_CASED_ATTRS[name] ?? name;
    const escaped = value.replace(/"/g, '&quot;').replace(/</g, '&lt;');
    parts.push(`${emitName}="${escaped}"`);
  }
  return parts.length > 0 ? ' ' + parts.join(' ') : '';
}

/**
 * Sanitize untrusted HTML to a tag/attr allowlist. Strips:
 *  - all <script>, <style>, <iframe>, <object>, <embed>, <link>, <form>, <input>...
 *  - any tag not in ALLOWED_TAGS (preserving inner text)
 *  - any attribute not in the per-tag allowlist
 *  - on*, javascript:, vbscript:, data: (except data:image/*)
 *  - HTML comments (which can hide IE-conditional script)
 */
export function sanitizeHtml(input: string): string {
  // Strip dangerous block constructs entirely first.
  let s = input;
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<(script|style|iframe|object|embed|noscript|template|xml|head|meta|link|form|input|button|select|textarea|frame|frameset|applet|base)[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  // And any orphan opening of those that lacks a closing tag.
  s = s.replace(/<(script|style|iframe|object|embed|noscript|template|xml|head|meta|link|form|input|button|select|textarea|frame|frameset|applet|base)[^>]*\/?>/gi, '');

  // Walk all remaining tags.
  return s.replace(/<\/?([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g, (match, rawTag, body) => {
    const tag = String(rawTag).toLowerCase();
    const isClose = match.startsWith('</');

    if (!ALLOWED_TAGS.has(tag)) {
      // Drop the tag entirely (preserve any inner text via the surrounding pass).
      return '';
    }

    const emitTag = SVG_CASED_TAGS[tag] ?? tag;
    if (isClose) {
      return `</${emitTag}>`;
    }

    const { attrs } = parseAttrs(`${tag} ${body}`);
    const attrStr = buildAttrString(tag, attrs);
    const selfClose = SELF_CLOSING.has(tag) || /\/\s*$/.test(body);
    return `<${emitTag}${attrStr}${selfClose ? ' />' : '>'}`;
  });
}

/**
 * Substitute placeholders against agent output values. Always run BEFORE
 * `sanitizeHtml` so the allowlist catches any HTML that slipped through —
 * including the unescaped `{{{var}}}` form below.
 *
 * Supported syntax:
 *   {{outputs.NAME}}                            scalar, HTML-escaped
 *   {{{outputs.NAME}}}                          scalar, unescaped (sanitizer still runs after)
 *   {{result}} / {{{result}}}                   the raw run output
 *   {{#each outputs.NAME as item}} … {{/each}}  iterate an array
 *     inside the block: {{item.field}} (escaped), {{{item.field}}} (unescaped),
 *     {{@index}} (zero-based)
 *   {{#if outputs.NAME}} … {{/if}}              keep block when output is truthy
 *     (truthy = not null/undefined, not empty string, not false, not 0, not empty array)
 *
 * Deliberately tiny grammar: no nested ifs, no else, no helpers (no `eq`, no
 * `unless`). #if added because LLMs reach for it constantly when describing
 * "show the success card if found, otherwise show the empty state" — the
 * workaround was always-render which produced broken UIs. Single-level only;
 * for branching, render two templates and pick via a field-toggle control.
 */
export function substitutePlaceholders(
  template: string,
  values: { outputs?: Record<string, unknown>; result?: string },
): string {
  const escape = (s: string): string =>
    String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const stringify = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  };

  const isTruthy = (v: unknown): boolean => {
    if (v === null || v === undefined) return false;
    if (v === false || v === 0) return false;
    if (typeof v === 'string') return v.length > 0;
    if (Array.isArray(v)) return v.length > 0;
    return true;
  };

  // 0. #if blocks first — drop or keep the body based on truthiness, before
  //    any inner #each / placeholder substitution so we don't waste work on
  //    a branch we're going to discard.
  let out = template.replace(
    /\{\{\s*#if\s+outputs\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}([\s\S]*?)\{\{\s*\/if\s*\}\}/g,
    (_, name: string, body: string) => (isTruthy(values.outputs?.[name]) ? body : ''),
  );

  // 1. Each blocks — non-greedy body match means an inner #each would
  //    confuse the parser; that's by design (no nested loops).
  out = out.replace(
    /\{\{\s*#each\s+outputs\.([a-zA-Z_][a-zA-Z0-9_]*)\s+as\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}([\s\S]*?)\{\{\s*\/each\s*\}\}/g,
    (_, name: string, itemName: string, body: string) => {
      const arr = values.outputs?.[name];
      if (!Array.isArray(arr)) return '';
      const itemRe = new RegExp(`([a-zA-Z_][a-zA-Z0-9_]*)`); // unused, just for symmetry
      void itemRe;
      const tripleRe = new RegExp(`\\{\\{\\{\\s*${itemName}(?:\\.([a-zA-Z_][a-zA-Z0-9_]*))?\\s*\\}\\}\\}`, 'g');
      const doubleRe = new RegExp(`\\{\\{\\s*${itemName}(?:\\.([a-zA-Z_][a-zA-Z0-9_]*))?\\s*\\}\\}`, 'g');
      return arr.map((item, index) => {
        let line = body;
        line = line.replace(tripleRe, (_match, field?: string) => {
          if (!field) return stringify(item);
          return stringify((item as Record<string, unknown> | null)?.[field]);
        });
        line = line.replace(doubleRe, (_match, field?: string) => {
          if (!field) return escape(stringify(item));
          return escape(stringify((item as Record<string, unknown> | null)?.[field]));
        });
        line = line.replace(/\{\{\s*@index\s*\}\}/g, String(index));
        return line;
      }).join('');
    },
  );

  // 2. Triple-brace unescaped — must run before double-brace so the regex
  //    doesn't match the inner double braces of `{{{x}}}`.
  out = out.replace(
    /\{\{\{\s*outputs\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}\}/g,
    (_, name: string) => stringify(values.outputs?.[name]),
  );
  out = out.replace(/\{\{\{\s*result\s*\}\}\}/g, () => values.result ?? '');

  // 3. Double-brace escaped — original behaviour.
  out = out.replace(
    /\{\{\s*outputs\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g,
    (_, name: string) => escape(stringify(values.outputs?.[name])),
  );
  out = out.replace(/\{\{\s*result\s*\}\}/g, () => escape(values.result ?? ''));

  return out;
}
