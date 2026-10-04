/**
 * Surfaces (ADR-0049, S2): the one mutation path, the compiler's precedence
 * and reasons, and the versioned store.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunStore } from '../run-store.js';
import type { Item } from '../items/types.js';
import { applySurfaceOps, SurfaceNeedsApproval, SurfaceOpError } from './ops.js';
import { compileSurface, whoWhen } from './compile.js';
import { DEFAULT_HOME_SURFACE, defaultSurface } from './defaults.js';
import { SurfaceStore, SurfaceVersionConflict } from './store.js';
import type { SurfaceDoc } from './schema.js';

const NOW = new Date('2026-10-03T12:00:00Z');
/** Home's regions without its default rules, so each test sets only what it means. */
const home = (): SurfaceDoc => ({ ...structuredClone(DEFAULT_HOME_SURFACE), rules: [] });

let seq = 0;
function item(id: string, over: Partial<Item> = {}): Item {
  seq++;
  return {
    id, kind: 'alert', title: id, urgency: 'normal', state: 'open', subject: {}, actions: [], evidence: [],
    provenance: { source: 'runs', producedBy: 'system', at: `2026-10-03T00:00:${String(seq % 60).padStart(2, '0')}Z` },
    href: '/', ...over,
  };
}
const ids = (doc: SurfaceDoc, items: Item[], region = 'needs-you') =>
  compileSurface(doc, items, { timeZone: 'UTC' }).regions.find((r) => r.id === region)!.entries.map((e) => e.item.id);
/** A doc without who/when stamps, to compare intent. */
const intent = (doc: SurfaceDoc) => JSON.parse(JSON.stringify(doc, (k, v) => (k === 'by' || k === 'at' ? undefined : v))) as unknown;

