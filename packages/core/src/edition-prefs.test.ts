import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { EMPTY_EDITION_PREFS, EditionOpError, EditionPrefsStore, applyEditionOps, describeEditionOp, editionPrefsSet } from './edition-prefs.js';

// How you want Today's edition: preferences its generator follows, changed only by checked ops.

const known = new Set(['hn', 'digest', 'markets', 'routine']);
const apply = (ops: unknown[], from = EMPTY_EDITION_PREFS) => applyEditionOps(from, ops, known);

describe("the edition's preferences", () => {
  it('each op changes one thing, and they keep each other consistent', () => {
    let p = apply([{ op: 'lead', agentId: 'hn' }, { op: 'hide', agentId: 'routine' }, { op: 'include', agentId: 'digest' }, { op: 'width', agentId: 'markets', width: 'wide' }, { op: 'numbers', on: false }, { op: 'top-story', agentId: 'hn' }, { op: 'note', text: '  Scores are\nfrom 8am ' }]);
    expect(p).toEqual({ lead: 'hn', hidden: ['routine'], include: ['digest'], wide: ['markets'], narrow: [], numbers: false, topStory: 'hn', note: 'Scores are from 8am' });
    expect(editionPrefsSet(p)).toBe(true);
    // Leaving out the one that leads and gives the top item drops both; leading with one that was left out brings it back.
    p = apply([{ op: 'hide', agentId: 'hn' }], p);
    expect(p).toMatchObject({ hidden: ['routine', 'hn'] });
    expect(p.lead).toBeUndefined();
    expect(p.topStory).toBeUndefined();
    p = apply([{ op: 'lead', agentId: 'routine' }], p);
    expect(p).toMatchObject({ lead: 'routine', hidden: ['hn'] });
    // A width replaces the other; auto clears; numbers on and an empty note clear; lead null lets the day decide.
    p = apply([{ op: 'width', agentId: 'markets', width: 'narrow' }, { op: 'numbers', on: true }, { op: 'note', text: ' ' }, { op: 'lead', agentId: null }, { op: 'show', agentId: 'hn' }], p);
    expect(p).toEqual({ hidden: [], include: ['digest'], wide: [], narrow: ['markets'] });
    expect(apply([{ op: 'width', agentId: 'markets', width: 'auto' }, { op: 'hide', agentId: 'digest' }], p)).toEqual({ hidden: ['digest'], include: [], wide: [], narrow: [] });
    expect(apply([{ op: 'reset' }], p)).toEqual(EMPTY_EDITION_PREFS);
    expect(editionPrefsSet(EMPTY_EDITION_PREFS)).toBe(false);
  });

  it('refuses an agent that has nothing to show, an op it does not know, and nothing at all; the preferences are untouched', () => {
    expect(() => apply([{ op: 'lead', agentId: 'made-up' }])).toThrow(EditionOpError);
    expect(() => apply([{ op: 'hide', agentId: 'hn' }, { op: 'paint', agentId: 'hn' }])).toThrow(/Change 2/);
    expect(() => apply([])).toThrow('Nothing to change.');
    expect(() => apply([{ op: 'note', text: 'x'.repeat(201) }])).toThrow(EditionOpError);
  });

  it('says each op in plain words', () => {
    const t = (id: string) => id.toUpperCase();
    expect([{ op: 'lead', agentId: 'hn' }, { op: 'hide', agentId: 'hn' }, { op: 'include', agentId: 'hn' }, { op: 'width', agentId: 'hn', width: 'wide' }, { op: 'numbers', on: false }, { op: 'top-story', agentId: 'hn' }, { op: 'reset' }].map((op) => describeEditionOp(op as never, t))).toEqual([
      'Lead with HN', 'Leave out HN', 'Always show HN', 'Put HN in the wide column', 'Drop the numbers band', 'Show the top item of HN under the headline', 'Back to the automatic edition',
    ]);
  });
});

describe('kept, with one step of Undo', () => {
  let db: DatabaseSync;
  beforeEach(() => { db = new DatabaseSync(':memory:'); });
  afterEach(() => { db.close(); });

  it('starts empty; a save can be undone, and undone again', () => {
    const store = new EditionPrefsStore(db);
    expect(store.get()).toEqual(EMPTY_EDITION_PREFS);
    expect(store.canUndo()).toBe(false);
    expect(store.undo()).toBeUndefined();
    store.save(apply([{ op: 'lead', agentId: 'hn' }]));
    expect(store.get().lead).toBe('hn');
    expect(store.canUndo()).toBe(true);
    store.save(apply([{ op: 'hide', agentId: 'routine' }], store.get()));
    expect(store.get()).toMatchObject({ lead: 'hn', hidden: ['routine'] });
    expect(store.undo()).toMatchObject({ lead: 'hn', hidden: [] });
    expect(store.undo()).toMatchObject({ lead: 'hn', hidden: ['routine'] });
  });
});
