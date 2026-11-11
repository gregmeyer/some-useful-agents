import { describe, it, expect } from 'vitest';
import type { Agent, Notebook, NotebookDraftRecord, NotebookTemplate } from '@some-useful-agents/core';
import { closingQuestion, nextCandidates, notNow, pickNext, NEXT_SHOWN, type NextData, type NextThread } from './home-next.js';

// Home's Next up: a few specific things to do next, picked by code from what you have.

const NOW = Date.parse('2026-11-11T12:00:00Z');
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();
const agent = (id: string, over: Partial<Agent> = {}): Agent => ({ id, name: id.charAt(0).toUpperCase() + id.slice(1), status: 'active', source: 'local', mcp: false, nodes: [], description: `${id} does a thing`, ...over } as Agent);
const nb = (id: string, over: Partial<Notebook> = {}): Notebook => ({ id, title: id, statement: '', params: [], criteria: [], pipeline: [], stages: [], checks: [], fields: [], cadence: '', status: 'active', createdAt: ago(5), updatedAt: ago(2), ...over } as Notebook);
const tpl = (name: string, uses: number, over: Partial<NotebookTemplate> = {}): NotebookTemplate => ({ id: name.toLowerCase().replace(/\s+/g, '-'), name, description: '', setup: { statement: '', subject: 'who' }, uses, createdAt: ago(30), ...over } as NotebookTemplate);
const thread = (id: string, over: Partial<NextThread> = {}): NextThread => ({ id, title: `About ${id}`, at: NOW - 3600_000, source: 'manual', lastRole: 'triage', userSpoke: true, asks: false, question: 'Blue or green?', ...over });
const data = (over: Partial<NextData> = {}): NextData => ({ notebooks: [], templates: [], drafts: [], agents: [], lastRunAt: new Map(), runCounts: new Map(), failures: new Map(), threads: [], dismissed: new Map(), now: NOW, ...over });
const kinds = (d: NextData) => pickNext(d).next.map((x) => `${x.kind}:${x.id.split(':').slice(2).join(':')}`);

