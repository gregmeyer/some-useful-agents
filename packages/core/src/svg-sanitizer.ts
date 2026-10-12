/**
 * SVG from a model, made safe to keep and show: the document is rebuilt from
 * an allowlist of plain drawing elements and presentational attributes. No
 * scripts, event handlers, styles, links, foreignObject, embedded images, or
 * external references survive; `url()` may only point inside the SVG
 * (`url(#grad)`). Anything unexpected is dropped, never passed through.
 *
 * It's served as an image (an <img>, where SVG never runs script) with a
 * locked-down CSP as well, so this is the second of two walls.
 */

const ELEMENTS = new Set([
  'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'defs', 'lineargradient', 'radialgradient', 'stop', 'title',
]);

/** Element names as SVG spells them (the tokenizer lowercases). */
const CASE: Record<string, string> = { lineargradient: 'linearGradient', radialgradient: 'radialGradient' };

const ATTRS = new Set([
  'viewbox', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy',
  'd', 'points', 'transform', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray',
  'opacity', 'fill-opacity', 'stroke-opacity', 'fill-rule', 'clip-rule', 'font-size', 'font-family', 'font-weight',
  'text-anchor', 'dominant-baseline', 'letter-spacing', 'offset', 'stop-color', 'stop-opacity', 'id', 'gradientunits',
  'gradienttransform', 'spreadmethod', 'preserveaspectratio', 'xmlns', 'role', 'aria-label',
]);

const ATTR_CASE: Record<string, string> = {
  viewbox: 'viewBox', gradientunits: 'gradientUnits', gradienttransform: 'gradientTransform', spreadmethod: 'spreadMethod', preserveaspectratio: 'preserveAspectRatio',
};

export const MAX_SVG_BYTES = 48 * 1024;

const escText = (s: string) => s.replace(/&(?!(?:amp|lt|gt|quot|#\d+|#x[0-9a-f]+);)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A value is safe when it can't reach outside the SVG or run anything. */
function safeValue(name: string, value: string): string | undefined {
  const v = value.replace(/[\u0000-\u001f]/g, '').trim();
  if (v.length > 4000) return undefined;
  if (/(javascript|data|vbscript)\s*:/i.test(v) || /expression\s*\(/i.test(v) || /@import/i.test(v)) return undefined;
  // url() only to an id inside this SVG.
  for (const m of v.matchAll(/url\s*\(([^)]*)\)/gi)) {
    if (!/^\s*['"]?#[A-Za-z][\w.-]*['"]?\s*$/.test(m[1])) return undefined;
  }
  if (name === 'xmlns' && v !== 'http://www.w3.org/2000/svg') return undefined;
  if (name === 'id' && !/^[A-Za-z][\w.-]{0,63}$/.test(v)) return undefined;
  return v;
}

/**
 * The SVG rebuilt from its allowed parts, or undefined when there's no `<svg>`
 * root or it's too big. The result always has the SVG namespace.
 */
export function sanitizeSvg(input: string): string | undefined {
  if (typeof input !== 'string' || input.length > MAX_SVG_BYTES * 2) return undefined;
  // Comments, CDATA, processing instructions and doctypes go first.
  const src = input.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!DOCTYPE[\s\S]*?>/gi, '');
  const out: string[] = [];
  const open: string[] = [];
  // Inside a dropped element, everything to its close is dropped too.
  let skipping: { name: string; depth: number } | undefined;
  let sawRoot = false;
  const TOKEN = /<\/?([A-Za-z][\w:-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"']+))?)*)\s*(\/?)>|([^<]+)|(<)/g;
  for (const m of src.matchAll(TOKEN)) {
    const [whole, rawName, rawAttrs, selfClose, text] = m;
    if (text !== undefined || m[5] !== undefined) {
      if (skipping) continue;
      const t = text ?? '&lt;';
      // Text only inside text / tspan / title.
      if (open.length && ['text', 'tspan', 'title'].includes(open[open.length - 1])) out.push(escText(t));
      continue;
    }
    const name = rawName.toLowerCase().replace(/^svg:/, '');
    const closing = whole.startsWith('</');
    if (skipping) {
      if (name === skipping.name) {
        if (closing) { skipping.depth--; if (skipping.depth === 0) skipping = undefined; }
        else if (!selfClose) skipping.depth++;
      }
      continue;
    }
    if (!ELEMENTS.has(name)) {
      if (!closing && !selfClose) skipping = { name, depth: 1 };
      continue;
    }
    if (!sawRoot && name !== 'svg') continue;
    if (closing) {
      const at = open.lastIndexOf(name);
      if (at === -1) continue;
      while (open.length > at) { const n = open.pop()!; out.push(`</${CASE[n] ?? n}>`); }
      continue;
    }
    if (name === 'svg') sawRoot = true;
    const attrs: string[] = [];
    let hasNs = false;
    for (const a of (rawAttrs ?? '').matchAll(/([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g)) {
      const an = a[1].toLowerCase();
      if (an.startsWith('on') || an.includes(':') && an !== 'xmlns') continue;
      if (!ATTRS.has(an)) continue;
      const raw = a[2] ?? a[3] ?? a[4] ?? '';
      const val = safeValue(an, raw);
      if (val === undefined) continue;
      if (an === 'xmlns') hasNs = true;
      attrs.push(`${ATTR_CASE[an] ?? an}="${escAttr(val)}"`);
    }
    if (name === 'svg' && !hasNs) attrs.unshift('xmlns="http://www.w3.org/2000/svg"');
    const tag = CASE[name] ?? name;
    if (selfClose) out.push(`<${tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}/>`);
    else { out.push(`<${tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}>`); open.push(name); }
  }
  if (!sawRoot) return undefined;
  while (open.length) { const n = open.pop()!; out.push(`</${CASE[n] ?? n}>`); }
  const svg = out.join('');
  return Buffer.byteLength(svg, 'utf8') > MAX_SVG_BYTES ? undefined : svg;
}
