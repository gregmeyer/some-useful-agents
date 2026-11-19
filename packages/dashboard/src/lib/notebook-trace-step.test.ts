import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotebookStore, RunStore, stepProgress } from '@some-useful-agents/core';
import { traceAnswerSources, traceWords } from './notebook-trace-step.js';
import { notebookWidgetData } from './notebook-widgets.js';
import { progressWords } from './notebook-steps.js';

let dir = '';
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });

describe("an answer's check step traces its sources (ADR-0082)", () => {
  it('looks for each quote on its page once per page, keeps what it found on each source, and tags the findings that cite them', async () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-trace-'));
    const runs = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    const nb = s.create({ title: 'Understand A2UI vs CopilotKit' });
    const steps = s.setSteps(nb.id, [{ title: 'Find sources', kind: 'find', target: 3 }, { title: 'Check the sources', kind: 'check' }, { title: 'Write the answer', kind: 'write', shape: 'answer' }]).steps!;
    const check = steps[1];
    const spec = s.addEntry(nb.id, { kind: 'evidence', title: 'A2UI describes the UI', body: '"A2UI lets an agent describe an interactive UI" A2UI (found by the Web search)', by: 'x', source: 'https://a2ui.org/spec' });
    // The same page filed twice: read once, and both get its result.
    const again = s.addEntry(nb.id, { kind: 'evidence', title: 'A2UI again', body: '"A2UI lets an agent describe an interactive UI" A2UI (found by the Web search)', by: 'x', source: 'https://a2ui.org/spec/' });
    const blog = s.addEntry(nb.id, { kind: 'evidence', title: 'A review', body: '"CopilotKit sits in front of both of them" Review (found by the Web search)', by: 'x', source: 'https://thenewstack.io/x' });
    const gone = s.addEntry(nb.id, { kind: 'evidence', title: 'Gone', body: '"This page said something once upon a time" Gone (found by the Web search)', by: 'x', source: 'https://example.org/gone' });
    s.addEntry(nb.id, { kind: 'evidence', title: 'No quote', body: 'Spec (found by the Web search)', by: 'x', source: 'https://docs.ag-ui.com/spec' });

    let p = stepProgress(s.get(nb.id)!, s.entries(nb.id, 1000), check);
    expect(p).toMatchObject({ met: false, have: 0, want: 4, unit: 'sources traced' });
    expect(progressWords(check, p)).toBe('0 of 4 sources traced');

    const read: string[] = [];
    const out = await traceAnswerSources(s, nb.id, async (url) => { read.push(url); return url.includes('a2ui') ? 'found' : url.includes('gone') ? 'unread' : 'missing'; });
    expect(out).toEqual({ found: 1, missing: 1, unread: 1, noQuote: 1, left: 0 });
    expect(traceWords(out)).toBe("1 quote found on its page · 1 not found word for word · 1 page couldn't be read · 1 source had no quote");
    expect(read.filter((u) => u.includes('a2ui'))).toHaveLength(1);
    const byId = new Map(s.entries(nb.id, 1000).map((e) => [e.id, e]));
    expect([spec, again, blog, gone].map((e) => byId.get(e.id)!.trace?.status)).toEqual(['found', 'found', 'missing', 'unread']);
    p = stepProgress(s.get(nb.id)!, s.entries(nb.id, 1000), check);
    expect(p).toMatchObject({ met: true, have: 4, want: 4 });

    // Written: each finding says how what it cites traced (A2UI's own site is primary).
    s.setAnswer(nb.id, { question: 'How do they differ?', by: 'agent:notebook-writer', text: 'A2UI describes; CopilotKit renders.', confidence: 'medium', basis: '', findings: [{ text: 'A2UI describes the UI.', from: [spec.id] }, { text: 'CopilotKit sits in front.', from: [blog.id, gone.id] }], open: [], at: new Date().toISOString() });
    const d = notebookWidgetData(s.get(nb.id)!, s.entries(nb.id, 1000)).notebook;
    expect(d.findings.map((f) => f.trace)).toEqual(['verified', 'unverified']);
  });
});
