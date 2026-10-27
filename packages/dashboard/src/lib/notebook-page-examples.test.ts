/**
 * Each kind of notebook still gets a page that fits it. For every example
 * (lib/notebook-page-examples.ts), with the page agent's recorded answer
 * (fixtures/notebook-pages/answers.json): the right kind of page, a page
 * that draws with and without its data and reads well, every part bound to
 * data that's there, an outline that changes only on purpose (the
 * snapshot), and a brief that prints the page's parts in its order.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunStore, NotebookStore, notebookGivenLinks, NOTEBOOK_LAYOUT_DATA, pageRhythm, resolvePointer, splitNotebookHeader, validateViewComponents, type Notebook, type ViewComponent } from '@some-useful-agents/core';
import { NOTEBOOK_PAGE_EXAMPLES, type NotebookPageExample } from './notebook-page-examples.js';
import { drawNotebookPage, type DrawnPage } from './notebook-page.js';
import { notebookWidgetComponents, notebookWidgetData, notebookLayoutFlags } from './notebook-widgets.js';
import { renderPageBrief, briefIsPage, briefQuotes } from '../views/notebook-page-brief.js';

const ANSWERS = JSON.parse(readFileSync(new URL('./fixtures/notebook-pages/answers.json', import.meta.url), 'utf8')) as Record<string, { replies: string[] }>;

let dir: string | undefined;
let runs: RunStore | undefined;
afterEach(() => { try { runs?.close(); } catch { /* ignore */ } if (dir) rmSync(dir, { recursive: true, force: true }); dir = undefined; runs = undefined; });

function store(): NotebookStore {
  dir = mkdtempSync(join(tmpdir(), 'sua-nbpx-'));
  runs = new RunStore(join(dir, 'runs.db'));
  return NotebookStore.fromHandle(runs.databaseHandle());
}

/** The example, its page decided from the recorded answer (the agent reads its setup, never its options), with what its steps found when `data`. */
async function decided(ex: NotebookPageExample, data: boolean): Promise<{ s: NotebookStore; nb: Notebook; drawn: DrawnPage }> {
  const s = store();
  const id = ex.seed(s, { data });
  const replies = ANSWERS[ex.id]?.replies ?? [];
  let n = 0;
  const drawn = await drawNotebookPage(s.get(id)!, async () => replies[Math.min(n++, replies.length - 1)]);
  if ('layout' in drawn.answer) s.setLayout(id, drawn.answer.layout, 'notebook');
  return { s, nb: s.get(id)!, drawn };
}

/** The page as an indented outline: each part, its look, its row's split, its title. */
function outline(components: readonly ViewComponent[]): string {
  const byId = new Map(components.map((c) => [c.id, c]));
  const lines: string[] = [];
  const walk = (id: string, depth: number) => {
    const c = byId.get(id);
    if (!c) return;
    const bits = [c.component];
    for (const k of ['variant', 'treatment', 'subtitle', 'cover', 'steps']) if (typeof c[k] === 'string' && !(k === 'steps' && c.component !== 'NotebookHeader')) bits.push(`${k}=${c[k] as string}`);
    if (Array.isArray(c.widths)) bits.push((c.widths as number[]).join(':'));
    if (typeof c.maxItems === 'number') bits.push(`max=${c.maxItems}`);
    const title = typeof c.title === 'string' ? c.title : typeof c.label === 'string' ? c.label : undefined;
    lines.push(`${'  '.repeat(depth)}${bits.join(' ')}${title ? ` "${title}"` : ''}`);
    const kids = Array.isArray(c.children) ? c.children as string[] : typeof c.child === 'string' ? [c.child] : [];
    for (const k of kids) walk(k, depth + 1);
  };
  walk('root', 0);
  return lines.join('\n');
}

