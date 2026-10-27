/**
 * A profile step: learn about who a notebook is about (a person, their
 * company), not its options. sua's researcher (`research-one`) looks the
 * person up once, then their company if it found one; a company alone is
 * looked up as a company. What it finds is kept with the notebook, each fact
 * with its source (NotebookStore.setAbout), plus a copy of their picture: the
 * person's photo when the research found a direct image of them, the
 * company's logo from its own site. Those feed ProfileCard and FactSheet
 * (`/notebook/person`, `/notebook/company`, `/notebook/facts`) and the cover.
 */
import { NotebookStore, cleanCompetitors, fetchImage, notebookGivenLinks, findPersonPhoto, imageSize, type Notebook, type NotebookAboutWho, type NotebookStep, type PersonPhotoFound } from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { runDispatchedAgentToTerminal } from '../routes/inbox-engine.js';
import { defaultLogoDeps, findLogo } from './notebook-logos.js';
import { NOTEBOOK_RESEARCHER_ID } from './notebook-step-agents.js';

type Ctx = ReturnType<typeof getContext>;

const RESEARCH_ONE_ID = NOTEBOOK_RESEARCHER_ID;

interface Ask { key: string; label: string; hint?: string }

/** What's looked up about a person. `kind` and `photo_url` steer the step and aren't kept as facts. */
export const PERSON_ASK: readonly Ask[] = [
  { key: 'kind', label: 'Person or company', hint: '"person" if this is a person, "company" if it is an organization' },
  { key: 'role', label: 'Role', hint: 'their current title' },
  { key: 'organization', label: 'Company', hint: 'where they work now (its name only)' },
  { key: 'company_website', label: 'Company website', hint: "the company's own site, https://…" },
  { key: 'location', label: 'Based in', hint: 'city and country' },
  { key: 'background', label: 'Background', hint: 'one sentence: their career so far' },
  { key: 'known_for', label: 'Known for', hint: 'one sentence: what they write, talk or post about' },
  { key: 'website', label: 'Their site', hint: 'their own site or newsletter, https://…' },
  { key: 'linkedin', label: 'LinkedIn', hint: 'their LinkedIn profile address' },
  { key: 'photo_url', label: 'Photo', hint: 'a direct image address (.jpg, .png or .webp) of a photo of them alone, from a page about them (their own site, an author, speaker or guest page; not LinkedIn); its source is that page, which must name them' },
];

/** What's looked up about a company. */
export const COMPANY_ASK: readonly Ask[] = [
  { key: 'what_they_do', label: 'What they do', hint: 'one sentence' },
  { key: 'website', label: 'Website', hint: 'its own site, https://…' },
  { key: 'industry', label: 'Industry', hint: 'the market it is in, a few words ("accounting software")' },
  { key: 'business_model', label: 'Business model', hint: 'how it makes money and from whom, one sentence' },
  { key: 'competitors', label: 'Competitors', hint: 'up to 5 companies a page names as its competitors or alternatives (a comparison, an alternatives list, an analyst or review page), as a list: [{"name": "…", "website": "https://…", "how": "how it competes, one line", "source": "the page that names it"}]' },
  { key: 'size', label: 'Size', hint: 'employees, roughly' },
  { key: 'revenue', label: 'Revenue', hint: 'annual revenue with its year, or an estimate said as one' },
  { key: 'stage', label: 'Stage', hint: 'funding stage and latest round, or public' },
  { key: 'founded', label: 'Founded', hint: 'year' },
  { key: 'headquarters', label: 'Headquarters', hint: 'city and country' },
  { key: 'recent_news', label: 'Recent news', hint: 'one recent item, with its date' },
];

/** Keys that steer the step, not facts to show. */
// competitors are a list of their own (the company's competitors), not a fact.
const NOT_FACTS = new Set(['kind', 'photo_url', 'competitors']);