describe('applySurfaceOps', () => {
  it('stamps what it adds with who and when, and returns a new doc', () => {
    const before = home();
    const after = applySurfaceOps(before, [{ op: 'pin', itemId: 'a' }, { op: 'addRule', rule: { id: 'approvals-first', type: 'promote', match: { kinds: ['decision'] }, label: 'approvals first' } }], 'user', { now: NOW });
    expect(before.overrides).toEqual([]);
    expect(after.overrides).toEqual([{ type: 'pin', itemId: 'a', by: 'user', at: NOW.toISOString() }]);
    expect(after.rules[0]).toMatchObject({ id: 'approvals-first', by: 'user', at: NOW.toISOString() });
  });

  it('a new rule goes first (the latest wins); re-sending a rule edits it in place', () => {
    let doc = applySurfaceOps(home(), [
      { op: 'addRule', rule: { id: 'a', type: 'promote', match: { kinds: ['question'] } } },
      { op: 'addRule', rule: { id: 'b', type: 'promote', match: { kinds: ['alert'] } } },
    ], 'user');
    expect(doc.rules.map((r) => r.id)).toEqual(['b', 'a']);
    doc = applySurfaceOps(doc, [{ op: 'addRule', rule: { id: 'a', type: 'promote', match: { kinds: ['decision'] } } }], 'user');
    expect(doc.rules.map((r) => [r.id, r.match.kinds?.[0]])).toEqual([['b', 'alert'], ['a', 'decision']]);
  });

  it('refuses bad ops with a plain reason', () => {
    expect(() => applySurfaceOps(home(), [{ op: 'explode' }], 'user')).toThrow(SurfaceOpError);
    expect(() => applySurfaceOps(home(), [], 'user')).toThrow('No ops');
    expect(() => applySurfaceOps(home(), [{ op: 'removeRule', ruleId: 'nope' }], 'user')).toThrow("There's no rule \"nope\"");
    expect(() => applySurfaceOps(home(), [{ op: 'pin', itemId: 'a', region: 'nowhere' }], 'user')).toThrow("There's no region \"nowhere\"");
    expect(() => applySurfaceOps(home(), [{ op: 'addRule', rule: { id: 'f', type: 'filter', match: {}, region: 'nowhere' } }], 'user')).toThrow('no region');
    expect(() => applySurfaceOps(home(), [{ op: 'pin', itemId: 'a' }], 'someone')).toThrow();
    const one = applySurfaceOps(home(), [{ op: 'removeRegion', regionId: 'happening' }, { op: 'removeRegion', regionId: 'all-good' }], 'user');
    expect(() => applySurfaceOps(one, [{ op: 'removeRegion', regionId: 'needs-you' }], 'user')).toThrow('at least one region');
  });

  it('keeps one override per meaning: pin clears hide and rank, hide clears pin, expand/collapse replace', () => {
    let doc = applySurfaceOps(home(), [{ op: 'hide', itemId: 'a' }, { op: 'rank', itemId: 'a', position: 2 }], 'user');
    expect(doc.overrides.map((o) => o.type)).toEqual(['rank']);
    doc = applySurfaceOps(doc, [{ op: 'pin', itemId: 'a' }], 'user');
    expect(doc.overrides.map((o) => o.type)).toEqual(['pin']);
    doc = applySurfaceOps(doc, [{ op: 'hide', itemId: 'a' }, { op: 'expand', itemId: 'a' }, { op: 'collapse', itemId: 'a' }], 'user');
    expect(doc.overrides.map((o) => o.type)).toEqual(['hide', 'collapse']);
    doc = applySurfaceOps(doc, [{ op: 'show', itemId: 'a' }], 'user');
    expect(doc.overrides.map((o) => o.type)).toEqual(['collapse']);
  });

  it('an item is in one of your groups at a time; a group left with one item goes', () => {
    let doc = applySurfaceOps(home(), [{ op: 'group', label: 'Mornings', itemIds: ['a', 'b'] }], 'user');
    doc = applySurfaceOps(doc, [{ op: 'group', label: 'Money', itemIds: ['b', 'c'] }], 'user');
    expect(doc.overrides.filter((o) => o.type === 'group').map((o) => o.type === 'group' && o.label)).toEqual(['Money']);
    expect(() => applySurfaceOps(doc, [{ op: 'ungroup', label: 'Mornings' }], 'user')).toThrow("no group");
    expect(applySurfaceOps(doc, [{ op: 'ungroup', label: 'Money' }], 'user').overrides).toEqual([]);
  });

  it('stable anchors: an agent or the system can only propose region changes; you can make them', () => {
    const move = [{ op: 'moveRegion', regionId: 'all-good', index: 0 }];
    expect(() => applySurfaceOps(home(), move, 'agent:news')).toThrow(SurfaceNeedsApproval);
    expect(() => applySurfaceOps(home(), move, 'system')).toThrow(SurfaceNeedsApproval);
    expect(applySurfaceOps(home(), move, 'agent:news', { approved: true }).regions[0].id).toBe('all-good');
    expect(applySurfaceOps(home(), move, 'user-conversation').regions[0].id).toBe('all-good');
    // Within-region changes from an agent go straight through, with its name on them.
    expect(applySurfaceOps(home(), [{ op: 'pin', itemId: 'a' }], 'agent:news').overrides[0]).toMatchObject({ by: 'agent:news' });
  });

  it('the same intent by gesture or through sua makes the same surface', () => {
    const gesture = applySurfaceOps(home(), [{ op: 'rank', itemId: 'thread:1', position: 0 }], 'user', { now: NOW });
    const conversation = applySurfaceOps(home(), [{ op: 'rank', itemId: 'thread:1', position: 0 }], 'user-conversation', { now: new Date('2026-10-04T00:00:00Z') });
    expect(intent(gesture)).toEqual(intent(conversation));
  });

  it('removing a region keeps pins (in their own region now) and drops its filters', () => {
    let doc = applySurfaceOps(home(), [
      { op: 'pin', itemId: 'a', region: 'happening' },
      { op: 'addRule', rule: { id: 'only-builds', type: 'filter', match: { idPrefix: 'board-build:' }, region: 'happening' } },
    ], 'user');
    doc = applySurfaceOps(doc, [{ op: 'removeRegion', regionId: 'happening' }], 'user');
    expect(doc.overrides).toEqual([expect.objectContaining({ type: 'pin', itemId: 'a' })]);
    expect(doc.overrides[0]).not.toHaveProperty('region');
    expect(doc.rules).toEqual([]);
  });
});

