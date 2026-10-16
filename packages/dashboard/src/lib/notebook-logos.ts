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
  fetchImage as coreFetchImage, siteIcons as coreSiteIcons, imageSize,
  type FetchedImage, type ImageShape, type Notebook, type NotebookField,
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

/** Width and height from an image's header (in core; kept here for the logo code and its tests). */
export { imageSize };

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

/**
 * The class a picture gets by kind: a drawing or a logo shows whole (a logo
 * on a light tile), a photo fills. A wide logo (a wordmark) is marked so it
 * fills its frame's width; a square one (an app icon) sits smaller.
 */
export function pictureClass(kind: string | undefined, shape?: ImageShape | string): string {
  return kind === 'illustration' ? 'is-drawn' : kind === 'logo' ? `is-drawn is-logo${shape === 'wide' ? ' is-wide' : ''}` : '';
}

/** What to say a picture is, when it isn't the option's own photo (a logo needs no word). */
export function pictureLabel(kind: string | undefined): string | undefined {
  return kind === 'illustration' ? 'illustration' : kind === 'representative' ? 'example photo' : undefined;
}