interface Found { found: Record<string, { value?: unknown; source?: unknown; quote?: unknown }>; notFound: string[]; summary?: string }

/** research-one's printed JSON: what it found by key, what it didn't, a summary. Pure. */
export function readResearch(raw: string | undefined): Found | undefined {
  if (!raw) return undefined;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    const v = JSON.parse(raw.slice(start, end + 1)) as { found?: unknown; not_found?: unknown; summary?: unknown };
    const found = v.found && typeof v.found === 'object' && !Array.isArray(v.found) ? v.found as Found['found'] : {};
    const notFound = Array.isArray(v.not_found) ? v.not_found.filter((x): x is string => typeof x === 'string') : [];
    return { found, notFound, ...(typeof v.summary === 'string' && v.summary.trim() ? { summary: v.summary.trim() } : {}) };
  } catch {
    return undefined;
  }
}

const text = (f: Found, key: string): string => {
  const v = f.found[key]?.value;
  if (typeof v === 'string' || typeof v === 'number') return String(v).trim();
  // A range ({"min": 2, "max": 10}, as research-one gives numbers): "2–10".
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const { min, max } = v as { min?: unknown; max?: unknown };
    const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? (Math.abs(x) >= 10000 ? x.toLocaleString('en-US') : String(x)) : ''); // a year stays 2019
    return n(min) && n(max) ? (min === max ? n(min) : `${n(min)}–${n(max)}`) : n(min) ? `${n(min)}+` : n(max) ? `up to ${n(max)}` : '';
  }
  return '';
};

/** Found facts as the notebook keeps them (labelled, sourced), and what wasn't found by label. Pure. */
export function aboutFrom(f: Found, ask: readonly Ask[]): { facts: Array<{ key: string; label: string; value: string; source?: string; quote?: string }>; notFound: string[] } {
  const label = (k: string) => ask.find((a) => a.key === k)?.label ?? k.replace(/_/g, ' ');
  const facts = ask.filter((a) => !NOT_FACTS.has(a.key) && text(f, a.key)).map((a) => {
    const x = f.found[a.key]!;
    return {
      key: a.key, label: a.label, value: text(f, a.key),
      ...(typeof x.source === 'string' ? { source: x.source } : {}),
      ...(typeof x.quote === 'string' ? { quote: x.quote } : {}),
    };
  });
  const notFound = f.notFound.filter((k) => !NOT_FACTS.has(k)).map(label);
  return { facts, notFound };
}

/** Who a profile step is about: its own subject, else the notebook's title without "Prepare for a meeting with". Pure. */
export function profileSubject(nb: Pick<Notebook, 'title'>, step: Pick<NotebookStep, 'subject'>): string {
  if (step.subject) return step.subject;
  return nb.title.replace(/^(prepare|get ready|prep)\s+(for\s+)?(a\s+|the\s+|my\s+)?(meeting|call|chat|interview|coffee)\s+(with\s+)?/i, '').replace(/^(learn about|research|meet)\s+/i, '').trim() || nb.title;
}

/**
 * What the researcher is told about why and who: the links you gave first (so
 * they survive the cut, and it can tell which of a shared name it is), then
 * what the notebook is for, what you asked, and the meeting. Pure.
 */
export function profileContext(nb: Pick<Notebook, 'statement' | 'params' | 'meeting'>): string {
  const links = notebookGivenLinks(nb);
  return [
    links.length ? `Links you were given about them (the right one is the one these are about): ${links.join(' ')}` : '',
    nb.statement, ...nb.params, nb.meeting?.goal ? `Meeting goal: ${nb.meeting.goal}` : '', nb.meeting?.notes ? `Already known: ${nb.meeting.notes}` : '',
  ].filter(Boolean).join('; ').slice(0, 900);
}

