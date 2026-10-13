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
