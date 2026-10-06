/**
 * The brand theme (docs/brand.md): one stored theme for the whole dashboard —
 * colours for dark and light mode, fonts, corner radius, and the tile accent
 * colours — applied to every page, board and tile as CSS custom properties
 * (`/assets/theme.css`). It starts from a preset (sua's default, or Warm,
 * Minimal, Neon, Editorial) and overrides any token on top.
 *
 * Stored at <dataDir>/.sua/theme.json like the tool policy: every save is
 * checked against the version it was loaded at, and the previous file is
 * kept for Undo. Values are validated strictly (colours, font stacks, px), so
 * nothing in a theme can break out of a CSS declaration.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';

/** Colour tokens a theme can set (the `--color-<name>` variables from tokens.css). */
export const BRAND_COLOR_TOKENS = [
  'bg', 'surface', 'surface-raised', 'border', 'border-strong',
  'text', 'text-muted', 'text-subtle',
  'primary', 'primary-hover', 'primary-soft',
  'ok', 'ok-soft', 'warn', 'warn-soft', 'err', 'err-soft', 'info', 'info-soft',
] as const;
export type BrandColorToken = typeof BRAND_COLOR_TOKENS[number];

/** Tile accent colours (signal.accent; the coloured left edge) and accent palettes. */
export const BRAND_ACCENTS = ['teal', 'blue', 'green', 'orange', 'red', 'purple'] as const;
export const BRAND_PRESETS = ['default', 'warm', 'minimal', 'neon', 'editorial'] as const;
export type BrandPreset = typeof BRAND_PRESETS[number];

