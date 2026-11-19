/**
 * Where a source an answer rests on comes from (ADR-0081): who publishes it,
 * what kind of source it is, and whether it's one of the notebook's
 * subjects speaking about itself. An answer's confidence should rest on how
 * independent its sources are, not on how many pages repeat a claim (SIFT:
 * investigate the source), so every page filed as evidence carries this.
 * Pure: no store, no network.
 */

/** primary: the thing itself (its spec, official docs or repo, a standards body); vendor: a company selling something about it; independent: third-party analysis, press, research; community: forums, posts, personal blogs. */
export const SOURCE_KINDS = ['primary', 'vendor', 'independent', 'community'] as const;
export type SourceKind = typeof SOURCE_KINDS[number];

export interface NotebookSourceOrigin {
  /** Who publishes the page ("CopilotKit", "Google", "github.com/ag-ui-protocol"). */
  publisher: string;
  kind?: SourceKind;
  /** The notebook subject whose own page it is (A2UI's site, CopilotKit's docs); absent when it's from outside them. */
  whose?: string;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const CODE_HOSTS = new Set(['github.com', 'gitlab.com', 'bitbucket.org', 'codeberg.org']);

/**
 * What a notebook asks about, by name, for telling a subject's own pages
 * from outside ones: the subject of a briefing, else the names in its title
 * and what it's for that look like names (A2UI, AG-UI, CopilotKit, iPhone:
 * a capital after the first letter, a digit or a hyphen). Ordinary words
 * ("Understand", "Help") aren't names.
 */
export function answerSubjects(nb: { title?: string; statement?: string; briefOn?: { name: string } }): string[] {
  const out = new Map<string, string>();
  if (nb.briefOn?.name) out.set(norm(nb.briefOn.name), nb.briefOn.name.trim());
  for (const t of `${nb.title ?? ''} ${nb.statement ?? ''}`.match(/[A-Za-z][A-Za-z0-9.+-]*[A-Za-z0-9+]/g) ?? []) {
    const name = t.replace(/[.]+$/, '');
    if (!/[A-Z]/.test(name.slice(1)) && !/\d/.test(name) && !/-/.test(name)) continue;
    if (norm(name).length < 3) continue;
    if (!out.has(norm(name))) out.set(norm(name), name);
  }
  return [...out.values()].slice(0, 8);
}

/** The site a page is on, without www ("docs.copilotkit.ai"). */
function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

/**
 * Who publishes a page, from its address alone: a code host's owner
 * ("github.com/ag-ui-protocol"), else the site's own domain without its
 * subdomains ("docs.copilotkit.ai" → "copilotkit.ai"; "a.b.co.uk" → "b.co.uk").
 */
export function publisherOf(url: string): string {
  const host = hostOf(url);
  if (!host) return 'unknown';
  if (CODE_HOSTS.has(host)) {
    try { const owner = new URL(url).pathname.split('/').filter(Boolean)[0]; if (owner) return `${host}/${owner.toLowerCase()}`; } catch { /* the host alone */ }
    return host;
  }
  const parts = host.split('.');
  // A two-letter country domain under a short second level (co.uk, com.au) keeps three parts.
  const keep = parts.length >= 3 && parts[parts.length - 1].length === 2 && parts[parts.length - 2].length <= 3 ? 3 : 2;
  return parts.slice(-keep).join('.');
}

/** The subject a page's own site or repo is named for (copilotkit.ai → CopilotKit, github.com/ag-ui-protocol → AG-UI). Its path elsewhere doesn't count: a vendor's page about another subject isn't that subject's. */
function subjectFromAddress(url: string, subjects: readonly string[]): string | undefined {
  const host = hostOf(url);
  if (!host) return undefined;
  let where = host;
  if (CODE_HOSTS.has(host)) {
    try { where = new URL(url).pathname.split('/').filter(Boolean)[0] ?? ''; } catch { where = ''; }
  }
  const at = norm(where);
  // The longest name first, so "AG-UI Protocol" wins over "AG-UI" when both are asked about.
  return [...subjects].sort((a, b) => norm(b).length - norm(a).length).find((s) => norm(s).length >= 3 && at.includes(norm(s)));
}

/**
 * A page's origin: what the agent that found it said (publisher, kind, whose
 * own page it is), checked and filled in from the address. An agent's
 * "whose" counts only when it names one of the subjects (or says it's no
 * one's: "none", "independent"); a page whose site is named for a subject is
 * that subject's whatever the agent said. A subject's own page with no kind
 * said is primary (it speaks for itself).
 */
export function sourceOrigin(url: string, subjects: readonly string[], said?: { publisher?: unknown; kind?: unknown; whose?: unknown }): NotebookSourceOrigin {
  const byAddress = subjectFromAddress(url, subjects);
  const saidWhose = typeof said?.whose === 'string' ? said.whose.trim() : '';
  const named = saidWhose ? subjects.find((s) => norm(s) === norm(saidWhose)) : undefined;
  const whose = byAddress ?? named;
  const kind = typeof said?.kind === 'string' && (SOURCE_KINDS as readonly string[]).includes(said.kind.trim().toLowerCase())
    ? said.kind.trim().toLowerCase() as SourceKind
    : whose ? 'primary' : undefined;
  const saidPublisher = typeof said?.publisher === 'string' ? said.publisher.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
  return { publisher: saidPublisher || byAddress || publisherOf(url), ...(kind ? { kind } : {}), ...(whose ? { whose } : {}) };
}

/** A stored origin, read back (undefined when it isn't one). */
export function parseSourceOrigin(v: unknown): NotebookSourceOrigin | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  if (typeof o.publisher !== 'string' || !o.publisher.trim()) return undefined;
  return {
    publisher: o.publisher.trim().slice(0, 60),
    ...(typeof o.kind === 'string' && (SOURCE_KINDS as readonly string[]).includes(o.kind) ? { kind: o.kind as SourceKind } : {}),
    ...(typeof o.whose === 'string' && o.whose.trim() ? { whose: o.whose.trim().slice(0, 60) } : {}),
  };
}

