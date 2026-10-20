import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { parseAgent, SYSTEM_AGENT_IDS, withShellHelpers } from '@some-useful-agents/core';

// research-fanout's code steps: the list as given, what each item is told,
// and the merge that says which didn't finish. These run that code on what
// the inputs and the research might be.

const root = join(__dirname, '../../../..');
const agent = (id: string) => parseAgent(readFileSync(join(root, 'agents/examples', `${id}.yaml`), 'utf8'));
const run = (agentId: string, nodeId: string, env: Record<string, string>) => {
  const cmd = agent(agentId).nodes.find((n) => n.id === nodeId)!.command!;
  const out = execFileSync('sh', ['-c', cmd], { env: withShellHelpers({ PATH: process.env.PATH ?? '', ...env }), encoding: 'utf8' });
  return JSON.parse(out.trim().split('\n').at(-1)!) as Record<string, any>;
};

describe('research-fanout', () => {
  it('reads a list as lines, commas (not inside parentheses) or JSON; dedupes and caps it', () => {
    expect(run('research-fanout', 'items', { ITEMS: 'Ramp (ramp.com, fintech), Brex, ramp (ramp.com, fintech)' }))
      .toEqual({ ok: true, need_plan: false, items: [{ subject: 'Ramp (ramp.com, fintech)', hint: '' }, { subject: 'Brex', hint: '' }], skipped: [] });
    expect(run('research-fanout', 'items', { ITEMS: '1. Acme\n- Globex\n\nInitech', MAX_ITEMS: '2' }))
      .toMatchObject({ items: [{ subject: 'Acme' }, { subject: 'Globex' }], skipped: ['Initech'] });
    expect(run('research-fanout', 'items', { ITEMS: JSON.stringify([{ subject: 'Runway', hint: 'the planning software at runway.com' }, 'Mercury']) }).items)
      .toEqual([{ subject: 'Runway', hint: 'the planning software at runway.com' }, { subject: 'Mercury', hint: '' }]);
    // Nothing given: the plan splits the goal.
    expect(run('research-fanout', 'items', { ITEMS: '' })).toMatchObject({ need_plan: true, items: [] });
  });

  it('gives each item the goal, the shared limits and its own hint; with no list, the plan\'s angles', () => {
    const given = run('research-fanout', 'items', { ITEMS: JSON.stringify([{ subject: 'Runway', hint: 'runway.com' }]) });
    const picked = run('research-fanout', 'pick', { UPSTREAM_ITEMS_RESULT: JSON.stringify(given), GOAL: 'Firmographics for a lead list', CONTEXT: 'US companies' });
    expect(picked.items[0].context).toBe('Part of: Firmographics for a lead list. US companies About this one: runway.com');
    const planned = run('research-fanout', 'pick', {
      UPSTREAM_ITEMS_RESULT: JSON.stringify({ ok: true, need_plan: true, items: [], skipped: [] }),
      UPSTREAM_PLAN_RESULT: 'Split by angle.\n' + JSON.stringify({ items: [{ subject: 'Evidence for', hint: 'studies' }, { subject: 'The case against' }] }),
    });
    expect(planned.items.map((i: { subject: string }) => i.subject)).toEqual(['Evidence for', 'The case against']);
  });

  it('keeps the order, marks a failed or empty one "didn\'t finish", and says so in the headline', () => {
    const items = [{ subject: 'Ramp' }, { subject: 'Brex' }, { subject: 'Mercury' }];
    const ramp = { subject: 'Ramp', found: { employees: { value: 1200, source: 'https://ramp.com/about', quote: '1,200 people' } }, not_found: ['revenue'], summary: 'A spend platform.', note: 'opened 2' };
    const out = run('research-fanout', 'merge', {
      UPSTREAM_PICK_RESULT: JSON.stringify({ items, skipped: ['Initech'] }),
      // Sub-run answers come as objects or as JSON text; a failed one is null.
      UPSTREAM_RESEARCH_RESULT: JSON.stringify([JSON.stringify(ramp), null, { subject: 'Mercury', found: {}, not_found: ['employees'], summary: '', note: 'nothing' }]),
    });
    expect(out.results.map((r: { subject: string; status: string }) => `${r.subject}:${r.status}`)).toEqual(['Ramp:done', "Brex:didn't finish", "Mercury:didn't finish"]);
    expect(out.results[0].found.employees.value).toBe(1200);
    expect(out.unfinished).toEqual(['Brex', 'Mercury']);
    expect(out.headline).toBe("1 of 3 researched; Brex, Mercury didn't finish; 1 skipped (over the limit).");
  });

  it('research-one keeps only asked keys with real sources, and lists the rest as not found', () => {
    const ask = JSON.stringify([{ key: 'employees', label: 'Employees' }, { key: 'hq', label: 'HQ' }, { key: 'revenue', label: 'Revenue' }]);
    const reply = 'Here it is: ' + JSON.stringify({ subject: 'Ramp', found: { employees: { value: 1200, source: 'https://ramp.com/about', quote: '1,200 people' }, hq: { value: 'New York', source: 'search results' }, made_up: { value: 1 } }, not_found: ['revenue'], summary: 'A spend platform.' });
    const out = run('research-one', 'clean', { SUBJECT: 'Ramp', ASK: ask, UPSTREAM_RESEARCH_RESULT: reply });
    expect(out.found).toEqual({ employees: { value: 1200, source: 'https://ramp.com/about', quote: '1,200 people' }, hq: { value: 'New York' } });
    expect(out.not_found).toEqual(['revenue']);
    expect(SYSTEM_AGENT_IDS.has('research-one')).toBe(true);
  });
});
