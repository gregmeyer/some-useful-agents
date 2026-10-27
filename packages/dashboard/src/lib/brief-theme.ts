/**
 * A notebook brief in the dashboard's look: the design tokens (tokens.css)
 * and the brand theme (Settings → Appearance), carried inside the file so a
 * saved brief keeps them, in the mode you use the dashboard in (dark unless
 * you switched it to light). Printed, it's on paper: the theme's light
 * colours, whatever the mode.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brandThemeCss, resolveBrandTheme, BRAND_COLOR_TOKENS, DEFAULT_BRAND_THEME, type BrandTheme } from '@some-useful-agents/core';

export type BriefMode = 'dark' | 'light';

export interface BriefTheme {
  /** The CSS that gives the brief its colours and fonts (goes first in its <style>). */
  css: string;
  /** The mode it opens in: light, else dark (the dashboard's default). */
  mode?: BriefMode;
}

let tokensCss: string | undefined;
/** tokens.css, as the dashboard serves it (dist assets, else the source). */
function tokens(): string {
  if (tokensCss !== undefined) return tokensCss;
  const here = dirname(fileURLToPath(import.meta.url));
  for (const dir of [join(here, '..', 'assets'), join(here, '..', '..', 'src', 'assets')]) {
    const p = join(dir, 'tokens.css');
    if (existsSync(p)) return (tokensCss = readFileSync(p, 'utf-8'));
  }
  return (tokensCss = '');
}

/** The --color-* values a block of tokens.css sets (":root" or "[data-theme=\"light\"]"). Pure. */
export function tokenBlock(css: string, selector: string): Record<string, string> {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) return {};
  const body = css.slice(at, css.indexOf('}', at));
  return Object.fromEntries([...body.matchAll(/--color-([a-z-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

/** The brief's own names for the dashboard's tokens. */
const MAP = `:root {
  --bg: var(--color-bg); --surface: var(--color-surface); --raised: var(--color-surface-raised);
  --line: var(--color-border); --line-strong: var(--color-border-strong);
  --text: var(--color-text); --muted: var(--color-text-muted); --subtle: var(--color-text-subtle);
  --accent: var(--color-primary); --accent-soft: var(--color-primary-soft); --ok: var(--color-ok);
  --sans: var(--font-sans); --mono: var(--font-mono); --display: var(--font-display);
  color-scheme: dark;
}
[data-theme="light"] { color-scheme: light; }`;

/** The brief's theme: tokens, then the brand theme, then the brief's names for them, and paper colours for print. */
export function briefTheme(theme: BrandTheme = DEFAULT_BRAND_THEME, mode?: BriefMode): BriefTheme {
  const base = tokens();
  // Printed: the theme's light colours (tokens' light, then the brand's), set as values (a print can't switch modes).
  const light = { ...tokenBlock(base, ':root'), ...tokenBlock(base, '[data-theme="light"]'), ...resolveBrandTheme(theme).light } as Record<string, string | undefined>;
  const paper = BRAND_COLOR_TOKENS.filter((k) => light[k]).map((k) => `--color-${k}: ${light[k]!};`).join(' ');
  return {
    css: `${base}\n${brandThemeCss(theme)}\n${MAP}\n@media print { :root, :root[data-theme="light"] { ${paper} color-scheme: light; } }`,
    ...(mode ? { mode } : {}),
  };
}
