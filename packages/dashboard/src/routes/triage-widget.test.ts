import { describe, it, expect } from 'vitest';
import type { InboxMessage, InboxResponse } from '@some-useful-agents/core';
import { parseTriageWidget } from './inbox-plan.js';
import { renderInboxDetailFragment } from '../views/inbox-detail.js';

const widget = {
  components: [
    { id: 'root', component: 'Column', children: ['s', 't'] },
    { id: 's', component: 'StatStrip', items: { path: '/data/stats' } },
    { id: 't', component: 'Table', rows: { path: '/data/rows' }, columns: [{ key: 'agent', label: 'Agent' }] },
  ],
  data: { stats: [{ label: 'Failed runs', value: '4', tone: 'err' }], rows: [{ agent: 'board-builder' }] },
};

describe("a widget under sua's reply", () => {
  it('keeps a valid widget, repairs a wrong part, and drops what it cannot read', () => {
    expect(JSON.parse(parseTriageWidget(widget)!)).toEqual(widget);
    const bad = { ...widget, components: [widget.components[0], { id: 's', component: 'StatStrip', stats: [] }, widget.components[2]] };
    expect(parseTriageWidget(bad)).toContain("(a StatStrip that couldn't be drawn)");
    expect(parseTriageWidget('nope')).toBeUndefined();
    expect(parseTriageWidget({ components: 'x' })).toBeUndefined();
    expect(parseTriageWidget(undefined)).toBeUndefined();
  });

  it('draws it under the reply in the thread', () => {
    const now = new Date().toISOString();
    const message = { id: 'm1', priority: 'medium', source: 'manual', title: 'Failures?', body: 'what failed today?', status: 'awaiting_user', tags: [], createdAt: now, updatedAt: now } as unknown as InboxMessage;
    const reply = { id: 'r1', messageId: 'm1', role: 'triage', body: 'Three agents failed today.', createdAt: now, metaJson: JSON.stringify({ widget: parseTriageWidget(widget) }) } as unknown as InboxResponse;
    const out = String(renderInboxDetailFragment({ message, responses: [reply] } as never));
    expect(out).toContain('Three agents failed today.');
    expect(out).toContain('data-surface-id="triage-r1"');
    expect(out).toContain('"Failed runs"');
  });
});

describe("an agent's reply in the sua panel / Home conversation view", () => {
  it('draws its inline widget instead of the raw block', () => {
    const now = new Date().toISOString();
    const message = { id: 's1', priority: 'low', source: 'conversation', title: 'SFO to SF', body: '(empty)', status: 'awaiting_user', tags: [], createdAt: now, updatedAt: now } as unknown as InboxMessage;
    const W = '{"components":[{"id":"root","component":"Table","rows":{"path":"/data/rows"},"columns":[{"key":"m","label":"Mode"}]}],"data":{"rows":[{"m":"BART"}]}}';
    const reply = { id: 'r2', messageId: 's1', role: 'agent', body: `Here you go.\n<a2ui>${W}</a2ui>\nSafe travels.`, createdAt: now } as unknown as InboxResponse;
    const out = String(renderInboxDetailFragment({ message, responses: [reply] } as never));
    expect(out).toContain('data-surface-id="reply-r2-w0"');
    expect(out).toContain('Here you go.');
    expect(out).toContain('Safe travels.');
    expect(out).not.toContain('&lt;a2ui&gt;');
  });
});
