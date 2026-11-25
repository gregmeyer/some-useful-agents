import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NotebookStore, RunStore, asksForRunbook, layoutPreset, checkNotebookLayout, cleanAnswer, runbookRole, runbookCopyPlaces, runbookMinutes, runbookTotalTime, runbookNeeds, runbookPhases, type NotebookAnswerSection } from '@some-useful-agents/core';
import { writerInputs } from './notebook-write.js';
import { pageAfterWritten } from './notebook-steps.js';
import { notebookWidgetData, notebookWidgetMessages } from './notebook-widgets.js';
import { renderPageBrief } from '../views/notebook-page-brief.js';

let dir = '';
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
const here = dirname(fileURLToPath(import.meta.url));

describe('the Runbook page (a template, not a new kind of notebook)', () => {
  it('is a layout like the answer; the writer is told it writes a runbook; the brief prints every part of each step and what to copy', () => {
    const preset = layoutPreset('runbook')!;
    expect(preset.label).toBe('How-to');
    expect(checkNotebookLayout(preset.layout.components).ok).toBe(true);

    dir = mkdtempSync(join(tmpdir(), 'sua-runbook-'));
    const s = NotebookStore.fromHandle(new RunStore(join(dir, 'runs.db')).databaseHandle());
    const nb = s.create({ title: 'Teach a beginner to deploy a first page' });
    s.setSteps(nb.id, [{ title: 'Find guides', kind: 'find', target: 3 }, { title: 'Write the runbook', kind: 'write', shape: 'answer' }]);
    const write = s.get(nb.id)!.steps![1];
    // Teaching something, on a page still its own: a runbook. An Answer page you picked: no runbook.
    expect(JSON.parse(writerInputs(s.get(nb.id)!, [], write).NOTEBOOK).runbook).toBe(true);
    s.setLayout(nb.id, layoutPreset('answer')!.layout, 'picked');
    expect(JSON.parse(writerInputs(s.get(nb.id)!, [], write).NOTEBOOK).runbook).toBeUndefined();
    s.setLayout(nb.id, preset.layout, 'picked');
    expect(JSON.parse(writerInputs(s.get(nb.id)!, [], write).NOTEBOOK).runbook).toBe(true);

    const guide = s.addEntry(nb.id, { kind: 'evidence', title: 'MDN: Publishing your website', body: '"upload your files" MDN (found by the Web search)', by: 'x', source: 'https://developer.mozilla.org/publishing' });
    s.setAnswer(nb.id, {
      question: 'How?', by: 'agent:notebook-writer', text: 'A live page in about **45 minutes**.', confidence: 'medium', basis: '', findings: [], open: [], at: new Date().toISOString(),
      sections: [
        { title: 'The steps', kind: 'steps', items: [
          { text: 'Upload index.html', how: 'Press **Add file → Upload files**.', see: 'index.html in the file list.', ifNot: 'Drag the file, not its folder.', time: '5 min', from: [guide.id] },
          { text: 'Let them see it live before any Git', advice: true, from: [] },
        ] },
        { title: 'A starter page', kind: 'copy', label: 'index.html', lang: 'html', body: '<!doctype html>\n<h1>Hello</h1>' },
      ],
    });
    const out = renderPageBrief({ nb: s.get(nb.id)!, entries: s.entries(nb.id, 1000) });
    // On the Runbook page each step is a card: how, ✓ what you'll see, if not.
    expect(out).toContain('<p>Press <strong>Add file → Upload files</strong>.</p>');
    // If not, on paper: a small "Stuck?" line under the step (a fold can't open on paper).
    expect(out).toContain('<p class="rb__see"><b>✓</b> index.html in the file list.</p><p class="rb__stuck"><b>Stuck?</b> Drag the file, not its folder.</p>');
    expect(out).toContain('<span class="fine">· 5 min</span>');
    expect(out).toContain('<span class="mark">advice</span>');
    expect(out).toContain('<figure class="copy"><figcaption class="fine">index.html</figcaption><pre>&lt;!doctype html&gt;\n&lt;h1&gt;Hello&lt;/h1&gt;</pre></figure>');

    // The page draws them too (a2ui-sua.js): How / You'll see / If not, Advice marked, and a Copy button.
    const js = readFileSync(join(here, '..', 'assets', 'a2ui-sua.js'), 'utf-8');
    expect(js).toContain("if (x.kind === 'copy') return copyBlock(x);");
    expect(js).toContain("if (style === 'runbook' && x.kind === 'steps') return runbookSteps(x, host);");
    // A CSS escape ("\\2713") inside lit's css`` is an invalid template escape: the whole stylesheet is lost. Characters as they are.
    expect(js).not.toMatch(/content: "\\[0-9a-f]/i);
    // Another page prints a step's parts as a list.
    s.setLayout(nb.id, layoutPreset('answer')!.layout, 'picked');
    expect(renderPageBrief({ nb: s.get(nb.id)!, entries: s.entries(nb.id, 1000) })).toContain('<dl class="run"><dt>How</dt><dd>Press <strong>Add file → Upload files</strong>.</dd><dt>You’ll see</dt><dd>index.html in the file list.</dd><dt>If not</dt><dd>Drag the file, not its folder.</dd></dl>');
    expect(js).toMatch(/\['How', it\.how, ''\], \['You\\u2019ll see', it\.see, ''\], \['If not', it\.ifNot, 'ifnot'\]/);
  });

  it('a Runbook page writes the answer, never a plan: picking the page or setting the steps either way round', () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-runbook-'));
    const s = NotebookStore.fromHandle(new RunStore(join(dir, 'runs.db')).databaseHandle());
    // Steps first (as sua's edit set them: "Write the runbook", a plan), then the page.
    const a = s.create({ title: 'Teach it' });
    s.setSteps(a.id, [{ title: 'Find guides', kind: 'find', target: 3 }, { title: 'Write the runbook', kind: 'write', shape: 'plan' }]);
    expect(s.get(a.id)!.steps![1].shape).toBe('plan');
    s.setLayout(a.id, layoutPreset('runbook')!.layout, 'picked');
    expect(s.get(a.id)!.steps![1].shape).toBe('answer');
    // The page first, then the steps.
    const b = s.create({ title: 'Teach it again' });
    s.setLayout(b.id, layoutPreset('runbook')!.layout, 'picked');
    s.setSteps(b.id, [{ title: 'Write the runbook', kind: 'write', shape: 'plan' }]);
    expect(s.get(b.id)!.steps![0].shape).toBe('answer');
    // Another page keeps its plan.
    const c = s.create({ title: 'Plan a trip' });
    s.setLayout(c.id, layoutPreset('plan')!.layout, 'picked');
    s.setSteps(c.id, [{ title: 'Write the plan', kind: 'write', shape: 'plan' }]);
    expect(s.get(c.id)!.steps![0].shape).toBe('plan');
  });

  it('lays out like a recipe: at a glance, what to have ready, the steps with the prompt inside the step that pastes it, what goes wrong, then why', () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-runbook-'));
    const s = NotebookStore.fromHandle(new RunStore(join(dir, 'runs.db')).databaseHandle());
    const nb = s.create({ title: 'Teach a beginner to deploy a first page' });
    s.setSteps(nb.id, [{ title: 'Find guides', kind: 'find', target: 1 }, { title: 'Write the runbook', kind: 'write', shape: 'answer' }]);
    s.setLayout(nb.id, layoutPreset('runbook')!.layout, 'picked');
    const g = s.addEntry(nb.id, { kind: 'evidence', title: 'MDN', body: '"upload your files" MDN (found by the Web search)', by: 'x', source: 'https://developer.mozilla.org/publishing' });
    // As written before roles (the teach notebook's answer): no role, no copy, times in words.
    const sections: NotebookAnswerSection[] = [
      { title: 'What to have ready', kind: 'text', body: 'A GitHub account and Claude.' },
      { title: 'From blank account to live page', kind: 'steps', items: [
        { text: 'Create a repository.', how: 'New repository, public.', time: '2 min', from: [g.id] },
        { text: 'Ask Claude for one HTML page.', how: 'Paste the prompt below into Claude.', see: 'Claude gives you HTML.', ifNot: 'Ask it to combine the files.', time: '5–10 min', from: [g.id] },
        { text: 'Enable GitHub Pages.', how: 'Settings → Pages.', time: '1 hour', from: [g.id] },
      ] },
      { title: 'Prompt to paste into Claude', kind: 'copy', body: 'Make a single-page website.', label: 'Replace the bracketed text.', lang: 'prompt' },
      { title: 'What goes wrong', kind: 'table', columns: ['Symptom', 'Likely cause', 'Fix'], rows: [{ cells: ['No page at the URL.', 'No index.html.', 'Rename the file index.html.'], from: [g.id] }] },
      { title: 'Beginner guides behind this lesson', kind: 'table', columns: ['Guide', 'What to borrow', 'Watch out'], rows: [{ cells: ['MDN', 'The upload path.', 'Older screenshots.'], from: [g.id] }] },
    ];
    expect(sections.map(runbookRole)).toEqual(['ready', 'method', 'method', 'trouble', 'background']);
    expect(runbookCopyPlaces(sections)).toEqual([{ copy: 'prompt-to-paste-into-claude', steps: 'from-blank-account-to-live-page', index: 1 }]);
    expect(runbookMinutes('5–10 min')).toEqual([5, 10]);
    expect(runbookMinutes('a few minutes')).toBeUndefined();
    expect(runbookTotalTime([{ time: '2 min' }, { time: '5–10 min' }, { time: '1 hour' }])).toBe('67–72 min');
    expect(runbookTotalTime([{ time: '2 min' }, { time: '3 min' }])).toBe('about 5 min');
    expect(runbookTotalTime([{ time: '2 min' }, { time: 'a few minutes' }])).toBeUndefined();
    s.setAnswer(nb.id, { question: 'How?', by: 'agent:notebook-writer', text: 'A live page in about 30 minutes.', confidence: 'high', findings: [{ text: 'MDN shows the path.', from: [g.id] }], open: [], sections, at: new Date().toISOString() });

    const d = notebookWidgetData(s.get(nb.id)!, s.entries(nb.id, 1000)).notebook;
    expect(d.runbook.glance).toEqual([{ label: 'Takes', value: '67–72 min' }, { label: 'Steps', value: '3' }]);
    const steps = d.answerSections.find((x) => x.kind === 'steps')!;
    expect(steps.items![1].copyPart).toMatchObject({ kind: 'copy', body: 'Make a single-page website.' });
    expect(d.answerSections.find((x) => x.kind === 'copy')!.inStep).toBe(true);

    // The page in order (ADR-0097): what you'll make beside the glance, what you'll need, the steps, what goes wrong; how sua knows it, folded (no lesson yet: no Finish).
    const comps = (notebookWidgetMessages(s.get(nb.id)!, s.entries(nb.id, 1000)) as Array<{ updateComponents?: { components: Array<{ id: string; children?: string[] }> } }>).flatMap((m) => m.updateComponents?.components ?? []);
    const root = comps.find((c) => c.id === 'root')!;
    expect(root.children!.filter((k) => ['top', 'needs_p', 'method_p', 'trouble_p', 'finish_p', 'knows_d'].includes(k))).toEqual(['top', 'needs_p', 'method_p', 'trouble_p', 'knows_d']);
    expect(comps.find((c) => c.id === 'top')!.children).toEqual(['open_p', 'glance_p']);

    // On paper: each step a card with a box to tick, the prompt inside step 2 (not again on its own), what goes wrong as symptom → fix.
    const out = renderPageBrief({ nb: s.get(nb.id)!, entries: s.entries(nb.id, 1000) });
    // A box for each of the 3 steps, and for what you'll need (its ready part, as items).
    expect((out.match(/<span class="rb__box"/g) ?? []).length).toBe(4);
    expect(out).toContain('<ul class="rl__needs"><li><span class="rb__box" aria-hidden="true"></span>A GitHub account and Claude</li></ul>');
    const step2 = out.slice(out.indexOf('Ask Claude for one HTML page.'), out.indexOf('Enable GitHub Pages.'));
    expect(step2).toContain('<figure class="copy"><figcaption class="fine">Replace the bracketed text.</figcaption><pre>Make a single-page website.</pre></figure>');
    expect(out.match(/Make a single-page website\./g)).toHaveLength(1);
    expect(out).toContain('<span class="rubric__then">→ Rename the file index.html.</span><span class="muted"> · Likely cause: No index.html.</span>');
    expect(out.indexOf('What to have ready') < 0 || out.indexOf('A GitHub account and Claude.') < out.indexOf('Create a repository.')).toBe(true);
    expect(out.indexOf('Create a repository.')).toBeLessThan(out.indexOf('No page at the URL.'));
    expect(out.indexOf('No page at the URL.')).toBeLessThan(out.indexOf('The upload path.'));
  });

  it('keeps the roles, the step that uses a copy part and the glance the writer gives', () => {
    const a = cleanAnswer({
      answer: 'A page in 30 minutes.', confidence: 'high', glance: { time: 'about 30 min', level: 'first-timer', makes: 'a live page' },
      sections: [
        { title: 'Get set', kind: 'text', role: 'ready', body: 'An account.' },
        { title: 'Do it', kind: 'steps', role: 'method', items: [{ text: 'One', copy: 'The prompt' }, { text: 'Two' }] },
        { title: 'The prompt', kind: 'copy', role: 'method', body: 'Make a page.' },
        { title: 'Odd', kind: 'text', role: 'nonsense', body: 'x' },
      ],
    }, new Set(), 'How?', 'w')!;
    expect(a.glance).toEqual({ time: 'about 30 min', level: 'first-timer', makes: 'a live page' });
    expect(a.sections!.map((x) => x.role)).toEqual(['ready', 'method', 'method']);
    expect((a.sections![1] as { items: Array<{ copy?: string }> }).items[0].copy).toBe('The prompt');
    expect(runbookCopyPlaces(a.sections!)).toEqual([{ copy: 'the-prompt', steps: 'do-it', index: 0 }]);
  });

  it('keeps a lesson and each step\'s phase (ADR-0097); a lesson without steps, or that says nothing, is dropped', () => {
    const raw = {
      answer: 'A sandwich in 2 minutes.', confidence: 'medium',
      lesson: {
        goals: ['Make a PB&J', 'Keep the jar clean', 'Spread evenly', 'Check labels', 'One too many'],
        needs: ['Bread', 'Peanut butter', 'Bread'], done: 'Two slices close with the fillings inside.',
        keyPoints: ['Clean hands first'], next: 'Try toasting the bread.',
        selfCheck: [{ q: 'Why two knives?', a: 'So peanut butter stays out of the jelly jar.' }, { q: 'No answer' }],
      },
      sections: [{ title: 'Do it', kind: 'steps', role: 'method', items: [{ text: 'Wash hands', phase: 'Prep' }, { text: 'Spread', phase: 'Make' }] }],
    };
    const a = cleanAnswer(raw, new Set(), 'How?', 'w')!;
    expect(a.lesson).toEqual({
      goals: ['Make a PB&J', 'Keep the jar clean', 'Spread evenly', 'Check labels'], needs: ['Bread', 'Peanut butter'],
      done: 'Two slices close with the fillings inside.', keyPoints: ['Clean hands first'], next: 'Try toasting the bread.',
      selfCheck: [{ q: 'Why two knives?', a: 'So peanut butter stays out of the jelly jar.' }],
    });
    expect((a.sections![0] as { items: Array<{ phase?: string }> }).items.map((i) => i.phase)).toEqual(['Prep', 'Make']);
    expect(cleanAnswer({ ...raw, sections: [] }, new Set(), 'How?', 'w')!.lesson).toBeUndefined();
    expect(cleanAnswer({ ...raw, lesson: { goals: [], needs: [] } }, new Set(), 'How?', 'w')!.lesson).toBeUndefined();
  });

  it('what you\'ll need: the lesson\'s, else its ready part split into items', () => {
    const ready = (body: string): NotebookAnswerSection => ({ title: 'Before you start', kind: 'text', role: 'ready', body });
    expect(runbookNeeds({ sections: [ready('Have bread, peanut butter, jelly, a plate, and clean utensils ready. Check the food labels if allergies are a concern.')] }))
      .toEqual(['Bread', 'Peanut butter', 'Jelly', 'A plate', 'Clean utensils', 'Check the food labels if allergies are a concern']);
    expect(runbookNeeds({ sections: [ready('- A GitHub account\n- A laptop\n- 30 minutes')] })).toEqual(['A GitHub account', 'A laptop', '30 minutes']);
    expect(runbookNeeds({ sections: [ready('An account.')], lesson: { goals: [], needs: ['Bread'], keyPoints: [], selfCheck: [] } })).toEqual(['Bread']);
    expect(runbookNeeds({ sections: [] })).toEqual([]);
  });

  it('the page gets the lesson, with what you\'ll need from the ready part when there is none, and each step\'s phase', () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-runbook-'));
    const s = NotebookStore.fromHandle(new RunStore(join(dir, 'runs.db')).databaseHandle());
    const nb = s.create({ title: 'Teach me how to make a sandwich' });
    s.setLayout(nb.id, layoutPreset('runbook')!.layout, 'picked');
    s.setAnswer(nb.id, { question: 'How?', by: 'w', text: 'A sandwich.', confidence: 'medium', basis: '', findings: [], open: [], at: new Date().toISOString(),
      sections: [
        { title: 'Before you start', kind: 'text', role: 'ready', body: 'Have bread, jam and a knife ready.' },
        { title: 'The steps', kind: 'steps', role: 'method', items: [{ text: 'Spread', phase: 'Make', from: [] }, { text: 'Close', phase: 'Finish', from: [] }] },
      ] });
    const page = notebookWidgetData(s.get(nb.id)!, []).notebook as unknown as { runbook: { lesson: { needs: string[]; written: boolean } }; answerSections: Array<{ items?: Array<{ phase?: string }> }> };
    expect(page.runbook.lesson).toMatchObject({ needs: ['Bread', 'Jam', 'A knife'], written: false });
    expect(page.answerSections.find((x) => x.items)?.items?.map((i) => i.phase)).toEqual(['Make', 'Finish']);
  });

  it('a lesson opens with what you\'ll make and ends with Finish; on paper the boxes are empty and the self-check\'s answers printed', () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-runbook-'));
    const s = NotebookStore.fromHandle(new RunStore(join(dir, 'runs.db')).databaseHandle());
    const nb = s.create({ title: 'Teach me how to make a sandwich' });
    s.setLayout(nb.id, layoutPreset('runbook')!.layout, 'picked');
    s.setAnswer(nb.id, { question: 'How?', by: 'w', text: '**You\u2019ll have a sandwich in 2 minutes.** Wash up first.', confidence: 'medium', basis: '', findings: [], open: [], at: new Date().toISOString(),
      lesson: { goals: ['Spread without mixing jars'], needs: ['Bread', 'Jam'], done: 'The slices close with the filling inside.', keyPoints: ['Clean hands first'], next: 'Try toasting it.', selfCheck: [{ q: 'Why two knives?', a: 'To keep the jars clean.' }] },
      sections: [{ title: 'The steps', kind: 'steps', role: 'method', items: [{ text: 'Spread', from: [] }, { text: 'Close', from: [] }] }] });
    const now = s.get(nb.id)!;
    const comps = (notebookWidgetMessages(now, []) as Array<{ updateComponents?: { components: Array<{ id: string; children?: string[] }> } }>).flatMap((m) => m.updateComponents?.components ?? []);
    expect(comps.find((c) => c.id === 'root')!.children).toContain('finish_p');
    const out = renderPageBrief({ nb: now, entries: [] });
    // The outcome in a sentence (the rest is in "How sua knows this"), then the goals.
    expect(out).toContain('<p class="rl__out"><strong>You\u2019ll have a sandwich in 2 minutes.</strong></p><div class="eyebrow">You\u2019ll be able to</div><ul class="rl__goals"><li>Spread without mixing jars</li></ul>');
    expect(out).toContain('<li><span class="rb__box" aria-hidden="true"></span>Jam</li>');
    expect(out).toContain('<p class="rl__done"><b>\u2713</b> You\u2019re done when the slices close with the filling inside.</p>');
    expect(out).toContain('<dt>Why two knives?</dt><dd>To keep the jars clean.</dd>');
    expect(out.indexOf('Finish')).toBeGreaterThan(out.indexOf('Spread'));
    expect(out.indexOf('How sua knows this')).toBeGreaterThan(out.indexOf('Finish'));
  });

  it('a page that picked Runbook follows the Runbook page as it is now; one changed from it keeps its own', async () => {
    const { notebookLayoutOf } = await import('@some-useful-agents/core');
    const old = { preset: 'runbook', components: [{ id: 'root', component: 'Column', children: ['ready_p'] }] };
    expect(notebookLayoutOf({ layout: old as never }).components).toEqual(layoutPreset('runbook')!.layout.components);
    const own = { components: [{ id: 'root', component: 'Column', children: ['x'] }, { id: 'x', component: 'Text', text: 'mine' }] };
    expect(notebookLayoutOf({ layout: own as never }).components).toEqual(own.components);
  });

  it('steps show your progress (ADR-0097): phases on paper with a done line; on the page a sticky bar, marks for sources, Stuck? folded, Done moves on', () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-runbook-'));
    const s = NotebookStore.fromHandle(new RunStore(join(dir, 'runs.db')).databaseHandle());
    const nb = s.create({ title: 'Teach me how to make a sandwich' });
    s.setLayout(nb.id, layoutPreset('runbook')!.layout, 'picked');
    s.setAnswer(nb.id, { question: 'How?', by: 'w', text: 'A sandwich.', confidence: 'medium', basis: '', findings: [], open: [], at: new Date().toISOString(),
      sections: [{ title: 'The steps', kind: 'steps', role: 'method', items: [
        { text: 'Wash hands', phase: 'Prep', ifNot: 'Wash again.', from: [] }, { text: 'Set out bread', phase: 'Prep', from: [] },
        { text: 'Spread', phase: 'Make', from: [] }, { text: 'Close', phase: 'Finish', from: [] },
      ] }] });
    const out = renderPageBrief({ nb: s.get(nb.id)!, entries: [] });
    expect(out).toContain('<p class="rb__progress"><span class="rb__blank"></span> of 4 done</p><h4 class="rb__phase">Prep <span>· steps 1–2</span></h4><ol class="rb">');
    expect(out).toContain('<h4 class="rb__phase">Make <span>· step 3</span></h4><ol class="rb"><li><span class="rb__n">3</span>');
    expect(out).toContain('<p class="rb__stuck"><b>Stuck?</b> Wash again.</p>');
    // The page: the sticky bar, phases numbered across, sources as marks, Stuck? folded, Done moving on.
    const js = readFileSync(join(here, '..', 'assets', 'a2ui-sua.js'), 'utf-8');
    expect(js).toContain('<div class="rbbar" role="status">');
    expect(js).toContain("`${String(count)} of ${String(all.length)} done`");
    expect(js).toContain('<h5 class="ph">');
    expect(js).toContain("counter-reset: step ${String(g.steps[0])}");
    expect(js).toContain('<details class="stuck"><summary>Stuck?</summary>');
    expect(js).toContain('class="mk"');
    expect(js).toContain("if (on) { const j = keys.findIndex((k, n) => n > i && !ticked(k)); if (j >= 0) setTimeout(() => go(j), 60); }");
    expect(js).not.toMatch(/content: "\\[0-9a-f]/i);
  });

  it('follow along (ADR-0097): one step at a time in a dialog, keys and swipe, Done & next, your place kept, the screen kept awake', () => {
    const js = readFileSync(join(here, '..', 'assets', 'a2ui-sua.js'), 'utf-8');
    expect(js).toContain('<button type="button" class="rbbar__go" @click=${() => openFollow(x, host, keys)}>Follow along</button>');
    expect(js).toContain('<div class="fa" role="dialog" aria-modal="true"');
    expect(js).toContain("if (e.key === 'Escape') { e.preventDefault(); close(); }");
    expect(js).toContain("else if (e.key === 'ArrowRight') { e.preventDefault(); move(i + 1); }");
    expect(js).toContain("navigator.wakeLock.request('screen')");
    expect(js).toContain("document.addEventListener('visibilitychange', host._rbVis)");
    expect(js).toContain("localStorage.setItem(placeKey, String(host._rbFollow.i))");
    expect(js).toContain('Picking up at step ${String(i + 1)}.');
    // The next step to follow: from here on, else the first not done.
    const nextUndone = new Function(`${/const nextUndone = [^\n]+/.exec(js)![0]} return nextUndone;`)() as (d: boolean[], f?: number) => number;
    expect(nextUndone([true, false, false], 0)).toBe(1);
    expect(nextUndone([false, true, false], 2)).toBe(2);
    expect(nextUndone([false, true, true], 2)).toBe(0);
    expect(nextUndone([true, true], 0)).toBe(1);
  });

  it('groups steps by phase, numbered across groups', () => {
    const g = runbookPhases([{ phase: 'Prep' }, { phase: 'Prep' }, { phase: 'Make' }, {}]);
    expect(g.map((x) => [x.phase, x.steps.map((s) => s.n)])).toEqual([['Prep', [1, 2]], ['Make', [3]], [undefined, [4]]]);
    expect(runbookPhases([{}, {}]).length).toBe(1);
  });

  it('knows a notebook that asks to be taught something from one that asks a question', () => {
    const write = [{ id: 'w', title: 'Write the answer', kind: 'write' as const, shape: 'answer' as const, status: 'todo' as const, tries: 0 }];
    const nb = (title: string, steps = write) => ({ title, statement: '', steps });
    for (const t of [
      'Teach me how to make a peanut butter and jelly sandwich',
      'teach a beginner to deploy a first page with Claude',
      'Teach my kids to ride a bike',
      'How do I set up a Raspberry Pi?',
      'Walk me through filing a 1099',
      'Show me how to bake sourdough',
      'A step-by-step guide to changing a tire',
      'Turn this into a runbook',
    ]) expect(asksForRunbook(nb(t)), t).toBe(true);
    for (const t of [
      'How do I choose a CRM for a small team?',
      'How do others handle on-call?',
      'Is it worth upgrading to a heat pump?',
      'Teach me about roadschooling',
      'What do teams pay for observability?',
    ]) expect(asksForRunbook(nb(t)), t).toBe(false);
    // The drafter's own title for the step says so too.
    expect(asksForRunbook(nb('Sourdough', [{ ...write[0], title: 'Write the runbook' }]))).toBe(true);
    // Nothing written as the answer (a plan, a pick), or a briefing on a subject: never.
    expect(asksForRunbook(nb('Teach me how to make a PB&J', [{ ...write[0], shape: 'plan' as never }]))).toBe(false);
    expect(asksForRunbook(nb('Teach me how to make a PB&J', []))).toBe(false);
    expect(asksForRunbook({ ...nb('Teach me how to make a PB&J'), briefOn: { name: 'PB&J', kind: 'topic' } })).toBe(false);
  });

  it('once written, a Runbook page is kept as it is, not composed around a hero; the page agent knows it', async () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-runbook-page-'));
    const runStore = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runStore.databaseHandle());
    let asked = 0;
    const ctx = { runStore, notebookPageRun: async () => { asked += 1; return undefined; } } as never;
    const written = (preset: string) => {
      const nb = s.create({ title: `Teach a beginner (${preset})` });
      s.setLayout(nb.id, layoutPreset(preset)!.layout, 'picked');
      s.setAnswer(nb.id, { question: 'How?', by: 'agent:notebook-writer', text: 'A live page in about 45 minutes.', confidence: 'medium', basis: '', findings: [], open: [], at: new Date().toISOString() });
      return nb.id;
    };
    // A runbook isn't composed again: the page agent isn't asked.
    await pageAfterWritten(ctx, s, written('runbook'));
    expect(asked).toBe(0);
    // Any other picked page is composed around what's written: the agent is asked (and asked again when it gives no page).
    await pageAfterWritten(ctx, s, written('answer'));
    expect(asked).toBeGreaterThan(0);
    const page = readFileSync(join(here, '..', '..', '..', '..', 'agents', 'examples', 'notebook-page.yaml'), 'utf-8');
    expect(page).toContain('{"preset": "runbook"} for teaching or walking');
    runStore.close();
  });

  it("sua's drafter is told a runbook is an answer", () => {
    const yaml = readFileSync(join(here, '..', '..', '..', '..', 'agents', 'examples', 'notebook-drafter.yaml'), 'utf-8');
    expect(yaml).toContain('the answer too: "shape": "answer" ("Write the\n        runbook"), never "plan"');
  });

  it("the writer's instructions ask for phases and a lesson", () => {
    const yaml = readFileSync(join(here, '..', '..', '..', '..', 'agents', 'examples', 'notebook-writer.yaml'), 'utf-8');
    expect(yaml).toContain('"phase" (with more than 4 steps, 2 to 4');
    expect(yaml).toContain('Add "lesson", so the page reads');
    expect(yaml).toContain('"selfCheck": 2 to 3 {"q", "a"}');
  });

  it("the writer's instructions describe the runbook", () => {
    const yaml = readFileSync(join(here, '..', '..', '..', '..', 'agents', 'examples', 'notebook-writer.yaml'), 'utf-8');
    expect(yaml).toContain('When the notebook has "runbook": true');
    expect(yaml).toContain('"advice": true and no "from"');
    expect(yaml).toContain('"copy" for something to use as it is');
    expect(yaml).toContain('Give each of these sections a "role"');
    expect(yaml).toContain('never "a\n               few minutes"');
  });
});