describe('compileSurface', () => {
  it('places items by state into the default regions, keeping their own order', () => {
    const items = [item('a'), item('b', { state: 'in-progress' }), item('c', { state: 'ok' }), item('d')];
    const out = compileSurface(home(), items);
    expect(out.regions.map((r) => [r.id, r.entries.map((e) => e.item.id)])).toEqual([['needs-you', ['a', 'd']], ['happening', ['b']], ['all-good', ['c']]]);
    expect(out.regions[0].entries[0].reasons).toEqual(['In Needs you: normal urgency, waiting on you']);
    expect(out.hidden).toEqual([]);
  });

  it('precedence: your pins, then your ranks, then promote rules, then the items\' own order', () => {
    const items = ['a', 'b', 'c', 'd', 'e'].map((id) => item(id, id === 'd' ? { kind: 'decision' } : {}));
    const doc = applySurfaceOps(home(), [
      { op: 'addRule', rule: { id: 'approvals-first', type: 'promote', match: { kinds: ['decision'] }, label: 'approvals first' } },
      { op: 'rank', itemId: 'e', position: 1 },
      { op: 'pin', itemId: 'c' },
    ], 'user', { now: NOW });
    expect(ids(doc, items)).toEqual(['c', 'd', 'e', 'a', 'b']);
    const entries = compileSurface(doc, items, { timeZone: 'UTC' }).regions[0].entries;
    expect(entries[0].reasons).toEqual(['Pinned by you, Oct 3']);
    expect(entries[1].reasons).toEqual(['First because: approvals first (by you, Oct 3)']);
    expect(entries[2].reasons).toEqual(['Placed here by you, Oct 3']);
  });

  it('a pin can move an item into another region', () => {
    const doc = applySurfaceOps(home(), [{ op: 'pin', itemId: 's', region: 'needs-you' }], 'user');
    const out = compileSurface(doc, [item('a'), item('s', { state: 'ok', kind: 'status' })]);
    expect(out.regions[0].entries.map((e) => e.item.id)).toEqual(['s', 'a']);
    expect(out.regions[2].entries).toEqual([]);
  });

  it('says why something is hidden', () => {
    const doc = applySurfaceOps(home(), [
      { op: 'hide', itemId: 'a' },
      { op: 'addRule', rule: { id: 'no-drafts', type: 'hide', match: { idPrefix: 'agent:', kinds: ['decision'] }, label: 'no drafts here' } },
      { op: 'addRule', rule: { id: 'urgent-only', type: 'filter', match: { urgencies: ['high', 'critical'] }, region: 'needs-you', label: 'only urgent' } },
      { op: 'removeRegion', regionId: 'all-good' },
    ], 'user', { now: NOW });
    const out = compileSurface(doc, [item('a'), item('agent:x:draft', { kind: 'decision' }), item('b'), item('c', { urgency: 'high' }), item('s', { state: 'ok' })], { timeZone: 'UTC' });
    expect(out.regions[0].entries.map((e) => e.item.id)).toEqual(['c']);
    expect(out.hidden.map(({ itemId, reason, by }) => ({ itemId, reason, by }))).toEqual([
      { itemId: 'a', reason: 'Hidden by you, Oct 3', by: { override: true } },
      { itemId: 'agent:x:draft', reason: 'Hidden by the rule "no drafts here" (by you, Oct 3)', by: { ruleId: 'no-drafts' } },
      { itemId: 'b', reason: 'Not shown in Needs you: it doesn\'t match "only urgent"', by: undefined },
      { itemId: 's', reason: 'No region shows this kind of item', by: undefined },
    ]);
    expect(out.hidden[0].item?.id).toBe('a');
  });

  it('groups gather at the first member; yours win over rules; a one-item group dissolves', () => {
    const items = [item('a', { subject: { agentId: 'news' } }), item('b'), item('c', { subject: { agentId: 'news' } }), item('d', { subject: { agentId: 'jobs' } }), item('e')];
    const doc = applySurfaceOps(home(), [
      { op: 'addRule', rule: { id: 'by-agent-all', type: 'group', match: {}, groupBy: 'agent' } },
      { op: 'group', label: 'Later', itemIds: ['e', 'b'] },
    ], 'user');
    const entries = compileSurface(doc, items).regions[0].entries;
    expect(entries.map((e) => [e.item.id, e.group ?? null])).toEqual([['a', 'news'], ['c', 'news'], ['b', 'Later'], ['e', 'Later'], ['d', null]]);
    expect(entries[2].reasons).toContain('In your group "Later"');
  });

  it('folds by rule unless you expand; draws by the last matching represent rule', () => {
    const doc = applySurfaceOps(home(), [
      { op: 'addRule', rule: { id: 'fold-low', type: 'collapse', match: { urgencies: ['low'] }, label: 'low stays folded' } },
      { op: 'expand', itemId: 'b' },
      { op: 'collapse', itemId: 'c' },
      { op: 'represent', match: { kinds: ['alert'] }, primitive: 'card' },
      { op: 'represent', match: { itemIds: ['c'] }, primitive: 'evidence' },
    ], 'user');
    const entries = compileSurface(doc, [item('a', { urgency: 'low' }), item('b', { urgency: 'low' }), item('c'), item('m', { kind: 'metric' })]).regions[0].entries;
    expect(entries.map((e) => [e.item.id, e.collapsed, e.primitive])).toEqual([['a', true, 'card'], ['b', false, 'card'], ['c', true, 'evidence'], ['m', false, 'metric']]);
    expect(entries[0].reasons).toContain('Folded by "low stays folded"');
  });

  it('a region limit counts the rest as "more"; pins are never cut', () => {
    const doc: SurfaceDoc = { ...home(), regions: [{ id: 'needs-you', title: 'Needs you', match: {}, limit: 2 }] };
    const pinned = applySurfaceOps(doc, [{ op: 'pin', itemId: 'd' }, { op: 'pin', itemId: 'e' }, { op: 'pin', itemId: 'c' }], 'user');
    const items = ['a', 'b', 'c', 'd', 'e'].map((id) => item(id));
    expect(compileSurface(doc, items).regions[0]).toMatchObject({ more: 3 });
    const out = compileSurface(pinned, items).regions[0];
    expect(out.entries.map((e) => e.item.id)).toEqual(['d', 'e', 'c']);
    expect(out.more).toBe(2);
  });

  it('is deterministic', () => {
    const doc = applySurfaceOps(home(), [{ op: 'addRule', rule: { id: 'g', type: 'group', match: {}, groupBy: 'kind' } }], 'user', { now: NOW });
    const items = [item('a', { kind: 'question' }), item('b'), item('c', { kind: 'question' }), item('d')];
    expect(compileSurface(doc, items)).toEqual(compileSurface(structuredClone(doc), structuredClone(items)));
  });

  it('Home by default: questions and approvals first, drafts folded together', () => {
    const items = [
      item('agent:x:failing', { urgency: 'high' }),
      item('agent:d1:draft', { kind: 'decision', urgency: 'low' }),
      item('thread:q', { kind: 'question' }),
      item('agent:d2:draft', { kind: 'decision', urgency: 'low' }),
    ];
    const entries = compileSurface(DEFAULT_HOME_SURFACE, items).regions[0].entries;
    expect(entries.map((e) => [e.item.id, e.group ?? null, e.collapsed])).toEqual([
      ['thread:q', null, false], ['agent:x:failing', null, false], ['agent:d1:draft', 'Decisions', true], ['agent:d2:draft', 'Decisions', true],
    ]);
    expect(entries[0].reasons[0]).toBe('First because: questions and approvals first (by default)');
  });

  it('whoWhen says who in plain words', () => {
    expect(whoWhen()).toBe('by default');
    expect(whoWhen('system')).toBe('by sua');
    expect(whoWhen('agent:news', '2026-10-03T00:00:00Z', 'UTC')).toBe('by agent news, Oct 3');
    expect(whoWhen('user-conversation')).toBe('by you, through sua');
  });
});