describe("Home's Next up", () => {
  it('a notebook you have open whose next step is yours leads; one you picked from but never closed is next', () => {
    const out = pickNext(data({
      notebooks: [
        nb('couch', { title: 'Pick a couch', steps: [{ id: 's1', title: 'Find 5', kind: 'find', status: 'done' }, { id: 's2', title: 'Choose a couch', kind: 'decide', status: 'todo' }] as never }),
        nb('desk', { title: 'Pick a desk' }),
        nb('running', { steps: [{ id: 's1', title: 'Find 5', kind: 'find', status: 'running' }] as never }),
      ],
      chosen: new Set(['desk']),
    }));
    expect(out.next.map((x) => [x.kind, x.title, x.action])).toEqual([
      ['your-step', 'Choose a couch: Pick a couch', { label: 'Open it', href: '/notebooks/couch' }],
      ['your-step', 'Finish Pick a desk', { label: 'Open it', href: '/notebooks/desk' }],
    ]);
    expect(out.next[0].why).toBe('The next step is yours. Last touched 2 days ago.');
  });

  it('never points at an archived notebook: not its step, not its conversation; they only say what you make', () => {
    const archived = Array.from({ length: 4 }, (_, i) => nb(`job-${String(i)}`, {
      title: `Find a remote job ${String(i)}`, archivedAt: ago(1), createdAt: ago(10 + i),
      steps: [{ id: 's', title: 'Choose a job', kind: 'decide', status: 'todo' }] as never,
      tags: { auto: ['remote jobs'], added: [], removed: [] } as never,
    }));
    const out = pickNext(data({ notebooks: archived, chosen: new Set(['job-0']), threads: [thread('t1', { notebookId: 'job-0' })] }));
    expect(out.next.map((x) => x.kind)).toEqual(['start-like']);
    const like = out.next[0];
    expect(like).toMatchObject({ id: 'next:start-like:remote jobs', title: 'Start another on remote jobs', why: "You've made 4 notebooks on remote jobs; the last was 10 days ago." });
    // The latest one is the pattern to set up like, for a subject you name; it isn't reopened.
    expect(like.action).toEqual({ label: 'Start', fill: 'Set up a new notebook like “Find a remote job 0”, for ' });
    expect(JSON.stringify(out)).not.toContain('/notebooks/job-');
    // Fewer than three on a topic isn't a pattern.
    expect(pickNext(data({ notebooks: archived.slice(0, 2) })).next).toEqual([]);
  });

  it('a conversation sua left on a question to you is offered; one it only answered, one waiting on a button, or an old one is not', () => {
    const out = nextCandidates(data({ threads: [
      thread('asked'),
      thread('answered', { question: undefined }),
      thread('card', { asks: true }),
      thread('old', { at: NOW - 20 * 86_400_000 }),
      thread('failure', { source: 'run-failure' }),
      thread('quiet', { userSpoke: false }),
    ] }));
    expect(out.map((x) => x.id)).toEqual(['next:reply:asked']);
    expect(out[0]).toMatchObject({ title: 'About asked', why: 'sua asked today: “Blue or green?”', action: { label: 'Open it', thread: 'asked' } });
    expect(closingQuestion('Here is **what I found**. It has [two](/x) colours. Blue or green?')).toBe('Blue or green?');
    expect(closingQuestion('Done. I updated the notebook.')).toBeUndefined();
  });

  it('your templates, most used first: one that changes each time ends where you say who', () => {
    const out = pickNext(data({ templates: [tpl('Job search', 1, { usedAt: ago(1) }), tpl('Meeting briefing', 2, { usedAt: ago(4) }), tpl('Never used', 0), tpl('Put away', 9, { archivedAt: ago(1) }), tpl('Company briefing', 1, { setup: { statement: '' } as never })] }));
    expect(out.next.map((x) => [x.title, x.why, x.action.fill])).toEqual([
      ['Start a meeting briefing for…', 'Your template, used twice, last 4 days ago.', 'Start a new notebook from my “Meeting briefing” template for '],
      ['Start a job search for…', 'Your template, used once, last yesterday.', 'Start a new notebook from my “Job search” template for '],
    ]);
  });

  it('an agent you use and have not run today: one click when it runs as it is, else Ask sua filled in; not one on a schedule, sua\'s own, or run today', () => {
    const agents = [
      agent('weather', { starred: true }),
      agent('news', { inputs: { CITY: { type: 'string', default: 'Seattle' } } } as never),
      agent('digest', { schedule: '0 7 * * *' }),
      agent('today', {}),
      agent('inbox-triage'),
      agent('needs', { inputs: { URL: { type: 'string' } } } as never),
    ];
    const out = pickNext(data({ agents, lastRunAt: new Map([['weather', ago(3)], ['news', ago(2)], ['digest', ago(2)], ['today', ago(0.2)], ['inbox-triage', ago(2)], ['needs', ago(2)]]), runCounts: new Map([['weather', 6], ['news', 4], ['digest', 30], ['today', 9], ['inbox-triage', 99], ['needs', 5]]) }));
    expect(out.next.map((x) => [x.title, x.action])).toEqual([
      ['Run Weather', { label: 'Run it', post: '/home/try/weather' }],
      ['Run News', { label: 'Run it…', fill: 'Run News with city: Seattle' }],
    ]);
    expect(out.next[0].why).toBe('One you starred: run 6 times this month, last 3 days ago.');
  });

  it('offers a schedule only for one you start by hand a lot (not one other agents call), and agents to try only when there is little else', () => {
    const agents = [agent('search', {}), agent('poem', { description: 'Writes a poem' }), agent('lesson', { description: 'Teaches flow control.' }), agent('demo-thing', { description: 'A demo' })];
    const base = { agents, lastRunAt: new Map([['search', ago(0.1)]]), runCounts: new Map([['search', 300]]) };
    expect(kinds(data({ ...base, handRuns: new Map([['search', 2]]) }))).toEqual(['run-agent:poem', 'run-agent:lesson']);
    const byHand = pickNext(data({ ...base, handRuns: new Map([['search', 12]]) }));
    expect(byHand.next[0]).toMatchObject({ kind: 'schedule-agent', title: 'Put Search on a schedule', why: 'You ran it by hand 12 times this month.' });
    expect(byHand.next[1]).toMatchObject({ title: 'Try Poem', why: 'New to you: Writes a poem' });
    // With three real things to do, nothing untried is offered.
    const full = pickNext(data({ ...base, templates: [tpl('A', 3), tpl('B', 2)], threads: [thread('q')] }));
    expect(full.next.map((x) => x.kind)).toEqual(['reply', 'start-template', 'start-template']);
  });

  it('an agent that keeps failing: the worst is worth a look now, the rest is housekeeping; the odd failure in many runs is not failing', () => {
    const agents = [agent('digest', { schedule: '0 7 * * *' }), agent('firmo'), agent('busy'), agent('once')];
    const out = pickNext(data({ agents, runCounts: new Map([['digest', 24], ['firmo', 12], ['busy', 338], ['once', 3]]), failures: new Map([['digest', 6], ['firmo', 4], ['busy', 4], ['once', 2]]) }));
    expect(out.next[0]).toMatchObject({ kind: 'failing', title: 'Digest keeps failing', why: '6 of its 24 runs failed this month.', action: { label: 'See why…', fill: 'Why does Digest (digest) keep failing, and can you fix it?' } });
    expect(out.tidy.map((x) => x.id)).toEqual(['next:failing:firmo']);
  });

  it('housekeeping: a draft notebook never started, and an agent with a schedule that is still a draft (paused is your call)', () => {
    const drafts = [{ id: 'd1', status: 'ready', text: 'a used car under 12k', draft: { title: 'Buy a used car' }, createdAt: ago(3), updatedAt: ago(3) }, { id: 'd2', status: 'drafting', text: 'x', createdAt: ago(1), updatedAt: ago(1) }] as NotebookDraftRecord[];
    const agents = [agent('trivia', { status: 'draft', schedule: '0 9 * * *' }), agent('paused', { status: 'paused', schedule: '0 9 * * *' }), agent('plain-draft', { status: 'draft' })];
    const out = pickNext(data({ drafts, agents }));
    expect(out.next).toEqual([]);
    expect(out.tidy.map((x) => [x.title, x.action])).toEqual([
      ['Start or drop the draft “Buy a used car”', { label: 'Open the draft', href: '/notebooks/new?draft=d1' }],
      ['Trivia has a schedule but is still a draft', { label: 'Open it', href: '/agents/trivia' }],
    ]);
  });

  it(`shows at most ${String(NEXT_SHOWN)}, at most two of a kind, and "Not now" hides one for a week`, () => {
    const templates = [tpl('A', 5), tpl('B', 4), tpl('C', 3)];
    const threads = [thread('q1'), thread('q2', { at: NOW - 7200_000 }), thread('q3', { at: NOW - 3 * 86_400_000 })];
    const agents = [agent('weather', { starred: true }), agent('digest'), agent('extra', { starred: true })];
    const d = data({ templates, threads, agents, lastRunAt: new Map([['weather', ago(3)], ['extra', ago(4)]]), runCounts: new Map([['weather', 6], ['digest', 10], ['extra', 4]]), failures: new Map([['digest', 5]]) });
    const out = pickNext(d);
    expect(out.next).toHaveLength(NEXT_SHOWN);
    expect(out.next.map((x) => x.kind)).toEqual(['reply', 'reply', 'start-template', 'start-template', 'failing']);
    const later = pickNext({ ...d, dismissed: new Map([['next:reply:q1', new Date(NOW - 86_400_000).toISOString()], ['next:reply:q2', new Date(NOW - 8 * 86_400_000).toISOString()]]) });
    expect(later.next.map((x) => x.id)).not.toContain('next:reply:q1');
    expect(later.next.map((x) => x.id)).toContain('next:reply:q2');
    expect(notNow(new Map([['x', new Date(NOW - 6 * 86_400_000).toISOString()]]), 'x', NOW)).toBe(true);
    // Every item says why from its facts, and has a stable id.
    for (const x of nextCandidates(d)) { expect(x.id).toMatch(/^next:[a-z-]+:.+/); expect(x.why.length).toBeGreaterThan(10); expect(x.facts.length).toBeGreaterThan(0); }
  });
});