/** #rgb[a], #rrggbb[aa], rgb()/rgba()/hsl()/hsla() with plain numbers, or `transparent`. */
const COLOR_RE = /^(#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|(rgb|rgba|hsl|hsla)\(\s*[0-9.\s,%/deg]+\)|transparent)$/i;
const color = z.string().trim().max(64).regex(COLOR_RE, 'a colour: #rrggbb, rgb(…), rgba(…), hsl(…) or transparent');
// Letters and digits in any script ("Söhne", "Noto Sans JP"); nothing that could end a CSS value.
export const FONT_STACK_RE = /^[\p{L}\p{N} ,"'\-]+$/u;
const font = z.string().trim().min(1).max(200).regex(FONT_STACK_RE, 'a font stack: family names separated by commas');
const px = z.number().int().min(0).max(40);
const colors = z.object(Object.fromEntries(BRAND_COLOR_TOKENS.map((t) => [t, color.optional()]))).strict();

export const brandThemeSchema = z.object({
  version: z.literal(1),
  /** A short name for the theme ("Acme"). */
  name: z.string().trim().max(60).optional(),
  preset: z.enum(BRAND_PRESETS).default('default'),
  dark: colors.default({}),
  light: colors.default({}),
  fonts: z.object({ sans: font.optional(), mono: font.optional() }).strict().default({}),
  radius: z.object({ sm: px.optional(), md: px.optional(), lg: px.optional() }).strict().default({}),
  accents: z.object(Object.fromEntries(BRAND_ACCENTS.map((a) => [a, color.optional()]))).strict().default({}),
}).strict();
export type BrandTheme = z.infer<typeof brandThemeSchema>;

export const DEFAULT_BRAND_THEME: BrandTheme = brandThemeSchema.parse({ version: 1 });

/** sua's default accent colours (tokens.css). */
export const DEFAULT_ACCENTS: Record<typeof BRAND_ACCENTS[number], string> = {
  teal: '#2dd4bf', blue: '#60a5fa', green: '#4ade80', orange: '#fb923c', red: '#f87171', purple: '#a78bfa',
};

type Tokens = Partial<Record<BrandColorToken, string>>;
interface PresetDef { dark: Tokens; light: Tokens; fonts?: { sans?: string }; radius?: { sm?: number; md?: number; lg?: number } }

/** The presets (formerly the per-browser "widget themes"). Default changes nothing. */
export const BRAND_PRESET_DEFS: Record<BrandPreset, PresetDef> = {
  default: { dark: {}, light: {} },
  warm: {
    dark: {
      primary: '#f59e0b', 'primary-hover': '#d97706', 'primary-soft': 'rgba(245, 158, 11, 0.1)',
      bg: '#1c1917', surface: '#292524', 'surface-raised': '#44403c', border: '#57534e', 'border-strong': '#78716c',
      text: '#fafaf9', 'text-muted': '#d6d3d1', 'text-subtle': '#a8a29e',
    },
    light: { primary: '#b45309', 'primary-hover': '#92400e', 'primary-soft': '#fef3c7' },
    radius: { sm: 8, md: 16, lg: 20 },
  },
  minimal: {
    dark: { primary: '#a3a3a3', 'primary-hover': '#d4d4d4', 'primary-soft': 'rgba(163, 163, 163, 0.08)', border: 'transparent', 'border-strong': 'rgba(255, 255, 255, 0.06)' },
    light: { primary: '#525252', 'primary-hover': '#404040', 'primary-soft': '#f5f5f5', border: 'transparent', 'border-strong': 'rgba(0, 0, 0, 0.06)' },
    radius: { sm: 0, md: 0, lg: 0 },
  },
  neon: {
    dark: {
      primary: '#a855f7', 'primary-hover': '#c084fc', 'primary-soft': 'rgba(168, 85, 247, 0.12)',
      bg: '#0a0a0a', surface: '#171717', 'surface-raised': '#262626', border: '#333333', 'border-strong': '#444444',
      text: '#fafafa', 'text-muted': '#a3a3a3', 'text-subtle': '#737373',
      ok: '#22d3ee', 'ok-soft': 'rgba(34, 211, 238, 0.1)', err: '#fb7185', 'err-soft': 'rgba(251, 113, 133, 0.1)',
      warn: '#fbbf24', info: '#818cf8', 'info-soft': 'rgba(129, 140, 248, 0.1)',
    },
    light: { primary: '#7e22ce', 'primary-hover': '#6b21a8', 'primary-soft': '#f3e8ff' },
  },
  editorial: {
    // A paper look in both modes: the preset is light-based.
    dark: {
      bg: '#f4eede', surface: '#fffdf8', 'surface-raised': '#fbf5e8', border: '#e0d5c0', 'border-strong': '#cdbfa4',
      text: '#241f18', 'text-muted': '#6f6655', 'text-subtle': '#948a76',
      primary: '#2f6f6a', 'primary-hover': '#255a55', 'primary-soft': 'rgba(47, 111, 106, 0.12)',
      ok: '#4a7c59', 'ok-soft': 'rgba(74, 124, 89, 0.12)', warn: '#b07d26', 'warn-soft': 'rgba(193, 137, 45, 0.14)',
      err: '#a23b28', 'err-soft': 'rgba(162, 59, 40, 0.12)', info: '#40607a', 'info-soft': 'rgba(64, 96, 122, 0.12)',
    },
    light: {},
    fonts: { sans: '"Charter", "Iowan Old Style", Georgia, "Times New Roman", serif' },
    radius: { sm: 8, md: 12, lg: 16 },
  },
};
BRAND_PRESET_DEFS.editorial.light = BRAND_PRESET_DEFS.editorial.dark;

/** The theme's effective values: its preset with its own overrides on top. */
export function resolveBrandTheme(theme: BrandTheme) {
  const p = BRAND_PRESET_DEFS[theme.preset];
  return {
    dark: { ...p.dark, ...theme.dark } as Tokens,
    light: { ...p.light, ...theme.light } as Tokens,
    fonts: { ...(p.fonts ?? {}), ...theme.fonts },
    radius: { ...(p.radius ?? {}), ...theme.radius },
    accents: { ...DEFAULT_ACCENTS, ...theme.accents } as Record<typeof BRAND_ACCENTS[number], string>,
  };
}

/**
 * The theme as CSS: custom properties on :root (dark, the default) and
 * [data-theme="light"]. Only what the theme sets is written, so the
 * defaults in tokens.css stand for everything else.
 */
export function brandThemeCss(theme: BrandTheme): string {
  const r = resolveBrandTheme(theme);
  const decl = (vars: Array<[string, string | undefined]>) => vars.filter(([, v]) => v !== undefined).map(([k, v]) => `  ${k}: ${v};`).join('\n');
  const colorVars = (t: Tokens) => BRAND_COLOR_TOKENS.map((k) => [`--color-${k}`, t[k]] as [string, string | undefined]);
  const shared: Array<[string, string | undefined]> = [
    ['--font-sans', r.fonts.sans], ['--font-mono', r.fonts.mono],
    ['--radius-sm', r.radius.sm !== undefined ? `${r.radius.sm}px` : undefined],
    ['--radius-md', r.radius.md !== undefined ? `${r.radius.md}px` : undefined],
    ['--radius-lg', r.radius.lg !== undefined ? `${r.radius.lg}px` : undefined],
    ...BRAND_ACCENTS.map((a) => [`--accent-${a}`, r.accents[a]] as [string, string]),
  ];
  const dark = decl([...colorVars(r.dark), ...shared]);
  const light = decl(colorVars(r.light));
  return `/* Brand theme${theme.name ? `: ${theme.name}` : ''} (preset ${theme.preset}). Generated from .sua/theme.json — edit it in Settings → Appearance. */\n:root {\n${dark}\n}\n${light ? `[data-theme="light"] {\n${light}\n}\n` : ''}`;
}

/** A short brand guide for agents arranging boards or writing views: names to use, never raw colours. */
export function brandGuideText(theme: BrandTheme = DEFAULT_BRAND_THEME): string {
  return [
    `Brand${theme.name ? ` "${theme.name}"` : ''}: style through names, never colours.`,
    '- Tones (Metric, Badge): neutral, ok, warn, err.',
    '- Tile palettes (board tiles): default, dark, light, accent-teal, accent-red, accent-green.',
    `- Tile accents (a coloured edge): ${BRAND_ACCENTS.join(', ')}.`,
    '- Don\'t put colours, fonts or inline styles in agent-written HTML; the dashboard\'s theme styles everything.',
  ].join('\n');
}

// ── Storage ──────────────────────────────────────────────────────────────

export class BrandThemeError extends Error {
  constructor(message: string) { super(message); this.name = 'BrandThemeError'; }
}

export function brandThemePath(dataDir: string): string {
  return join(dataDir, '.sua', 'theme.json');
}

/** The file's version (a short hash; '' when there's no file). Saves must quote the version they loaded. */
export function brandThemeVersion(dataDir: string): string {
  try { return createHash('sha256').update(readFileSync(brandThemePath(dataDir), 'utf-8')).digest('hex').slice(0, 16); } catch { return ''; }
}

/** The stored theme, or the default when there's none or it can't be read (the dashboard must never fail to style). */
export function loadBrandTheme(dataDir: string): BrandTheme {
  let raw: string;
  try { raw = readFileSync(brandThemePath(dataDir), 'utf-8'); } catch { return DEFAULT_BRAND_THEME; }
  try {
    const parsed = brandThemeSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_BRAND_THEME;
  } catch { return DEFAULT_BRAND_THEME; }
}

function writeChecked(dataDir: string, text: string, expectedVersion?: string): void {
  const path = brandThemePath(dataDir);
  if (expectedVersion !== undefined && expectedVersion !== brandThemeVersion(dataDir)) {
    throw new BrandThemeError('The theme changed since you opened it. Reload to see the current theme, then make your change again.');
  }
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) copyFileSync(path, `${path}.bak`);
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, path);
}

