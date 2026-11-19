import { describe, it, expect } from 'vitest';
import type { Notebook, NotebookEntry } from '@some-useful-agents/core';
import { bestSources } from './notebook-write.js';
import { answerBehindBand } from '../views/notebooks.js';
import { render } from '../views/html.js';

const at = '2026-11-19T00:00:00.000Z';
let n = 0;
const page = (url: string, over: Partial<NotebookEntry> = {}): NotebookEntry => ({ id: `e${String(++n)}`, notebookId: 'nb', kind: 'evidence', title: url, body: '', by: 'x', fingerprint: url, createdAt: at, ...over } as NotebookEntry);
const subjects = ['A2UI', 'CopilotKit'];

describe('what the writer reads first, and the band when sources came after the answer (ADR-0083)', () => {
  it('puts outside voices first, then primary sources, a found quote before a missing one, no more than 3 from one publisher up front', () => {
    // Entries come newest first: the vendor's many pages are the newest.
    const vendor = [1, 2, 3, 4, 5].map((i) => page(`https://www.copilotkit.ai/blog/${String(i)}`, { origin: { publisher: 'CopilotKit', kind: 'vendor', whose: 'CopilotKit' } }));
    const spec = page('https://a2ui.org/spec', { trace: { status: 'found', at } });
    const missing = page('https://a2ui.org/missing', { trace: { status: 'missing', at } });
    const outside = page('https://thenewstack.io/x');
    const got = bestSources([...vendor, missing, spec, outside], subjects, 8).map((e) => e.fingerprint);
    // A primary page traced to its quote, the outside voice, then a primary page whose quote wasn't found; the vendor's own pages after.
    expect(got.slice(0, 3)).toEqual(['https://a2ui.org/spec', 'https://thenewstack.io/x', 'https://a2ui.org/missing']);
    expect(got.slice(3, 6)).toEqual(vendor.slice(0, 3).map((e) => e.fingerprint));
    expect(got).toHaveLength(8);
  });

  it('says how many came after the answer, with Answer again; nothing when none did', () => {
    const nb = {
      id: 'nb', title: 'Understand A2UI vs CopilotKit', statement: '', status: 'active', params: [], criteria: [], pipeline: [], stages: [], checks: [], cadence: '', fields: [],
      steps: [{ id: 'w', title: 'Write the answer', kind: 'write', shape: 'answer', status: 'done', tries: 1 }],
      answer: { question: 'q', text: 'An answer.', confidence: 'medium', findings: [], open: [], at, by: 'x' }, createdAt: at, updatedAt: at,
    } as unknown as Notebook;
    const later = { createdAt: '2026-11-20T00:00:00.000Z' };
    const band = render(answerBehindBand(nb, [page('https://a2ui.org/v1', later), page('https://thenewstack.io/y', later)]));
    expect(band).toContain('action="/notebooks/nb/steps/w/again"');
    expect(band.replace(/\s+/g, ' ')).toContain('<b>2 sources found after the answer was written</b>: 1 primary, 1 from outside A2UI, CopilotKit. The answer doesn\'t use them yet.');
    expect(band).toContain('Answer again →');
    expect(render(answerBehindBand(nb, [page('https://a2ui.org/v0')]))).toBe('');
  });
});