/** A LinkedIn profile you gave is their LinkedIn (it can't be read, so research never finds it): kept as given, over any found. Pure. */
export function withGivenLinkedIn<T extends { facts: Array<{ key: string; label: string; value: string; source?: string; quote?: string }>; notFound: string[] }>(f: T, links: readonly string[]): T {
  const given = links.find((u) => /^https?:\/\/([a-z]+\.)?linkedin\.com\/in\/[^/?#]+/i.test(u));
  if (!given) return f;
  const label = PERSON_ASK.find((a) => a.key === 'linkedin')!.label;
  return { ...f, facts: [...f.facts.filter((x) => x.key !== 'linkedin'), { key: 'linkedin', label, value: given, source: given }], notFound: f.notFound.filter((x) => x !== label) };
}

const host = (u: string): string | undefined => {
  try { const h = new URL(u).hostname.replace(/^www\./, ''); return h.includes('.') ? h : undefined; } catch { return undefined; }
};

export async function research(ctx: Ctx, inputs: Record<string, string>): Promise<{ runId?: string; result?: string; error?: string }> {
  if (ctx.notebookResearchRun) return { result: await ctx.notebookResearchRun(inputs) };
  const agent = ctx.agentStore.getAgent(RESEARCH_ONE_ID);
  if (!agent) return { error: `${RESEARCH_ONE_ID} isn't installed` };
  const run = await runDispatchedAgentToTerminal(ctx, agent, inputs);
  return run.status === 'completed' ? { runId: run.id, result: run.result } : { runId: run.id, error: run.error ?? run.status };
}

/** At most this many pages are read looking for a picture of them. */
const PHOTO_PAGES = 5;

/**
 * A picture that's them: the research's own (only when the page it came
 * from shows it as theirs), else one on a page about them among those their
 * facts came from (core personPhotoOnPage). Pictures you said aren't them
 * are skipped. Never LinkedIn: it isn't read.
 */
async function personPhoto(ctx: Ctx, nb: Notebook, name: string, research: Found): Promise<PersonPhotoFound | undefined> {
  const check = ctx.notebookPersonPhotoCheck ?? findPersonPhoto;
  const rejected = new Set(nb.about?.person?.rejectedPhotos ?? []);
  const readable = (u: unknown): u is string => typeof u === 'string' && /^https?:\/\//i.test(u) && !/linkedin\.com|licdn\.com/i.test(u);
  const tries: Array<{ page: string; want?: string }> = [];
  const want = text(research, 'photo_url');
  const from = research.found.photo_url?.source;
  if (readable(want) && readable(from)) tries.push({ page: from, want });
  for (const f of Object.values(research.found)) if (readable(f?.source)) tries.push({ page: f.source });
  for (const k of ['website']) { const u = text(research, k); if (readable(u)) tries.push({ page: u }); }
  const seen = new Set<string>();
  for (const t of tries) {
    const key = `${t.page}|${t.want ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if ([...seen].length > PHOTO_PAGES) break;
    const found = await check(t.page, name, t.want);
    if ('image' in found && !rejected.has(found.image)) return found;
  }
  return undefined;
}

/** Keep a copy of a picture of them; none that checks out just leaves their initials. */
async function keepPicture(ctx: Ctx, store: NotebookStore, nb: Notebook, who: NotebookAboutWho, how: { photo?: PersonPhotoFound; site?: string }): Promise<string | undefined> {
  const deps = ctx.notebookLogoDeps ?? defaultLogoDeps;
  try {
    if (how.photo) {
      const img = ctx.notebookLogoDeps ? await deps.fetchImage(how.photo.image) : await fetchImage(how.photo.image, { maxBytes: 3 * 1024 * 1024 });
      // A portrait, not a banner or an icon: roughly square to tall, and big enough to see.
      const size = imageSize(img.bytes);
      const fits = !size || (Math.min(size.width, size.height) >= 96 && size.width / size.height <= 1.6 && size.height / size.width <= 2.2);
      if (fits) {
        store.saveAboutPhoto(nb.id, who, how.photo.image, { contentType: img.contentType, bytes: img.bytes }, 'photo', { page: how.photo.page, why: how.photo.why });
        return 'photo';
      }
    }
    const h = how.site ? host(how.site) : undefined;
    if (h) {
      const logo = await findLogo(h, deps);
      if (logo) { store.saveAboutPhoto(nb.id, who, logo.url, logo, 'logo'); return 'logo'; }
    }
  } catch { /* no picture: initials */ }
  return undefined;
}

/**
 * Learn about who the notebook is about. Returns notes for the step's log
 * (each research run, what was kept); never throws.
 */
export async function learnAbout(ctx: Ctx, store: NotebookStore, notebookId: string, step: NotebookStep, onRun?: (runId: string) => void): Promise<string[]> {
  const notes: string[] = [];
  const nb = store.get(notebookId);
  if (!nb) return notes;
  const subject = profileSubject(nb, step);
  const ask = (list: readonly Ask[]) => JSON.stringify(list);
  const context = profileContext(nb);

  const first = await research(ctx, { SUBJECT: subject, ASK: ask(PERSON_ASK), CONTEXT: context, DEPTH: 'thorough' });
  if (first.runId) onRun?.(first.runId);
  const person = readResearch(first.result);
  if (!person) { notes.push(`${RESEARCH_ONE_ID}: ${first.error ?? 'no answer'}`); return notes; }
  const isCompany = /^(company|organi[sz]ation|business)/i.test(text(person, 'kind'));

  let company: { name: string; site?: string } | undefined;
  if (isCompany) {
    company = { name: subject, ...(text(person, 'website') ? { site: text(person, 'website') } : {}) };
  } else {
    const { facts, notFound } = withGivenLinkedIn(aboutFrom(person, PERSON_ASK), notebookGivenLinks(nb));
    store.setAbout(nb.id, 'person', { name: subject, facts, notFound, ...(person.summary ? { summary: person.summary } : {}) });
    notes.push(`learned ${String(facts.length)} about ${subject}`);
    const photo = await personPhoto(ctx, store.get(nb.id) ?? nb, subject, person);
    const pic = photo ? await keepPicture(ctx, store, nb, 'person', { photo }) : undefined;
    notes.push(pic ? `kept a photo (${photo!.why})` : 'no photo that is clearly them');
    const org = text(person, 'organization');
    if (org) company = { name: org, ...(text(person, 'company_website') ? { site: text(person, 'company_website') } : {}) };
  }

  if (company) {
    const second = await research(ctx, { SUBJECT: company.name, ASK: ask(COMPANY_ASK), CONTEXT: isCompany ? context : `${subject}'s company${company.site ? `, ${company.site}` : ''}`, DEPTH: isCompany ? 'thorough' : 'quick' });
    if (second.runId) onRun?.(second.runId);
    const c = readResearch(second.result);
    if (c) {
      const { facts, notFound } = aboutFrom(c, COMPANY_ASK);
      // Its competitors: their own list, each from the page that names it (the answer's page for any that don't say).
      const rivals = cleanCompetitors(c.found.competitors?.value, company.name, typeof c.found.competitors?.source === 'string' ? c.found.competitors.source : undefined);
      store.setAbout(nb.id, 'company', { name: company.name, facts, notFound, ...(c.summary ? { summary: c.summary } : {}), ...(rivals.length ? { competitors: rivals } : {}) });
      if (rivals.length) notes.push(`named ${String(rivals.length)} competitor${rivals.length === 1 ? '' : 's'}`);
      notes.push(`learned ${String(facts.length)} about ${company.name}`);
      const pic = await keepPicture(ctx, store, nb, 'company', { site: text(c, 'website') || company.site });
      if (pic) notes.push(`kept its ${pic}`);
    } else {
      notes.push(`${RESEARCH_ONE_ID} on ${company.name}: ${second.error ?? 'no answer'}`);
    }
  }
  return notes;
}