/** Validate and save a theme. Throws BrandThemeError with the problems; nothing is written then. */
export function saveBrandTheme(dataDir: string, input: unknown, opts: { expectedVersion?: string } = {}): { version: string; theme: BrandTheme } {
  const parsed = brandThemeSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 4).map((i) => `${i.path.join('.') || '(theme)'}: ${i.message}`).join('; ');
    throw new BrandThemeError(`Not saved: ${issues}`);
  }
  writeChecked(dataDir, `${JSON.stringify(parsed.data, null, 2)}\n`, opts.expectedVersion);
  return { version: brandThemeVersion(dataDir), theme: parsed.data };
}

/** Put the theme from before the last save back (Undo twice = Redo). */
export function restoreBrandThemeBackup(dataDir: string, opts: { expectedVersion?: string } = {}): { version: string } {
  const backup = `${brandThemePath(dataDir)}.bak`;
  if (!existsSync(backup)) throw new BrandThemeError('There is no earlier theme to go back to.');
  writeChecked(dataDir, readFileSync(backup, 'utf-8'), opts.expectedVersion);
  return { version: brandThemeVersion(dataDir) };
}

// ── Saved brands: named themes you can keep, switch between and delete ──
// Each is a theme file in `.sua/brands/<id>.json`, checked like the active one.

export interface SavedBrand { id: string; name: string; theme: BrandTheme; savedAt: string }

export function brandsDir(dataDir: string): string {
  return join(dataDir, '.sua', 'brands');
}

/** "Acme Corp!" → "acme-corp". */
export function brandId(name: string): string {
  return name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'brand';
}