describe('SurfaceStore', () => {
  let dir: string;
  let runs: RunStore;
  afterEach(() => {
    try { runs?.close(); } catch { /* ignore */ }
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('versions every change with who and why, refuses stale writes, and undoes by restoring', () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-surfaces-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const store = SurfaceStore.fromHandle(runs.databaseHandle());

    expect(store.current('home')).toMatchObject({ version: 0, actor: 'default', doc: defaultSurface('home') });
    const v1 = store.apply('home', [{ op: 'pin', itemId: 'thread:1' }], 'user', 'Keep the tax thread on top', { expectedVersion: 0, now: NOW });
    expect(v1).toMatchObject({ version: 1, actor: 'user', reason: 'Keep the tax thread on top' });
    const v2 = store.apply('home', [{ op: 'setGoal', goal: 'Only today' }], 'user-conversation', 'You asked sua to focus on today');
    expect(v2.version).toBe(2);
    expect(() => store.apply('home', [{ op: 'hide', itemId: 'x' }], 'user', 'late', { expectedVersion: 1 })).toThrow(SurfaceVersionConflict);
    expect(() => store.apply('home', [{ op: 'removeRegion', regionId: 'all-good' }], 'agent:tidy', 'tidier')).toThrow(SurfaceNeedsApproval);
    expect(store.current('home').version).toBe(2);

    const v3 = store.restore('home', 1, 'user');
    expect(v3).toMatchObject({ version: 3, reason: 'Back to v1' });
    expect(store.current('home').doc).toEqual(v1.doc);
    expect(store.history('home').map((v) => [v.version, v.actor])).toEqual([[3, 'user'], [2, 'user-conversation'], [1, 'user']]);
    expect(store.get('home', 1)?.ops).toEqual([{ op: 'pin', itemId: 'thread:1' }]);

    // A second store on the same file sees the same history; other surfaces are separate.
    const again = new SurfaceStore(join(dir, 'runs.db'));
    expect(again.current('home').version).toBe(3);
    expect(again.current('notebook:taxes')).toMatchObject({ version: 0, doc: { regions: [{ id: 'main' }] } });
  });
});