/** Every data path a part is bound to, with the part. */
function bindings(components: readonly ViewComponent[]): Array<{ id: string; path: string }> {
  const out: Array<{ id: string; path: string }> = [];
  const visit = (id: string, v: unknown) => {
    if (Array.isArray(v)) { v.forEach((x) => visit(id, x)); return; }
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if (typeof o.path === 'string' && Object.keys(o).length === 1) { out.push({ id, path: o.path }); return; }
    Object.values(o).forEach((x) => visit(id, x));
  };
  for (const c of components) visit(c.id, c);
  return out;
}

const known = (path: string) => Object.keys(NOTEBOOK_LAYOUT_DATA).some((k) => path === k || path.startsWith(`${k}/`));
const filled = (v: unknown) => (Array.isArray(v) ? v.length > 0 : typeof v === 'string' ? v.trim() !== '' : v !== undefined && v !== null);

/** The panels a page shows, in its order, by title. */
function panelTitles(components: readonly ViewComponent[]): string[] {
  const byId = new Map(components.map((c) => [c.id, c]));
  const titles: string[] = [];
  const walk = (id: string) => {
    const c = byId.get(id);
    if (!c) return;
    if (c.component === 'Panel' && typeof c.title === 'string') titles.push(c.title);
    for (const k of Array.isArray(c.children) ? c.children as string[] : typeof c.child === 'string' ? [c.child] : []) walk(k);
  };
  walk('root');
  return titles;
}

describe.each(NOTEBOOK_PAGE_EXAMPLES.map((ex) => [ex.id, ex] as const))('a notebook to %s', (_id, ex) => {
  it(`gets the page for its job (${ex.job}): ${ex.expect.page}${ex.expect.kind ? `, a ${ex.expect.kind}` : ''}`, async () => {
    const { nb, drawn } = await decided(ex, false);
    expect('error' in drawn.answer ? drawn.answer.error : 'ok').toBe('ok');
    if (ex.expect.page === 'shortlist') {
      expect(drawn.answer).toMatchObject({ keep: true });
      expect(nb.layout).toBeUndefined();
    } else if (ex.expect.page !== 'drawn') {
      expect(nb.layout?.preset).toBe(ex.expect.page);
    } else {
      expect(nb.layout?.preset).toBeUndefined();
      expect(nb.layout?.components.length).toBeGreaterThan(2);
    }
  });

  it('draws as a valid page before anything is found and once it is, and a page of its own reads well', async () => {
    const bare = await decided(ex, false);
    expect(validateViewComponents(splitNotebookHeader(notebookWidgetComponents(bare.nb)).rest).ok).toBe(true);
    const { s, nb } = await decided(ex, true);
    const page = notebookWidgetComponents(nb, undefined, notebookWidgetData(nb, s.entries(nb.id), s));
    const v = validateViewComponents(splitNotebookHeader(page).rest);
    expect(v.ok ? 'ok' : v.errors).toBe('ok');
    if (nb.layout) expect(pageRhythm(nb.layout.components)).toEqual([]);
    const names = new Set(page.map((c) => c.component));
    for (const need of ex.expect.needs ?? []) expect(names.has(need) ? need : `missing ${need}`).toBe(need);
  });

  it('binds each part to data the notebook has, so no part is an empty box', async () => {
    const { s, nb } = await decided(ex, true);
    const data = notebookWidgetData(nb, s.entries(nb.id), s);
    const page = notebookWidgetComponents(nb, undefined, data);
    const unknown = bindings(page).filter((b) => !known(b.path)).map((b) => `${b.id}: ${b.path}`);
    expect(unknown).toEqual([]);
    // Each panel and folded part shows something: one of its parts' data is there.
    const byId = new Map(page.map((c) => [c.id, c]));
    const under = (id: string): ViewComponent[] => {
      const c = byId.get(id);
      if (!c) return [];
      const kids = Array.isArray(c.children) ? c.children as string[] : typeof c.child === 'string' ? [c.child] : [];
      return [c, ...kids.flatMap(under)];
    };
    const empty = page.filter((c) => c.component === 'Panel' || c.component === 'Disclosure')
      .filter((c) => !bindings(under(c.id)).some((b) => filled(resolvePointer(data, b.path))))
      .map((c) => `${c.id} (${String(c.title ?? c.label)})`);
    expect(empty).toEqual([]);
  });

  it('keeps the same outline unless it was changed on purpose', async () => {
    const { s, nb } = await decided(ex, true);
    expect(outline(notebookWidgetComponents(nb, undefined, notebookWidgetData(nb, s.entries(nb.id), s)))).toMatchSnapshot();
  });

  it('prints its brief as its page: its parts, in its order', async () => {
    const { s, nb } = await decided(ex, true);
    if (!briefIsPage(nb)) return; // the shortlist brief (notebook-brief.ts)
    const brief = renderPageBrief({ nb, entries: s.entries(nb.id), history: s, now: new Date('2026-10-25T12:00:00Z') });
    const titles = panelTitles(notebookWidgetComponents(nb, undefined, notebookWidgetData(nb, s.entries(nb.id), s)));
    expect(titles.length).toBeGreaterThan(0);
    const at = titles.map((t) => brief.indexOf(`>${t.replace(/&/g, '&amp;').replace(/'/g, '&#39;')}<`));
    expect(titles.filter((_, i) => at[i] < 0)).toEqual([]);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });
});

