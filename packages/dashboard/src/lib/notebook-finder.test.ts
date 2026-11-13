import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { parseAgent, SYSTEM_AGENT_IDS, withShellHelpers } from '@some-useful-agents/core';

// sua's finder splits a find step into a few narrow searches run at once,
// then files what they found with code (no model between the searches and
// the notebook). These run that code on what the searches might return.

const root = join(__dirname, '../../../..');
const agent = (id: string) => parseAgent(readFileSync(join(root, 'agents/examples', `${id}.yaml`), 'utf8'));

function merge(env: Record<string, string>): { line: string; block: { entries: Array<Record<string, unknown>>; sources: Array<Record<string, unknown>> } } {
  const cmd = agent('notebook-finder').nodes.find((n) => n.id === 'merge')!.command!;
  const out = execFileSync('sh', ['-c', cmd], { env: withShellHelpers({ PATH: process.env.PATH ?? '', ...env }), encoding: 'utf8' });
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
    expect(finder.nodes.map((n) => `${n.id}:${n.type}`)).toEqual(['have:shell', 'plan:llm-prompt', 'vet:shell', 'search:loop', 'merge:shell']);
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
      UPSTREAM_VET_RESULT: PLAN,
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

  it('files a near miss ruled out, saying which limit it misses', () => {
    const items = [
      { where: 'OfferUp', candidates: [], near: [
        { title: '2008 Outback Sport, Everett', url: 'https://offerup.example/item/1', facts: { salary: 4500 }, misses: '62 miles away; the limit is 50' },
        { title: 'No reason given', url: 'https://offerup.example/item/2' },
      ], note: 'opened 3' },
      { where: 'Cars.com', candidates: [{ title: '2005 WRX wagon', url: 'https://cars.example/1' }] },
    ];
    const plan = JSON.stringify({ searches: [{ where: 'OfferUp' }, { where: 'Cars.com' }] });
    const { line, block } = merge({ UPSTREAM_VET_RESULT: plan, UPSTREAM_SEARCH_RESULT: JSON.stringify({ items }), FIELDS, OPTIONS: '[]' });
    const options = block.entries.filter((e) => e.kind === 'option');
    // The one that fits comes first; a "near" one with no limit named is dropped.
    expect(options.map((e) => e.title)).toEqual(['2005 WRX wagon', '2008 Outback Sport, Everett']);
    expect(options[0].ruleOut).toBeUndefined();
    expect(options[1]).toMatchObject({ ruleOut: 'Just outside the limits: 62 miles away; the limit is 50', data: { salary: 4500 } });
    expect(block.sources[0]).toMatchObject({ name: 'OfferUp', found: 0, near: 1 });
    expect(line).toBe('1 new option from 2 searches run at once. 1 just outside the limits is filed ruled out, with the limit it misses.');
  });

  it('files what a learn search found as evidence with its source, not options, and counts it', () => {
    const plan = JSON.stringify({ searches: [{ where: 'Bank CDs' }, { where: 'Ladder guidance', kind: 'learn' }] });
    const items = [
      { where: 'Bank CDs', candidates: [{ title: 'Example Bank 12-month CD, 4.40% APY', url: 'https://bank.example/cd12' }] },
      'Out of turns. ' + JSON.stringify({ where: 'Ladder guidance', learned: [
        { title: 'CD ladders explained', url: 'https://regulator.example/cd-ladders', quote: 'A ladder staggers maturity dates.', takeaway: 'A CD ladder staggers maturities so part of the money comes due each year.' },
        { title: 'Same page again', url: 'https://www.regulator.example/cd-ladders/', takeaway: 'A repeat' },
        { title: 'No page', takeaway: 'Nothing to cite' },
      ], note: 'opened 2 guides' }),
    ];
    const { line, block } = merge({ UPSTREAM_VET_RESULT: plan, UPSTREAM_SEARCH_RESULT: JSON.stringify({ items }), FIELDS: '[]', OPTIONS: '[]' });
    expect(block.entries.filter((e) => e.kind === 'option').map((e) => e.title)).toEqual(['Example Bank 12-month CD, 4.40% APY']);
    expect(block.entries.filter((e) => e.kind === 'evidence')).toEqual([{
      kind: 'evidence', title: 'A CD ladder staggers maturities so part of the money comes due each year.',
      body: '"A ladder staggers maturity dates." CD ladders explained (found by the Ladder guidance search)', fingerprint: 'https://regulator.example/cd-ladders',
    }]);
    expect(block.sources[1]).toEqual({ name: 'Ladder guidance', found: 1, status: 'found', note: 'opened 2 guides' });
    expect(line).toBe('1 new option and 1 source that explains from 2 searches run at once.');
  });

  it('cuts a long title at a word', () => {
    const long = 'Controller at Attivo Partners (remote fractional CFO and accounting firm), $170k–$200k plus 10% bonus, manages accounting staff';
    const { block } = merge({ UPSTREAM_VET_RESULT: PLAN, UPSTREAM_SEARCH_RESULT: JSON.stringify({ items: [{ candidates: [{ title: long, url: 'https://x.example/1' }] }] }), FIELDS: '[]', OPTIONS: '[]' });
    const title = block.entries[0].title as string;
    expect(title.length).toBeLessThanOrEqual(120);
    expect(title).toBe('Controller at Attivo Partners (remote fractional CFO and accounting firm), $170k–$200k plus 10% bonus, manages…');
  });

  it('with nothing found, it still notes where it looked', () => {
    const { block } = merge({ UPSTREAM_VET_RESULT: PLAN, UPSTREAM_SEARCH_RESULT: JSON.stringify({ items: [null, null], count: 2 }), FIELDS: '[]', OPTIONS: '[]' });
    expect(block.entries).toEqual([{ kind: 'note', title: "Searched 2 places at once: Greenhouse (0), Lever (0). Greenhouse, Lever didn't finish." }]);
  });
});

