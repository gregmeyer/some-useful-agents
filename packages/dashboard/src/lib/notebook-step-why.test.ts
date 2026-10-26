import { describe, it, expect } from 'vitest';
import { stepWhy, perItemWhy, errorWords, andList } from './notebook-step-why.js';

const find = { kind: 'find' as const };
const ok = (out: Parameters<typeof stepWhy>[1] extends infer T ? T extends { out?: infer O } ? O : never : never, short?: string) => ({ status: 'completed' as const, out, ...(short ? { short } : {}) });

describe('why a step came out short', () => {
  it('names the places a search looked when none had a match (not "nothing new")', () => {
    // What a used-car search really gave: a note about where it looked, no listings.
    const why = stepWhy(find, ok({ added: 1, options: 0, skipped: 0, criteriaMet: 0, sources: [
      { name: 'Craigslist', found: 0, status: 'none' }, { name: 'OfferUp', found: 0, status: 'none' }, { name: 'Facebook Marketplace', found: 0, status: 'none' }, { name: 'Autotrader', found: 0, status: 'blocked' },
    ] }), { stalled: true, tries: 1 });
    expect(why).toBe('Its last search looked at Craigslist, OfferUp and Facebook Marketplace: none had a match. Autotrader blocked the search.');
  });

  it('says when what it found was already in the notebook or ruled out', () => {
    expect(stepWhy(find, ok({ added: 0, options: 0, refreshed: 2, ruledOutSeen: 1, skipped: 1, criteriaMet: 0 }), { stalled: true, tries: 2 }))
      .toBe('Its last search found no new ones, only 2 it already has and 1 already ruled out.');
    expect(stepWhy(find, ok({ added: 0, options: 0, refreshed: 3, skipped: 0, criteriaMet: 0, sources: [{ name: 'Greenhouse', found: 3, status: 'found' }] }), { stalled: true, tries: 1 }))
      .toBe('Greenhouse (3) gave only ones it already has.');
  });

  it('says what it ruled out, and what the agent itself said', () => {
    expect(stepWhy(find, ok({ added: 2, options: 2, ruledOutNew: 2, skipped: 0, criteriaMet: 0, summary: 'Both were sedans, not wagons' }), { stalled: true, tries: 1 }))
      .toBe('2 new ones it found didn\'t fit, so it ruled them out. It said: “Both were sedans, not wagons.”');
  });

  it('a check or source step says what it could not settle', () => {
    expect(stepWhy({ kind: 'check' }, ok({ added: 0, skipped: 0, criteriaMet: 0 }), { stalled: true, tries: 3 })).toBe("Its last try couldn't confirm any of the open checks from a source.");
    expect(stepWhy({ kind: 'source' }, ok({ added: 0, skipped: 0, criteriaMet: 0, factsDropped: 2 }), { stalled: true, tries: 1 }))
      .toBe("Its last try found none of the missing facts. 2 numbers it gave weren't in what it read, so they were left out.");
  });

  it('a run that failed, was stopped, or was cut short says so', () => {
    expect(stepWhy(find, { status: 'failed', error: 'Reached maximum number of turns (8)' }, { stalled: true, tries: 1 })).toBe('Its last try ran out of turns, so it found nothing more.');
    expect(stepWhy(find, { status: 'stopped' }, { stalled: true, tries: 1 })).toBe('You stopped it.');
    expect(stepWhy(find, ok({ added: 0, options: 0, skipped: 0, criteriaMet: 0 }, "gather didn't finish (timed out)"), { stalled: true, tries: 1 }))
      .toBe('Its last search found no new ones. Part of its run was cut short (timed out).');
  });

  it('still getting closer: Try again keeps going', () => {
    expect(stepWhy(find, ok({ added: 1, options: 1, skipped: 0, criteriaMet: 0 }), { stalled: false, tries: 3 })).toBe('It was still getting closer after 3 tries; Try again keeps going.');
  });

  it('a page-reading step names who blocked it and what had no page', () => {
    expect(perItemWhy({ read: 2, pages: 5, factsSet: 0, blocked: ['autotrader.com'], failed: 1, noPage: 3, stopped: false }))
      .toBe("Autotrader.com blocked the page reader. 1 page couldn't be read (the run failed). The 2 pages it read didn't give the missing facts. 3 options have no page of their own to read.");
  });

  it('plain words for errors and lists', () => {
    expect(errorWords('Request timed out after 180s')).toBe('timed out');
    expect(errorWords('429 Too Many Requests')).toBe('hit a rate limit');
    expect(errorWords('Spawn failed. ENOENT')).toBe('failed (Spawn failed)');
    expect(andList(['A'])).toBe('A');
    expect(andList(['A', 'B', 'C'])).toBe('A, B and C');
  });
});
