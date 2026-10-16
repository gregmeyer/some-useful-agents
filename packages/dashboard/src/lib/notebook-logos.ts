/**
 * Company logos (notebooks): in a notebook of jobs or companies, an option's
 * picture is the company's logo, from the company's own site: its
 * apple-touch-icon (a square mark), else a larger icon it lists, else a
 * 128px favicon from Google's favicon service. The site comes from the
 * option's facts (a website field, or a link that isn't a job board), else
 * the picture agent names it. Every fetch goes through core's guarded
 * fetchers; a logo too small to read (a 16px favicon) isn't kept.
 */
import {
  fetchImage as coreFetchImage, siteIcons as coreSiteIcons,
  type FetchedImage, type Notebook, type NotebookField,
} from '@some-useful-agents/core';
import { illustrationKind } from './notebook-illustrations.js';

export interface LogoDeps {
  fetchImage: (url: string) => Promise<Pick<FetchedImage, 'bytes' | 'contentType'>>;
  siteIcons: (url: string) => Promise<string[]>;
}

export const defaultLogoDeps: LogoDeps = { fetchImage: (u) => coreFetchImage(u, { maxBytes: 512 * 1024 }), siteIcons: (u) => coreSiteIcons(u) };

/** Smaller than this (px) is a favicon, not a logo. */
const MIN_LOGO_PX = 48;

/** Sites that list other companies' jobs or pages: their logo isn't the company's. */
const NOT_THE_COMPANY = /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|myworkdaysite\.com|workday\.com|smartrecruiters\.com|jobvite\.com|icims\.com|bamboohr\.com|workable\.com|recruitee\.com|breezy\.hr|rippling\.com|paylocity\.com|adp\.com|ultipro\.com|dayforcehcm\.com|taleo\.net|successfactors\.com|linkedin\.com|indeed\.com|glassdoor\.com|ziprecruiter\.com|flexjobs\.com|jobgether\.com|builtin\.com|builtin[a-z]+\.com|wellfound\.com|angel\.co|monster\.com|simplyhired\.com|dice\.com|roberthalf\.com|ycombinator\.com|otta\.com|welcometothejungle\.com|remoteok\.com|remote\.co|weworkremotely\.com|google\.com|bing\.com|duckduckgo\.com|wikipedia\.org|wikimedia\.org|crunchbase\.com|zoominfo\.com|apollo\.io)$/i;

/** Whether a notebook's options are jobs or companies (so a logo is the right picture). */
export function wantsLogos(nb: Pick<Notebook, 'title' | 'statement' | 'fields'>): boolean {
  return nb.fields.some((f) => f.role === 'org') && illustrationKind(nb, '') === 'job';
}

/** A bare host ("toasttab.com") from an address or a domain, when it's a company's own. */
export function companyHost(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  if (!v || /\s/.test(v)) return undefined;
  let host: string;
  try { host = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`).hostname.toLowerCase(); } catch { return undefined; }
  host = host.replace(/^www\./, '');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) || NOT_THE_COMPANY.test(host)) return undefined;
  // A careers subdomain is still the company ("careers.toasttab.com" → toasttab.com).
  return host.replace(/^(careers|jobs|join|work|apply)\./, '');
}

/** The company's own site from an option's facts: a website field, else its link when that's the company's. */
export function companySite(fields: readonly NotebookField[], data: Record<string, unknown> | undefined): string | undefined {
  if (!data) return undefined;
  const site = fields.find((f) => /^(website|site|domain|homepage|home_page|company_url|company_website|url)$/i.test(f.key) && f.role !== 'link');
  return companyHost(site ? data[site.key] : undefined)
    ?? companyHost(fields.filter((f) => f.role === 'link' || f.type === 'url').map((f) => data[f.key]).find((v) => typeof v === 'string'));
}

/** Width and height of a PNG, GIF, JPEG or WebP, when its header says. */
export function imageSize(b: Uint8Array): { width: number; height: number } | undefined {
  const u16be = (i: number) => (b[i] << 8) | b[i + 1];
  const u32be = (i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50) return { width: u32be(16), height: u32be(20) };
  if (b.length >= 10 && b[0] === 0x47 && b[1] === 0x49) return { width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8) };
  if (b.length >= 30 && b[0] === 0x52 && b[8] === 0x57) {
    const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (chunk === 'VP8X') return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    if (chunk === 'VP8 ') return { width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff };
    if (chunk === 'VP8L') return { width: 1 + (((b[22] & 0x3f) << 8) | b[21]), height: 1 + (((b[24] & 0xf) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)) };
    return undefined;
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: u16be(i + 7), height: u16be(i + 5) };
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      i += 2 + u16be(i + 2);
    }
  }
  return undefined;
}

/**
 * The company's logo from its site: its own icons, best first, then a 128px
 * favicon. Undefined when nothing big enough to read was found.
 */
export async function findLogo(host: string, deps: LogoDeps = defaultLogoDeps): Promise<{ url: string; bytes: Uint8Array; contentType: string } | undefined> {
  let icons: string[] = [];
  try { icons = await deps.siteIcons(`https://${host}/`); } catch { icons = []; }
  const tries = [...icons, `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`];
  for (const url of tries) {
    try {
      const img = await deps.fetchImage(url);
      const size = imageSize(img.bytes);
      if (size && Math.min(size.width, size.height) < MIN_LOGO_PX) continue;
      return { url, bytes: img.bytes, contentType: img.contentType };
    } catch { /* the next */ }
  }
  return undefined;
}

/** The class a picture gets by kind: a drawing or a logo shows whole (a logo on a light tile), a photo fills. */
export function pictureClass(kind: string | undefined): string {
  return kind === 'illustration' ? 'is-drawn' : kind === 'logo' ? 'is-drawn is-logo' : '';
}

/** What to say a picture is, when it isn't the option's own photo (a logo needs no word). */
export function pictureLabel(kind: string | undefined): string | undefined {
  return kind === 'illustration' ? 'illustration' : kind === 'representative' ? 'example photo' : undefined;
}
