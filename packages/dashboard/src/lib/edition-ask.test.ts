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
    expect(parse(answer({ ops: [{ op: 'lead', agentId: 'hn' }, { op: 'hide', agentId: 'routine' }, { op: 'width', agentId: 'digest', width: 'wide' }], say: ' HN Digest will lead;\nfor three columns, make a board. ' }))).toEqual({
      ops: [{ op: 'lead', agentId: 'hn' }, { op: 'hide', agentId: 'routine' }, { op: 'width', agentId: 'digest', width: 'wide' }],
      changes: ['Lead with HN Digest', 'Leave out Evening Routine', 'Put Job Digest in the wide column'],
      say: 'HN Digest will lead; for three columns, make a board.',
    });
  });

  it("no ops is sua saying it can't be done here; an unknown agent or op is refused with why; no block is no answer", () => {
    expect(parse(answer({ ops: [], say: 'The edition has two columns; make a board for three.' }))).toEqual({ ops: [], changes: [], say: 'The edition has two columns; make a board for three.' });
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
});
