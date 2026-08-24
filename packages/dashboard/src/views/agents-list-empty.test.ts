/**
 * The /agents page must never claim you have no agents while you have some.
 *
 * `empty` is computed from the ACTIVE TAB's results — v2/v1 arrive already
 * filtered by source. The page treated that as "the install is empty": it
 * showed the "No agents yet / create one" card AND suppressed the tab strip,
 * so an operator whose agents are all `source: examples` landed on the default
 * User tab, was told they had none, and lost the only route to the ones they
 * had. The same conflation had already been fixed for an empty *search*; the
 * empty *tab* case was missed.
 *
 * These use controlled input rather than a live board on purpose — on a real
 * install v1 agents are not source-filtered, so they leak into every tab and
 * mask the bug entirely.
 */

import { describe, it, expect } from 'vitest';
import { renderAgentsList } from './agents-list.js';

type Input = Parameters<typeof renderAgentsList>[0];

function page(over: Partial<Input> = {}): string {
  return renderAgentsList({
    v1: [], v2: [], recentRuns: [],
    stats: { total: 0, active: 0, totalRuns: 0, inFlight: 0 },
    limit: 12, offset: 0, total: 0,
    tab: 'user',
    tabCounts: { user: 0, examples: 0, community: 0 },
    ...over,
  } as Input);
}

const NO_AGENTS_YET = 'No agents yet';

describe('/agents empty states', () => {
  it('does not claim the install is empty when another tab has agents', () => {
    const out = page({ tab: 'user', tabCounts: { user: 0, examples: 43, community: 0 } });
    expect(out).not.toContain(NO_AGENTS_YET);
    expect(out).toContain('No agents in');
  });

  it('says where the agents actually are, with a link to get there', () => {
    const out = page({ tab: 'user', tabCounts: { user: 0, examples: 43, community: 2 } });
    expect(out).toContain('43 in Examples');
    expect(out).toContain('2 in Community');
    expect(out).toContain('tab=examples');
  });

  it('keeps the tab strip on screen so you can reach them', () => {
    // This is the part that turned a confusing page into a dead end.
    const out = page({ tab: 'user', tabCounts: { user: 0, examples: 43, community: 0 } });
    expect(out).toContain('tab=examples');
  });

  it('keeps the filter bar too, so a stale filter can be cleared', () => {
    const out = page({
      tab: 'user',
      filter: { status: 'archived' },
      tabCounts: { user: 0, examples: 43, community: 0 },
    } as Partial<Input>);
    expect(out).toContain('Search agents');
  });

  it('still shows the real empty state when there genuinely are none', () => {
    const out = page({ tab: 'user', tabCounts: { user: 0, examples: 0, community: 0 } });
    expect(out).toContain(NO_AGENTS_YET);
    // Nothing to switch to, so the tab strip stays hidden as before.
    expect(out).not.toContain('tab=examples');
  });

  it('leaves the empty-search path alone', () => {
    // A search that matched nothing is a different problem with a different
    // answer, and already had its own handling.
    const out = page({
      tab: 'user',
      filter: { q: 'zzzz' },
      tabCounts: { user: 0, examples: 43, community: 0 },
    } as Partial<Input>);
    expect(out).toContain('No agents match');
    expect(out).not.toContain('No agents in');
    expect(out).not.toContain(NO_AGENTS_YET);
  });
});
