/**
 * Is this a picture of them? A person's photo is kept only when the page it's
 * on is about that person and the picture is theirs on it: the page names
 * them in its title or heading, its address or kind says it's about them
 * (an author, speaker, guest, team or about page, their own site), and the
 * image is the page's preview picture or one captioned with their name.
 * Logos, icons and banners are never a person's photo. No face is compared:
 * it's where the picture comes from, said on the page, that a person can
 * check (lib/notebook-profile.ts shows the page and a "Not them").
 */
import { httpFetch } from './web-fetch/fetch.js';

/** Lowercase, accents and punctuation off, spaces collapsed. */
function fold(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** Words in an address that say a page is about one person. */
const ABOUT_PATH = /(^|\/)(about|about-me|author|authors|speaker|speakers|team|people|person|profile|profiles|bio|guest|guests|host|hosts|contributor|contributors|members?|staff|founders?)(\/|$|-|\.)/i;
/** Images that are a site's, not a person's. */
const NOT_A_PERSON = /(logo|icon|favicon|sprite|banner|placeholder|default[-_]?(og|share|image)|og[-_]?default|share[-_]?image|cover[-_]?image|wordmark)/i;

export interface PersonPhotoFound {
  /** The picture's address. */
  image: string;
  /** The page it's on (the one that's about them). */
  page: string;
  /** Why it's taken to be them, in a few words. */
  why: string;
}

/**
 * Find a picture of `name` on one page's HTML, or say why there isn't one.
 * Pure: the caller fetches the page. `want`, when given, is a picture the
 * research named: it must be the one on this page.
 */
export function personPhotoOnPage(html: string, pageUrl: string, name: string, want?: string): PersonPhotoFound | { why: string } {
  const full = fold(name);
  const parts = full.split(' ').filter((w) => w.length > 1);
  if (parts.length < 2) return { why: 'needs a first and last name to check' };
  const first = parts[0];
  const last = parts[parts.length - 1];
  const named = (s: string | undefined) => { const f = fold(decode(s ?? '')); return f.includes(full) || (f.includes(first) && f.includes(last)); };
  const meta = (key: string) => {
    const tag = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, 'i').exec(html)?.[0];
    return tag ? /content=["']([^"']+)["']/i.exec(tag)?.[1] : undefined;
  };
  const title = meta('og:title') ?? /<title[^>]*>([^<]{1,300})<\/title>/i.exec(html)?.[1];
  const h1 = /<h1[^>]*>([\s\S]{1,300}?)<\/h1>/i.exec(html)?.[1]?.replace(/<[^>]+>/g, ' ');
  if (!named(title) && !named(h1)) return { why: "the page's title doesn't name them" };
  let url: URL;
  try { url = new URL(pageUrl); } catch { return { why: 'not a web page' }; }
  const path = fold(url.pathname).replace(/ /g, '-');
  const slug = parts.join('-');
  const aboutThem = path.includes(slug) || path.includes(`${first}${last}`)
    || fold(url.hostname).replace(/ /g, '').includes(last) || ABOUT_PATH.test(url.pathname)
    // A title that is their name, give or take the site's ("Dana Reyes | Speakers"), not one that merely starts with it ("Dana Reyes and Sam Lee on ops").
    || decode(title ?? '').split(/\s[|–—:·-]\s|\s\|\s?/).some((part) => fold(part) === full) || fold(h1 ?? '') === full;
  if (!aboutThem) return { why: "the page names them but isn't about them" };
  const abs = (src: string) => { try { return new URL(decode(src), url).toString(); } catch { return undefined; } };
  const same = (a: string, b: string) => a.split(/[?#]/)[0] === b.split(/[?#]/)[0];
  // An image captioned with their name.
  const captioned: string[] = [];
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const src = /\bsrc=["']([^"']+)["']/i.exec(tag)?.[1];
    const alt = /\balt=["']([^"']*)["']/i.exec(tag)?.[1];
    const u = src ? abs(src) : undefined;
    if (u && /^https?:/i.test(u) && named(alt) && !NOT_A_PERSON.test(u) && !NOT_A_PERSON.test(alt ?? '')) captioned.push(u);
  }
  const og = meta('og:image') ?? meta('og:image:url') ?? meta('twitter:image');
  const preview = og ? abs(og) : undefined;
  const ok = (u: string | undefined) => !!u && /^https?:/i.test(u) && !NOT_A_PERSON.test(u);
  if (want) {
    const w = abs(want);
    if (!w || NOT_A_PERSON.test(w)) return { why: 'the picture looks like a logo or icon' };
    if (captioned.some((c) => same(c, w))) return { image: w, page: url.toString(), why: 'captioned with their name on a page about them' };
    if (preview && same(preview, w)) return { image: w, page: url.toString(), why: 'the picture of a page about them' };
    return { why: "the picture isn't one of them on that page" };
  }
  if (captioned[0]) return { image: captioned[0], page: url.toString(), why: 'captioned with their name on a page about them' };
  if (ok(preview)) return { image: preview!, page: url.toString(), why: 'the picture of a page about them' };
  return { why: 'no picture of them on the page' };
}

/** Fetch a page and look for their picture on it (never throws). */
export async function findPersonPhoto(pageUrl: string, name: string, want?: string): Promise<PersonPhotoFound | { why: string }> {
  try {
    const page = await httpFetch(pageUrl, { timeoutSec: 15, maxBytes: 768 * 1024 });
    return personPhotoOnPage(page.html, page.finalUrl, name, want);
  } catch (err) {
    return { why: err instanceof Error ? `couldn't read the page (${err.message.slice(0, 60)})` : "couldn't read the page" };
  }
}
