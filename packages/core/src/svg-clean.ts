/**
 * An SVG drawing a model wrote, made safe to draw: one <svg> element, no
 * scripts, no event handlers, no embedded HTML, and nothing it would fetch
 * (only links within itself and inline pictures). Its size comes from its
 * width/height or viewBox, so it's drawn at the size it was made for.
 */

/** The largest drawing taken, in characters. */
export const SVG_MAX_CHARS = 400_000;

export type CleanSvg = { svg: string; width: number; height: number } | { error: string };

const num = (s: string | undefined): number | undefined => {
  const n = s ? Number.parseFloat(s) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/** The first <svg>…</svg> in a reply, cleaned; or why there's none. */
export function cleanSvg(text: string): CleanSvg {
  const m = /<svg\b[\s\S]*<\/svg>/i.exec(text);
  if (!m) return { error: 'There is no <svg> drawing in it.' };
  let svg = m[0];
  if (svg.length > SVG_MAX_CHARS) return { error: `The drawing is too big (${String(svg.length)} characters; at most ${String(SVG_MAX_CHARS)}).` };
  svg = svg
    // Code and embedded pages never run or show.
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*\/>/gi, '')
    .replace(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, '')
    .replace(/<(iframe|object|embed|audio|video|canvas)\b[\s\S]*?(<\/\1\s*>|\/>)/gi, '')
    // No event handlers.
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    // Links only within the drawing or to an inline picture; nothing fetched.
    .replace(/\s+((?:xlink:)?href)\s*=\s*("([^"]*)"|'([^']*)')/gi, (all, attr: string, _q: string, d?: string, s?: string) => {
      const v = (d ?? s ?? '').trim();
      return v.startsWith('#') || /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(v) ? ` ${attr}="${v}"` : '';
    })
    // CSS can fetch too (@import, url(http…)).
    .replace(/@import[^;]*;?/gi, '')
    .replace(/url\(\s*(['"]?)(?!#|data:image\/)[^)]*\)/gi, 'none');
  if (/javascript:/i.test(svg)) return { error: 'The drawing has code in it.' };
  const open = /^<svg\b[^>]*>/i.exec(svg)?.[0] ?? '';
  if (!/\sxmlns\s*=/.test(open)) svg = svg.replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  const vb = /\sviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/i.exec(open);
  const width = num(/\swidth\s*=\s*["']?([\d.]+)(px)?["'\s>]/i.exec(open)?.[1]) ?? num(vb?.[1]);
  const height = num(/\sheight\s*=\s*["']?([\d.]+)(px)?["'\s>]/i.exec(open)?.[1]) ?? num(vb?.[2]);
  if (!width || !height) return { error: 'The drawing has no size (give the <svg> a width and height, or a viewBox).' };
  return { svg, width: Math.round(width), height: Math.round(height) };
}
