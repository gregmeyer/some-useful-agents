import { describe, it, expect } from 'vitest';
import type { InboxActionMeta } from '@some-useful-agents/core';
import { listItems, mergeListActions } from './inbox-plan.js';

// sua split 13 companies into two research-fanout cards; the operator had two to press.

const fanout = { GOAL: {}, ITEMS: {}, ASK: {}, MAX_ITEMS: {} };
const inputsOf = (id: string) => (id === 'research-fanout' ? fanout : id === 'plain' ? { TOPIC: {} } : undefined);
const card = (inputs: Record<string, string>, agentId = 'research-fanout'): InboxActionMeta =>
  ({ kind: 'action', status: 'proposed', agentId, inputs, rationale: 'r', effect: 'read' });

describe('one list, one card', () => {
  it('reads a list the way the list agents do', () => {
    expect(listItems('Floe, Primer (primer.io, the demo one), Olto').map((x) => x.subject)).toEqual(['Floe', 'Primer (primer.io, the demo one)', 'Olto']);
    expect(listItems('- Floe\n2. Primer')).toEqual([{ subject: 'Floe', hint: '' }, { subject: 'Primer', hint: '' }]);
    expect(listItems('[{"subject":"Floe","hint":"floe.ai"},"Olto"]')).toEqual([{ subject: 'Floe', hint: 'floe.ai' }, { subject: 'Olto', hint: '' }]);
  });

  it('merges runs of a list agent that differ only in their items, and asks for all of them', () => {
    const first = 'A, B, C, D, E, F, G';
    const merged = mergeListActions([
      card({ GOAL: 'Open roles.', ASK: 'roles', ITEMS: first }),
      card({ GOAL: 'Open roles.', ASK: 'roles', ITEMS: 'H\nI\nJ\nK\nL\nM' }),
    ], inputsOf);
    expect(merged).toHaveLength(1);
    expect(JSON.parse(merged[0].inputs.ITEMS).map((x: { subject: string }) => x.subject)).toEqual('ABCDEFGHIJKLM'.split(''));
    expect(merged[0].inputs.MAX_ITEMS).toBe('13');
    expect(merged[0].rationale).toBe('All 13 in one run: Open roles.');
  });

  it('leaves apart runs that ask different things, other agents, or too many items', () => {
    const asks = mergeListActions([card({ ASK: 'roles', ITEMS: 'A' }), card({ ASK: 'funding', ITEMS: 'B' })], inputsOf);
    expect(asks).toHaveLength(2);
    expect(mergeListActions([card({ TOPIC: 'x' }, 'plain'), card({ TOPIC: 'x' }, 'plain')], inputsOf)).toHaveLength(2);
    const many = Array.from({ length: 12 }, (_, i) => `Co${String(i)}`).join(', ');
    expect(mergeListActions([card({ ITEMS: many }), card({ ITEMS: many.replace(/Co/g, 'Org') })], inputsOf)).toHaveLength(2);
  });
});
