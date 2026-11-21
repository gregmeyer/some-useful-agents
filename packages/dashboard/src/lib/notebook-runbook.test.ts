import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NotebookStore, RunStore, layoutPreset, checkNotebookLayout, cleanAnswer, runbookRole, runbookCopyPlaces, runbookMinutes, runbookTotalTime, type NotebookAnswerSection } from '@some-useful-agents/core';
import { writerInputs } from './notebook-write.js';
import { notebookWidgetData, notebookWidgetMessages } from './notebook-widgets.js';
import { renderPageBrief } from '../views/notebook-page-brief.js';

let dir = '';
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
const here = dirname(fileURLToPath(import.meta.url));

describe('the Runbook page (a template, not a new kind of notebook)', () => {
  it('is a layout like the answer; the writer is told it writes a runbook; the brief prints every part of each step and what to copy', () => {
    const preset = layoutPreset('runbook')!;
    expect(preset.label).toBe('Runbook');
    expect(checkNotebookLayout(preset.layout.components).ok).toBe(true);

    dir = mkdtempSync(join(tmpdir(), 'sua-runbook-'));
    const s = NotebookStore.fromHandle(new RunStore(join(dir, 'runs.db')).databaseHandle());
    const nb = s.create({ title: 'Teach a beginner to deploy a first page' });
    s.setSteps(nb.id, [{ title: 'Find guides', kind: 'find', target: 3 }, { title: 'Write the runbook', kind: 'write', shape: 'answer' }]);
    const write = s.get(nb.id)!.steps![1];
    // An answer's page: no runbook.
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
    expect(out).toContain('<p class="rb__see"><b>✓</b> index.html in the file list.</p><p class="rb__ifnot"><b>If not</b> Drag the file, not its folder.</p>');
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

    // The page in order: the glance beside the answer, ready, the steps, what goes wrong, why; the research folded.
    const comps = (notebookWidgetMessages(s.get(nb.id)!, s.entries(nb.id, 1000)) as Array<{ updateComponents?: { components: Array<{ id: string; children?: string[] }> } }>).flatMap((m) => m.updateComponents?.components ?? []);
    const root = comps.find((c) => c.id === 'root')!;
    expect(root.children!.filter((k) => ['top', 'ready_p', 'method_p', 'trouble_p', 'why_p'].includes(k))).toEqual(['top', 'ready_p', 'method_p', 'trouble_p', 'why_p']);
    expect(comps.find((c) => c.id === 'top')!.children).toEqual(['answer', 'glance_p']);

    // On paper: each step a card with a box to tick, the prompt inside step 2 (not again on its own), what goes wrong as symptom → fix.
    const out = renderPageBrief({ nb: s.get(nb.id)!, entries: s.entries(nb.id, 1000) });
    expect((out.match(/<span class="rb__box"/g) ?? []).length).toBe(3);
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

  it("sua's drafter is told a runbook is an answer", () => {
    const yaml = readFileSync(join(here, '..', '..', '..', '..', 'agents', 'examples', 'notebook-drafter.yaml'), 'utf-8');
    expect(yaml).toContain('the answer too: "shape": "answer" ("Write the\n        runbook"), never "plan"');
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