describe('the flags a page waits on', () => {
  it('a meeting notebook knows who it\'s about once its profile step ran; a shortlist never does', async () => {
    const meet = await decided(NOTEBOOK_PAGE_EXAMPLES.find((e) => e.id === 'meet-person')!, true);
    expect(notebookLayoutFlags(meet.nb)).toMatchObject({ about: true, person: true, company: true });
    const car = await decided(NOTEBOOK_PAGE_EXAMPLES.find((e) => e.id === 'car')!, true);
    expect(notebookLayoutFlags(car.nb)).toMatchObject({ about: false, person: false });
  });
});

describe('what they said, in the brief', () => {
  it('gives 3 to 5, one per theme first; the extended brief has every one', async () => {
    const qs = [
      { quote: 'a1', group: 'A' }, { quote: 'a2', group: 'A' }, { quote: 'a3', group: 'A' },
      { quote: 'b1', group: 'B' }, { quote: 'c1', group: 'C' }, { quote: 'b2', group: 'B' }, { quote: 'a4', group: 'A' },
    ];
    expect(briefQuotes(qs, 4).map((q) => q.quote)).toEqual(['a1', 'a2', 'b1', 'c1']);
    expect(briefQuotes(qs, 3).map((q) => q.quote)).toEqual(['a1', 'b1', 'c1']);
    expect(briefQuotes(qs.slice(0, 2), 5).map((q) => q.quote)).toEqual(['a1', 'a2']);

    const ex = NOTEBOOK_PAGE_EXAMPLES.find((e) => e.id === 'meet-person')!;
    const { s, nb } = await decided(ex, true);
    for (let i = 0; i < 8; i++) s.upsertOption(nb.id, { title: `More ${i}`, by: 'agent:x', data: { theme: `Theme ${i % 3}`, evidence: `Said thing number ${i}.`, source_url: `https://example.com/more-${i}`, conversation_question: `Q${i}?` } });
    const entries = s.entries(nb.id);
    const count = (h: string) => (h.match(/<blockquote>/g) ?? []).length;
    const short = renderPageBrief({ nb: s.get(nb.id)!, entries, history: s });
    const part = short.slice(short.indexOf('>In their words<'));
    expect(count(part.slice(0, part.indexOf('</section>')))).toBeLessThanOrEqual(5);
    expect(short).toContain('more in the extended brief');
    const full = renderPageBrief({ nb: s.get(nb.id)!, entries, history: s, full: true });
    expect(full).toContain('Everything they said');
    for (let i = 0; i < 8; i++) expect(full).toContain(`Said thing number ${i}.`);
  });
});