// A search once ran for "jobs matched to my LinkedIn profile" with no profile
// in the notebook: the plan carried blanks, and the searchers made a profile
// up. Code now vets the plan before any search runs.
describe('notebook-finder vets its plan', () => {
  const finder = agent('notebook-finder');
  function vet(plan: string): { searches: unknown[]; needs?: string } {
    const cmd = finder.nodes.find((n) => n.id === 'vet')!.command!;
    const out = execFileSync('sh', ['-c', cmd], { env: withShellHelpers({ PATH: process.env.PATH ?? '', UPSTREAM_PLAN_RESULT: plan }), encoding: 'utf8' });
    return JSON.parse(out.trim());
  }
  const plan = (o: unknown) => `How I split it.\n${JSON.stringify(o)}`;

  it('runs between the plan and the searches, and the searches and merge read it', () => {
    expect(finder.nodes.map((n) => `${n.id}:${n.type}`)).toEqual(['have:shell', 'plan:llm-prompt', 'vet:shell', 'search:loop', 'merge:shell']);
    expect(finder.nodes.find((n) => n.id === 'search')!.dependsOn).toEqual(['vet']);
    expect(finder.nodes.find((n) => n.id === 'merge')!.dependsOn).toEqual(['vet', 'search']);
    const prompt = finder.nodes.find((n) => n.id === 'plan')!.prompt!;
    expect(prompt).toContain('Use ONLY what is written above.');
    expect(prompt).toContain('{"needs":"what is missing, in a few plain words","searches":[]}');
    expect(agent('notebook-find-one').nodes[0].prompt).toContain('Never use anything else you know or can find about the person');
  });

  it('passes a plan with real queries as it is', () => {
    const searches = [{ where: 'Greenhouse', query: 'site:job-boards.greenhouse.io "controller" "Austin" OR remote', why: 'x' }, { where: 'Open web', query: '"director of accounting" Austin careers apply', why: 'y' }];
    expect(vet(plan({ searches }))).toEqual({ searches });
  });

  it('refuses the whole plan when a query carries a blank, and says which', () => {
    const out = vet(plan({ searches: [
      { where: 'Greenhouse', query: 'site:job-boards.greenhouse.io "[profile target role]" "[profile location]"', why: 'x' },
      { where: 'Guides', query: 'how to weigh job offers', why: 'y', kind: 'learn' },
    ] }));
    expect(out.searches).toEqual([]);
    expect(out.needs).toBe('what [profile target role], [profile location] stand for');
    for (const q of ['"<role>" Austin', 'jobs for {title} in Austin', 'TBD accounting jobs', '   ']) {
      expect(vet(plan({ searches: [{ where: 'Web', query: q }] })).searches).toEqual([]);
    }
  });

  it('takes the plan at its word when it says what is missing', () => {
    expect(vet(plan({ needs: 'the LinkedIn profile it should match', searches: [] }))).toEqual({ searches: [], needs: 'the LinkedIn profile it should match' });
    // Even beside searches it wrote anyway.
    expect(vet(plan({ needs: 'your résumé', searches: [{ where: 'Web', query: 'jobs' }] }))).toEqual({ searches: [], needs: 'your résumé' });
  });

  it('merge then files nothing and says what the search needs', () => {
    const { line, block } = merge({ UPSTREAM_VET_RESULT: JSON.stringify({ searches: [], needs: 'the LinkedIn profile it should match' }), UPSTREAM_SEARCH_RESULT: JSON.stringify({ items: [], count: 0 }), FIELDS, OPTIONS: '[]' });
    expect(line).toBe("Nothing was searched: the search needs the LinkedIn profile it should match, and the notebook doesn't have it.");
    expect(block).toMatchObject({ entries: [], sources: [], needs: 'the LinkedIn profile it should match' });
  });
});