/** An evidence entry's origin: the one it was filed with, else read from its page's address (entries filed before origins were kept). Undefined without a page. */
export function evidenceOrigin(e: { origin?: NotebookSourceOrigin; fingerprint?: string }, subjects: readonly string[]): NotebookSourceOrigin | undefined {
  if (e.origin) return e.origin;
  return e.fingerprint && /^https?:\/\//i.test(e.fingerprint) ? sourceOrigin(e.fingerprint, subjects) : undefined;
}

/** How a set of sources spreads: how many pages, from how many publishers, how many are a subject's own and how many from outside (outside publishers counted once each). */
export interface SourceSpread {
  pages: number;
  publishers: number;
  /** Pages that are one of the subjects' own. */
  own: number;
  /** Publishers outside every subject (each counted once, however many pages). */
  outside: number;
  /** Pages per publisher, most first (then by name). */
  byPublisher: Array<{ publisher: string; pages: number; whose?: string; kind?: SourceKind }>;
}

export function sourceSpread(origins: readonly NotebookSourceOrigin[]): SourceSpread {
  const by = new Map<string, { publisher: string; pages: number; whose?: string; kind?: SourceKind }>();
  for (const o of origins) {
    const k = norm(o.publisher) || o.publisher;
    const had = by.get(k);
    if (had) had.pages++;
    else by.set(k, { publisher: o.publisher, pages: 1, ...(o.whose ? { whose: o.whose } : {}), ...(o.kind ? { kind: o.kind } : {}) });
  }
  const byPublisher = [...by.values()].sort((a, b) => b.pages - a.pages || a.publisher.localeCompare(b.publisher));
  return {
    pages: origins.length, publishers: byPublisher.length,
    own: origins.filter((o) => o.whose).length,
    outside: byPublisher.filter((p) => !p.whose).length,
    byPublisher,
  };
}

/**
 * What to weigh about an answer's sources, in a sentence, or undefined when
 * they're independent enough (2+ outside publishers). SIFT: agreement among
 * the subjects' own pages isn't corroboration.
 */
export function sourceSpreadCaution(spread: SourceSpread): string | undefined {
  if (!spread.pages || spread.outside >= 2) return undefined;
  const own = spread.byPublisher.filter((p) => p.whose).map((p) => `${p.publisher} ${String(p.pages)}`).join(', ');
  const pages = `${String(spread.pages)} source${spread.pages === 1 ? '' : 's'}`;
  if (spread.outside === 0) return `All ${pages} it rests on are the subjects' own pages (${own}); none from outside them confirms what they say.`;
  return `Only one of its ${String(spread.publishers)} publishers is from outside the subjects (${spread.byPublisher.find((p) => !p.whose)!.publisher}); the rest are their own pages (${own}).`;
}