/** Saved brands, A–Z. Files that don't validate are skipped. */
export function listSavedBrands(dataDir: string): SavedBrand[] {
  let files: string[];
  try { files = readdirSync(brandsDir(dataDir)).filter((f) => /^[a-z0-9-]+\.json$/.test(f)); } catch { return []; }
  const out: SavedBrand[] = [];
  for (const f of files) {
    try {
      const path = join(brandsDir(dataDir), f);
      const parsed = brandThemeSchema.safeParse(JSON.parse(readFileSync(path, 'utf-8')));
      if (!parsed.success) continue;
      const id = f.replace(/\.json$/, '');
      out.push({ id, name: parsed.data.name ?? id, theme: parsed.data, savedAt: statSync(path).mtime.toISOString() });
    } catch { /* unreadable: skip */ }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Save a theme as a named brand (replacing one with the same name). */
export function saveBrandAs(dataDir: string, name: string, theme: unknown): SavedBrand {
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!clean) throw new BrandThemeError('Give the brand a name.');
  const parsed = brandThemeSchema.safeParse({ ...(theme as object), name: clean });
  if (!parsed.success) {
    throw new BrandThemeError(`Not saved: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || '(theme)'}: ${i.message}`).join('; ')}`);
  }
  const id = brandId(clean);
  mkdirSync(brandsDir(dataDir), { recursive: true });
  const path = join(brandsDir(dataDir), `${id}.json`);
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(parsed.data, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
  return { id, name: clean, theme: parsed.data, savedAt: new Date().toISOString() };
}

/** Make a saved brand the dashboard's theme (the previous one stays one Undo away). */
export function applySavedBrand(dataDir: string, id: string, opts: { expectedVersion?: string } = {}): { version: string; theme: BrandTheme } {
  const brand = listSavedBrands(dataDir).find((b) => b.id === id);
  if (!brand) throw new BrandThemeError('That brand is gone.');
  return saveBrandTheme(dataDir, brand.theme, opts);
}

export function deleteSavedBrand(dataDir: string, id: string): boolean {
  if (!/^[a-z0-9-]+$/.test(id)) return false;
  try { unlinkSync(join(brandsDir(dataDir), `${id}.json`)); return true; } catch { return false; }
}

/** Is this saved brand the one in use (same colours, fonts, radius and accents)? */
export function isActiveBrand(active: BrandTheme, brand: BrandTheme): boolean {
  const strip = (t: BrandTheme) => JSON.stringify({ ...t, name: undefined });
  return strip(active) === strip(brand);
}

// ── Contrast: is a theme readable? (WCAG 2 relative luminance) ──

/** sua's own token values (tokens.css), for colours a theme leaves unset. */
const BASE_TOKENS: Record<'dark' | 'light', Partial<Record<BrandColorToken, string>>> = {
  dark: { bg: '#1a1918', surface: '#242220', text: '#e7e5e4', 'text-muted': '#a8a29e', primary: '#2dd4bf' },
  light: { bg: '#faf9f7', surface: '#ffffff', text: '#1c1917', 'text-muted': '#78716c', primary: '#0f766e' },
};

/** A colour as [r, g, b] in 0–255, or undefined for ones we can't read (transparent, odd forms). */
export function parseColor(c: string): [number, number, number] | undefined {
  const s = c.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map((x) => x + x).join('');
    if (h.length === 8) h = h.slice(0, 6);
    if (h.length !== 6) return undefined;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(s);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  m = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/.exec(s);
  if (m) {
    const h = Number(m[1]) / 360; const sat = Number(m[2]) / 100; const l = Number(m[3]) / 100;
    const f = (n: number) => { const k = (n + h * 12) % 12; const a = sat * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    return [f(0) * 255, f(8) * 255, f(4) * 255];
  }
  return undefined;
}

function luminance([r, g, b]: [number, number, number]): number {
  const ch = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

/** WCAG contrast ratio between two colours (1–21), or undefined when either can't be read. */
export function contrastRatio(a: string, b: string): number | undefined {
  const x = parseColor(a); const y = parseColor(b);
  if (!x || !y) return undefined;
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Where a theme is hard to read: text on the page and on cards (needs 4.5:1),
 * muted text and the accent on the page (3:1), in both modes.
 */
export function brandContrastIssues(theme: BrandTheme): string[] {
  const r = resolveBrandTheme(theme);
  const out: string[] = [];
  for (const mode of ['dark', 'light'] as const) {
    const t = { ...BASE_TOKENS[mode], ...(r[mode] as Partial<Record<BrandColorToken, string>>) };
    const check = (fg: BrandColorToken, bg: BrandColorToken, min: number, what: string) => {
      const ratio = contrastRatio(t[fg] ?? '', t[bg] ?? '');
      if (ratio !== undefined && ratio < min) out.push(`${mode === 'dark' ? 'Dark' : 'Light'} mode: ${what} is hard to read (${ratio.toFixed(1)}:1, needs ${String(min)}:1).`);
    };
    check('text', 'bg', 4.5, 'text on the page');
    check('text', 'surface', 4.5, 'text on cards');
    check('text-muted', 'surface', 3, 'muted text');
    check('primary', 'bg', 3, 'the accent on the page');
  }
  return out;
}
