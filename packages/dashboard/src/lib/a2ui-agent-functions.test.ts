import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotebookStore, RunStore, validateViewComponents, notebookLayoutGuide, suaComponentDocs } from '@some-useful-agents/core';
import { answerAgentFunction, surfaceNotebook } from './a2ui-agent-functions.js';

let dir = '';
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });

const call = (surfaceId: string, name: string, args: Record<string, unknown>, id = 'c1') => ({ version: '1.0', callAgentFunction: { functionCallId: id, surfaceId, callFunction: { '@call': name, catalogId: 'sua', args } } });

describe("sua's A2UI agent functions, answered (ADR-0088)", () => {
  it("findOptions searches the page's own notebook, best first; optionFacts gives one option's facts; nothing else", () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-agentfn-'));
    const s = NotebookStore.fromHandle(new RunStore(join(dir, 'runs.db')).databaseHandle());
    const nb = s.create({ title: 'Find jobs' });
    s.setFields(nb.id, [{ key: 'salary', label: 'Salary', type: 'money', role: 'price' }, { key: 'company', label: 'Company', type: 'text', role: 'org' }]);
    const mk = (title: string, salary: number, company: string) => { const e = s.addEntry(nb.id, { kind: 'option', title, by: 'x' }); s.setOptionFacts(nb.id, e.id, { salary, company }); return e; };
    const a = mk('Finance Manager · Omni', 200, 'Omni');
    mk('Senior Financial Analyst · Webflow', 120, 'Webflow');
    const gone = mk('Financial Analyst · Alteryx', 100, 'Alteryx');
    s.ruleOut(nb.id, gone.id, 'closed');
    const other = s.create({ title: 'Other' });

    const found = answerAgentFunction(s, call(`notebook-${nb.id}`, 'findOptions', { q: 'analyst' }))!;
    expect(found.agentFunctionResponse.value).toEqual([expect.objectContaining({ name: expect.stringContaining('Webflow'), company: 'Webflow', page: `/notebooks/${nb.id}/entries/${(found.agentFunctionResponse.value as Array<{ id: string }>)[0].id}` })]);
    expect((answerAgentFunction(s, call(`notebook-${nb.id}-header`, 'findOptions', { q: '', limit: 1 }))!.agentFunctionResponse.value as unknown[])).toHaveLength(1);
    expect(answerAgentFunction(s, call(`notebook-${nb.id}`, 'optionFacts', { id: a.id }))!.agentFunctionResponse.value).toEqual([{ label: 'Salary', value: expect.stringContaining('200') }, { label: 'Company', value: 'Omni' }]);
    // Another notebook's page sees only its own (none); a page that isn't a notebook's, or a function that isn't one, gets an error.
    expect(answerAgentFunction(s, call(`notebook-${other.id}`, 'findOptions', { q: '' }))!.agentFunctionResponse.value).toEqual([]);
    expect(answerAgentFunction(s, call(`notebook-${other.id}`, 'optionFacts', { id: a.id }))!.agentFunctionResponse.error).toMatchObject({ code: 'NOT_FOUND' });
    expect(answerAgentFunction(s, call('board-x', 'findOptions', { q: '' }))!.agentFunctionResponse.error).toMatchObject({ code: 'NOT_FOUND' });
    expect(answerAgentFunction(s, call(`notebook-${nb.id}`, 'deleteEverything', {}))!.agentFunctionResponse.error).toMatchObject({ code: 'NOT_FOUND' });
    expect(answerAgentFunction(s, { nope: 1 })).toBeUndefined();
    expect(surfaceNotebook(s, `notebook-${nb.id}`)?.id).toBe(nb.id);
  });

  it('a page may call them (validated like any function), and the notebook-page guide shows a search box', () => {
    expect(validateViewComponents([{ id: 'root', component: 'Column', children: ['t'] }, { id: 't', component: 'Table', rows: { call: 'findOptions', args: { q: { path: '/form/q' } } }, columns: [{ key: 'name', label: 'Option' }] }]).ok).toBe(true);
    expect(notebookLayoutGuide(suaComponentDocs())).toContain('"rows" { "call": "findOptions"'.replace('"rows" ', 'rows '));
  });
});
