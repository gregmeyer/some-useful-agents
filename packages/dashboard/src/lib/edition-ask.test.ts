import { describe, it, expect } from 'vitest';
import { EMPTY_EDITION_PREFS } from '@some-useful-agents/core';
import { parseEditionAnswer } from './edition-ask.js';

// Changing Today's edition by asking: sua proposes ops, code checks them against what exists.

const known = new Set(['hn', 'digest', 'routine']);
const title = (id: string) => ({ hn: 'HN Digest', digest: 'Job Digest', routine: 'Evening Routine' } as Record<string, string>)[id] ?? id;
const answer = (v: unknown) => `<edition>${JSON.stringify(v)}</edition>`;
const parse = (raw: string | undefined) => parseEditionAnswer(raw, EMPTY_EDITION_PREFS, known, title);

describe("what sua works out from an ask about the edition", () => {
  it('ops that the edition takes and that name real agents become changes in plain words, with its line', () => {
    expect(parse(answer({ ops: [{ op: 'lead', agentId: 'hn' }, { op: 'hide', agentId: 'routine' }, { op: 'width', agentId: 'digest', width: 'wide' }], say: ' HN Digest will lead;\nfor three columns, make a board. ' }))).toMatchObject({
      ops: [{ op: 'lead', agentId: 'hn' }, { op: 'hide', agentId: 'routine' }, { op: 'width', agentId: 'digest', width: 'wide' }],
      changes: ['Lead with HN Digest', 'Leave out Evening Routine', 'Put Job Digest in the wide column'],
      say: 'HN Digest will lead; for three columns, make a board.',
    });
  });

  it("no ops is sua saying it can't be done here; an unknown agent or op is refused with why; no block is no answer", () => {
    expect(parse(answer({ ops: [], say: 'The edition has two columns; make a board for three.' }))).toEqual({ ops: [], changes: [], rows: [], say: 'The edition has two columns; make a board for three.' });
    expect(parse(answer({ ops: [{ op: 'lead', agentId: 'made-up' }] }))).toEqual({ error: 'There\'s no agent "made-up" with a result to show.' });
    expect(parse(answer({ ops: [{ op: 'paint', colour: 'purple' }] }))).toEqual({ error: "sua came back with a change the edition doesn't take. Say it another way." });
    expect(parse('words only')).toBeUndefined();
    expect(parse('<edition>nope</edition>')).toBeUndefined();
    expect(parse(undefined)).toBeUndefined();
  });

  it('takes at most eight changes', () => {
    const ops = Array.from({ length: 12 }, () => ({ op: 'numbers', on: false }));
    const out = parse(answer({ ops }));
    expect(out && 'ops' in out ? out.ops.length : 0).toBe(8);
  });

  it("offers to run a part again only when it's old or failed and can run; each change and run is its own row; a line with a number of its own isn't said", async () => {
    const { describeEditionOp } = await import('@some-useful-agents/core');
    const parts = new Map([
      ['hn', { ageHours: 360, failed: false, canRunAgain: true }],
      ['digest', { ageHours: 2, failed: false, canRunAgain: true }],
      ['routine', { ageHours: 3, failed: true, canRunAgain: false }],
    ]);
    const p = (v: unknown) => parseEditionAnswer(answer(v), { ...EMPTY_EDITION_PREFS, include: ['hn'] }, known, title, parts);
    const out = p({ ops: [{ op: 'auto', agentId: 'hn' }], actions: [{ do: 'rerun', agentId: 'hn' }], say: 'HN Digest is old.' }) as { rows: Array<{ kind: string; text: string; state: string }>; say?: string };
    expect(out.rows.map((r) => [r.kind, r.text, r.state])).toEqual([
      ['op', 'Stop always showing HN Digest: only when it ran in the last day', 'open'],
      ['action', 'Run HN Digest again: its result is 15 days old', 'open'],
    ]);
    expect(out.say).toBe('HN Digest is old.');
    // The ages are ours; a line that writes its own number isn't said.
    expect((p({ ops: [], actions: [], say: 'It is 15 days old.' }) as { say?: string }).say).toBeUndefined();
    expect(p({ actions: [{ do: 'rerun', agentId: 'digest' }] })).toEqual({ error: '"digest" is from the last day; there\'s nothing to run again.' });
    expect(p({ actions: [{ do: 'rerun', agentId: 'routine' }] })).toEqual({ error: '"routine" needs inputs before it can run; that\'s done on its page.' });
    expect(p({ actions: [{ do: 'rerun', agentId: 'nope' }] })).toEqual({ error: '"nope" isn\'t on the edition, so it can\'t be run again from here.' });
    expect(p({ actions: [{ do: 'buy', what: 'coffee' }] })).toEqual({ error: "Action 1 isn't one sua can offer here." });
    // Stopping always-showing one that isn't: refused.
    expect(parseEditionAnswer(answer({ ops: [{ op: 'auto', agentId: 'digest' }] }), EMPTY_EDITION_PREFS, known, title, parts)).toEqual({ error: '"digest" isn\'t one you always show.' });
    expect(describeEditionOp({ op: 'auto', agentId: 'hn' }, title)).toContain('Stop always showing HN Digest');
  });
});
