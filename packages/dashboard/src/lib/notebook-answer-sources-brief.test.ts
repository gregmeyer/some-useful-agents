import { describe, it, expect } from 'vitest';
import type { Notebook, NotebookEntry } from '@some-useful-agents/core';
import { answerSourcesBrief, notebookBrief } from './notebook-pipeline.js';

const at = '2026-11-19T00:00:00.000Z';
const nb = (over: Partial<Notebook> = {}): Notebook => ({
  id: 'nb', title: 'Understand A2UI vs AG-UI vs CopilotKit', statement: 'Help me understand the difference between A2UI, AG-UI, and CopilotKit.',
  params: [], criteria: [], pipeline: [], stages: [], checks: [], cadence: '', status: 'active', fields: [],
  steps: [{ id: 'f', title: 'Find sources', kind: 'find', status: 'pending', tries: 0 }, { id: 'w', title: 'Write the answer', kind: 'write', shape: 'answer', status: 'pending', tries: 0 }],
  createdAt: at, updatedAt: at, ...over,
} as Notebook);
let n = 0;
const page = (url: string, origin?: NotebookEntry['origin']): NotebookEntry => ({ id: `e${String(++n)}`, notebookId: 'nb', kind: 'evidence', title: url, body: '', by: 'agent:x', fingerprint: url, createdAt: at, ...(origin ? { origin } : {}) } as NotebookEntry);

describe("what an answer's finder is told about where its sources come from (SIFT, ADR-0081)", () => {
  const own = [page('https://docs.copilotkit.ai/a'), page('https://www.copilotkit.ai/b'), page('https://a2ui.org/'), page('https://docs.ag-ui.com/x')];

  it('names its subjects, counts publishers, and asks for an independent search that stays off their own sites', () => {
    const lines = answerSourcesBrief(nb(), [...own, page('https://developers.googleblog.com/x')]);
    expect(lines[0]).toMatch(/^What it's about: A2UI, AG-UI, CopilotKit\. /);
    expect(lines[1]).toBe('Its sources so far: 5 pages from 4 publishers; 1 from outside them (googleblog.com).');
    expect(lines[2]).toMatch(/^It needs independent sources: make ONE of the learn searches an independent one \("kind": "learn", "independent": true\)/);
    expect(lines[2]).toContain('(-site:docs.copilotkit.ai -site:copilotkit.ai -site:a2ui.org -site:docs.ag-ui.com)');
    // It's in what the finder reads; not in another step's brief.
    expect(notebookBrief(nb(), own)).toContain('It needs independent sources');
    expect(notebookBrief(nb(), own, { step: { title: 'Check', kind: 'check' }, want: 1, have: 0, missing: [] })).not.toContain('It needs independent sources');
  });

  it("two outside publishers: no ask; what the finder said is whose counts (Google's post is A2UI's own)", () => {
    const outside = [page('https://thenewstack.io/a'), page('https://infoq.com/b')];
    expect(answerSourcesBrief(nb(), [...own, ...outside])).toHaveLength(2);
    const google = page('https://developers.googleblog.com/x', { publisher: 'Google', kind: 'vendor', whose: 'A2UI' });
    expect(answerSourcesBrief(nb(), [...own, google, outside[0]])[2]).toMatch(/^It needs independent sources/);
  });

  it('nothing for a shortlist, a briefing on one subject, or a question that names no subjects', () => {
    expect(answerSourcesBrief(nb({ steps: [{ id: 'f', title: 'Find', kind: 'find', status: 'pending', tries: 0 }] } as unknown as Partial<Notebook>), own)).toEqual([]);
    expect(answerSourcesBrief(nb({ briefOn: { name: 'CopilotKit', kind: 'organization' } } as unknown as Partial<Notebook>), own)).toEqual([]);
    expect(answerSourcesBrief(nb({ title: 'Is a hot dog a sandwich?', statement: '' }), own)).toEqual([]);
  });
});
