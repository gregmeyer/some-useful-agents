import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NotebookStore, RunStore, layoutPreset, checkNotebookLayout } from '@some-useful-agents/core';
import { writerInputs } from './notebook-write.js';
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
    expect(out).toContain('<dl class="run"><dt>How</dt><dd>Press <strong>Add file → Upload files</strong>.</dd><dt>You’ll see</dt><dd>index.html in the file list.</dd><dt>If not</dt><dd>Drag the file, not its folder.</dd></dl>');
    expect(out).toContain('<span class="fine">· 5 min</span>');
    expect(out).toContain('<span class="mark">advice</span>');
    expect(out).toContain('<figure class="copy"><figcaption class="fine">index.html</figcaption><pre>&lt;!doctype html&gt;\n&lt;h1&gt;Hello&lt;/h1&gt;</pre></figure>');

    // The page draws them too (a2ui-sua.js): How / You'll see / If not, Advice marked, and a Copy button.
    const js = readFileSync(join(here, '..', 'assets', 'a2ui-sua.js'), 'utf-8');
    expect(js).toContain("if (x.kind === 'copy') return copyBlock(x);");
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

  it("sua's drafter is told a runbook is an answer", () => {
    const yaml = readFileSync(join(here, '..', '..', '..', '..', 'agents', 'examples', 'notebook-drafter.yaml'), 'utf-8');
    expect(yaml).toContain('the answer too: "shape": "answer" ("Write the\n        runbook"), never "plan"');
  });

  it("the writer's instructions describe the runbook", () => {
    const yaml = readFileSync(join(here, '..', '..', '..', '..', 'agents', 'examples', 'notebook-writer.yaml'), 'utf-8');
    expect(yaml).toContain('When the notebook has "runbook": true');
    expect(yaml).toContain('"advice": true and no "from"');
    expect(yaml).toContain('"copy" for something to use as it is');
  });
});