describe('research activity and your links, in the brief', () => {
  it('leaves out searches that found nothing, and lists the links you gave it', async () => {
    const ex = NOTEBOOK_PAGE_EXAMPLES.find((e) => e.id === 'meet-person')!;
    const { s, nb } = await decided(ex, true);
    s.recordSearch(nb.id, 'person-finder', 'run-found', 3, '2026-10-24T10:00:00Z');
    for (let i = 0; i < 4; i++) s.recordSearch(nb.id, 'person-finder', `run-none-${String(i)}`, 0, `2026-10-24T11:0${String(i)}:00Z`);
    s.setMeeting(nb.id, { notes: 'LinkedIn profile provided: https://www.linkedin.com/in/dana-reyes/.' });
    const brief = renderPageBrief({ nb: s.get(nb.id)!, entries: s.entries(nb.id), history: s });
    expect(brief).toContain('Search returned 3 options');
    expect(brief).not.toContain('Search returned no options');
    expect(brief).toContain('<a href="https://www.linkedin.com/in/dana-reyes/">linkedin.com/in/dana-reyes</a>');
  });

  it('finds each link once, in what it is for, its meeting, and what you asked', () => {
    expect(notebookGivenLinks({ statement: 'Meet them (https://a.com/x).', params: ['see https://b.org/y, and https://a.com/x'], meeting: { goal: 'no link', notes: 'https://c.net' } }))
      .toEqual(['https://a.com/x', 'https://c.net', 'https://b.org/y']);
    expect(notebookGivenLinks({ statement: 'nothing here', params: [] })).toEqual([]);
  });
});

describe('a company\'s competitors, on the page', () => {
  it('the meeting briefing shows them as a table once a profile step named them, and leaves the part out before', async () => {
    const { layoutPreset } = await import('@some-useful-agents/core');
    const s = store();
    const nb = s.create({ title: 'Prepare for a meeting with Acme Robotics' });
    s.setLayout(nb.id, layoutPreset('dossier')!.layout, 'notebook');
    s.setAbout(nb.id, 'company', { name: 'Acme Robotics', facts: [{ key: 'what_they_do', label: 'What they do', value: 'Warehouse robots' }] });
    expect(renderPageBrief({ nb: s.get(nb.id)!, entries: [], history: s })).not.toContain('Their competitors');
    s.setAbout(nb.id, 'company', { facts: [], competitors: [{ name: 'Locus Robotics', website: 'https://locusrobotics.com', how: 'Picking robots as a service', source: 'https://www.g2.com/acme-alternatives' }, { name: 'Geek+' }] });
    const got = s.get(nb.id)!;
    expect(notebookWidgetData(got, [], s).notebook.competitors).toEqual([
      { competitor: { label: 'Locus Robotics', url: 'https://locusrobotics.com' }, how: 'Picking robots as a service', source: { label: 'g2.com', url: 'https://www.g2.com/acme-alternatives' } },
      { competitor: { label: 'Geek+' }, how: '' },
    ]);
    const brief = renderPageBrief({ nb: got, entries: [], history: s });
    expect(brief).toContain('>Their competitors<');
    // Each a link to its site, and the page that names it a link too; one without a site is just its name.
    expect(brief).toContain('<a href="https://locusrobotics.com">Locus Robotics</a>');
    expect(brief).toContain('<a href="https://www.g2.com/acme-alternatives">g2.com</a>');
    expect(brief).toContain('Picking robots as a service');
    expect(brief).toContain('<td>Geek+</td>');
    // The writer reads them too.
    const { writerInputs } = await import('./notebook-write.js');
    expect(writerInputs(got, [], { shape: 'answer' }).NOTEBOOK).toContain('Locus Robotics: Picking robots as a service');
  });
});

