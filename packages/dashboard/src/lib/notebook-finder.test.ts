import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { parseAgent, SYSTEM_AGENT_IDS } from '@some-useful-agents/core';

// sua's finder splits a find step into a few narrow searches run at once,
// then files what they found with code (no model between the searches and
// the notebook). These run that code on what the searches might return.

const root = join(__dirname, '../../../..');
const agent = (id: string) => parseAgent(readFileSync(join(root, 'agents/examples', `${id}.yaml`), 'utf8'));

function merge(env: Record<string, string>): { line: string; block: { entries: Array<Record<string, unknown>>; sources: Array<Record<string, unknown>> } } {
  const cmd = agent('notebook-finder').nodes.find((n) => n.id === 'merge')!.command!;
  const out = execFileSync('sh', ['-c', cmd], { env: { PATH: process.env.PATH ?? '', ...env }, encoding: 'utf8' });
  const m = /<notebook>([\s\S]*)<\/notebook>/.exec(out)!;
  return { line: out.split('\n')[0], block: JSON.parse(m[1]) };
}

const PLAN = 'One search per board.\n' + JSON.stringify({ searches: ['Greenhouse', 'Lever', 'Ashby', 'Workday'].map((where) => ({ where, query: `q ${where}`, why: 'x' })) });
const FIELDS = JSON.stringify([
  { key: 'salary', label: 'Salary', type: 'money', role: 'price' },
  { key: 'company', label: 'Company', type: 'text', role: 'org' },
  { key: 'posting_url', label: 'Posting', type: 'url', role: 'link' },
]);

describe('notebook-finder', () => {
  it('is sua’s own: a plan, the searches three at a time, and code that files them', () => {
    const finder = agent('notebook-finder');
    expect(finder.nodes.map((n) => `${n.id}:${n.type}`)).toEqual(['have:shell', 'plan:llm-prompt', 'search:loop', 'merge:shell']);
    expect(finder.nodes.find((n) => n.id === 'search')!.loopConfig).toMatchObject({ agentId: 'notebook-find-one', concurrency: 3, over: 'searches' });
    const one = agent('notebook-find-one');
    expect(one.nodes[0]).toMatchObject({ type: 'llm-prompt', maxTurns: 8, tools: ['web-search', 'web-fetch', 'web-scrape'] });
    // Never offered as one of your agents (the drafter's list, catalogs).
    expect(SYSTEM_AGENT_IDS.has('notebook-finder') && SYSTEM_AGENT_IDS.has('notebook-find-one')).toBe(true);
  });

  it('files one option per page with facts by field key, skips what it has, and says which searches found nothing', () => {
    const items = [
      { where: 'Greenhouse', candidates: [
        { title: 'Controller, Acme: Remote US, $190k–$220k', url: 'https://job-boards.greenhouse.io/acme/jobs/1?gh_src=x', facts: { salary: { min: 190000, max: 220000 }, company: 'Acme', made_up: 'x' }, quote: 'Lead a team of 6 across tax and accounting.', why: 'leads the team' },
        { title: 'Director of Accounting, Hooli: Austin', url: 'https://job-boards.greenhouse.io/hooli/jobs/2', facts: { company: 'Hooli' } },
      ], note: 'opened 3 postings' },
      // Out of turns, it answered with words around its JSON.
      'I ran out of turns. ' + JSON.stringify({ where: 'Lever', candidates: [
        { title: 'Controller, Acme (again)', url: 'https://job-boards.greenhouse.io/acme/jobs/1' },
        { title: 'Controller, Old Co', url: 'https://jobs.lever.co/oldco/9' },
      ], note: 'partial' }),
      null,
      { where: 'Workday', candidates: [], note: 'nothing in Austin' },
    ];
    const { line, block } = merge({
      UPSTREAM_PLAN_RESULT: PLAN,
      UPSTREAM_SEARCH_RESULT: JSON.stringify({ items, count: items.length }),
      FIELDS,
      OPTIONS: JSON.stringify([{ id: '1', name: 'Controller, Old Co', sources: ['https://jobs.lever.co/oldco/9'] }]),
    });
    const options = block.entries.filter((e) => e.kind === 'option');
    expect(options.map((e) => e.title)).toEqual(['Controller, Acme: Remote US, $190k–$220k', 'Director of Accounting, Hooli: Austin']);
    expect(options[0]).toMatchObject({
      data: { salary: { min: 190000, max: 220000 }, company: 'Acme', posting_url: 'https://job-boards.greenhouse.io/acme/jobs/1?gh_src=x' },
      fingerprint: 'https://job-boards.greenhouse.io/acme/jobs/1?gh_src=x',
      body: 'leads the team. "Lead a team of 6 across tax and accounting." (found by the Greenhouse search)',
    });
    expect((options[0].data as Record<string, unknown>).made_up).toBeUndefined();
    expect(block.sources).toEqual([
      { name: 'Greenhouse', found: 2, status: 'found', note: 'opened 3 postings' },
      { name: 'Lever', found: 0, status: 'none', note: 'partial' },
      { name: 'Ashby', found: 0, status: 'blocked', note: "The search didn't finish." },
      { name: 'Workday', found: 0, status: 'none', note: 'nothing in Austin' },
    ]);
    expect(block.entries.at(-1)).toEqual({ kind: 'note', title: "Searched 4 places at once: Greenhouse (2), Lever (0), Ashby (0), Workday (0). Nothing new from Lever, Workday. Ashby didn't finish. 1 was already in the notebook." });
    expect(line).toBe("2 new options from 4 searches run at once. Nothing new from Lever, Workday. Ashby didn't finish. 1 was already in the notebook.");
  });

  it('cuts a long title at a word', () => {
    const long = 'Controller at Attivo Partners (remote fractional CFO and accounting firm), $170k–$200k plus 10% bonus, manages accounting staff';
    const { block } = merge({ UPSTREAM_PLAN_RESULT: PLAN, UPSTREAM_SEARCH_RESULT: JSON.stringify({ items: [{ candidates: [{ title: long, url: 'https://x.example/1' }] }] }), FIELDS: '[]', OPTIONS: '[]' });
    const title = block.entries[0].title as string;
    expect(title.length).toBeLessThanOrEqual(120);
    expect(title).toBe('Controller at Attivo Partners (remote fractional CFO and accounting firm), $170k–$200k plus 10% bonus, manages…');
  });

  it('with nothing found, it still notes where it looked', () => {
    const { block } = merge({ UPSTREAM_PLAN_RESULT: PLAN, UPSTREAM_SEARCH_RESULT: JSON.stringify({ items: [null, null], count: 2 }), FIELDS: '[]', OPTIONS: '[]' });
    expect(block.entries).toEqual([{ kind: 'note', title: "Searched 2 places at once: Greenhouse (0), Lever (0). Greenhouse, Lever didn't finish." }]);
  });
});
