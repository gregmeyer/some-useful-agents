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
import { RunStore, NotebookStore, NOTEBOOK_LAYOUT_DATA, pageRhythm, resolvePointer, splitNotebookHeader, validateViewComponents, type Notebook, type ViewComponent } from '@some-useful-agents/core';
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
    } else if (ex.expect.page === 'dossier') {
      expect(nb.layout?.preset).toBe('dossier');
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