describe('a brief in the dashboard\'s look', () => {
  it('carries the tokens and brand theme, opens in the mode given, prints in the theme\'s light colours, and stays script-free', async () => {
    const { briefTheme, tokenBlock } = await import('./brief-theme.js');
    const { brandThemeSchema, layoutPreset } = await import('@some-useful-agents/core');
    const brand = brandThemeSchema.parse({ version: 1, name: 'Test', preset: 'default', dark: { primary: '#68ddff' }, light: { primary: '#0033cc', bg: '#fff9df' }, fonts: { display: 'Georgia, serif' } });
    const s = store();
    const nb = s.create({ title: 'Prepare for a meeting with Acme' });
    s.setLayout(nb.id, layoutPreset('dossier')!.layout, 'notebook');
    const dark = renderPageBrief({ nb: s.get(nb.id)!, entries: [], history: s, theme: briefTheme(brand) });
    expect(dark).toContain('<html lang="en">');
    expect(dark).toContain('--color-primary: #68ddff;');
    expect(dark).toContain('--font-display: Georgia, serif;');
    expect(dark).toContain('--accent: var(--color-primary)');
    expect(dark).toMatch(/h1 \{[^}]*var\(--display\)/);
    const paper = /@media print \{ :root, :root\[data-theme="light"\] \{ ([^}]*)\}/.exec(dark)![1];
    expect(paper).toContain('--color-primary: #0033cc;');
    expect(paper).toContain('--color-bg: #fff9df;');
    expect(paper).toContain('--color-text: #1c1917;'); // tokens' light text, under the brand's
    expect(dark).not.toMatch(/<script/);
    expect(renderPageBrief({ nb: s.get(nb.id)!, entries: [], history: s, theme: briefTheme(brand, 'light') })).toContain('<html lang="en" data-theme="light">');
    expect(tokenBlock(':root {\n  --color-bg: #111;\n  --font-x: y;\n}\n[data-theme="light"] {\n  --color-bg: #fff;\n}', '[data-theme="light"]')).toEqual({ bg: '#fff' });
  });
});

describe('a person\'s other companies, on the page', () => {
  it('the meeting briefing lists them (and one a settled conflict set aside) under Also runs, and the writer reads them', async () => {
    const { layoutPreset } = await import('@some-useful-agents/core');
    const { notebookAffiliations } = await import('./notebook-widgets.js');
    const { writerInputs } = await import('./notebook-write.js');
    const s = store();
    const nb = s.create({ title: 'Prepare for a meeting with Steven Gelley' });
    s.setLayout(nb.id, layoutPreset('dossier')!.layout, 'notebook');
    s.setAbout(nb.id, 'person', { name: 'Steven Gelley', facts: [{ key: 'organization', label: 'Company', value: 'ARV', source: 'https://arvfirm.com/team/' }] });
    expect(renderPageBrief({ nb: s.get(nb.id)!, entries: [], history: s })).not.toContain('Also runs');
    s.setAbout(nb.id, 'person', { facts: [], affiliations: [{ name: 'Open Access Ventures', role: 'CEO', website: 'https://openaccess.example' }] });
    // You settled "ARV or Arrive?" as ARV: Arrive is still one of theirs.
    s.setAboutConflicts(nb.id, 'person', [{ fact: 'organization', label: 'Company', question: 'Is his main work now at ARV or Arrive?', at: '2026-10-27T00:00:00Z',
      claims: [{ value: 'ARV', source: 'https://arvfirm.com/team/' }, { value: 'Arrive', source: 'https://www.linkedin.com/posts/gelley' }],
      settled: { value: 'ARV', by: 'you', at: '2026-10-27T01:00:00Z' } }]);
    const got = s.get(nb.id)!;
    expect(notebookAffiliations(got)).toEqual([{ name: 'Open Access Ventures', role: 'CEO', website: 'https://openaccess.example' }, { name: 'Arrive', source: 'https://www.linkedin.com/posts/gelley' }]);
    const brief = renderPageBrief({ nb: got, entries: [], history: s });
    expect(brief).toContain('>Also runs<');
    expect(brief).toContain('<a href="https://openaccess.example">Open Access Ventures</a>');
    expect(brief).toContain('<a href="https://www.linkedin.com/posts/gelley">linkedin.com</a>');
    expect(writerInputs(got, [], {}).NOTEBOOK).toContain('"otherCompanies":["Open Access Ventures (CEO)","Arrive"]');
  });
});
