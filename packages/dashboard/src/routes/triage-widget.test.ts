import { describe, it, expect } from 'vitest';
import type { InboxMessage, InboxResponse } from '@some-useful-agents/core';
import { parseTriageWidget, triageReplyBody } from './inbox-plan.js';
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

  it('draws a reply saved before widgets were kept inline (its meta) under the reply', () => {
    const now = new Date().toISOString();
    const message = { id: 'm1', priority: 'medium', source: 'manual', title: 'Failures?', body: 'what failed today?', status: 'awaiting_user', tags: [], createdAt: now, updatedAt: now } as unknown as InboxMessage;
    const reply = { id: 'r1', messageId: 'm1', role: 'triage', body: 'Three agents failed today.', createdAt: now, metaJson: JSON.stringify({ widget: parseTriageWidget(widget) }) } as unknown as InboxResponse;
    const out = String(renderInboxDetailFragment({ message, responses: [reply] } as never));
    expect(out).toContain('Three agents failed today.');
    expect(out).toContain('data-surface-id="triage-r1"');
    expect(out).toContain('"Failed runs"');
  });
});

describe("sua's widget, kept inline like an agent's", () => {
  const ask = {
    components: [
      { id: 'root', component: 'Row', children: ['a', 'b'] },
      { id: 'a', component: 'Button', child: 'al', action: { event: { name: 'pick', context: { message: 'This weekend, Oct 17–18' } } } },
      { id: 'al', component: 'Text', text: 'This weekend' },
      { id: 'b', component: 'Button', child: 'bl', action: { event: { name: 'pick', context: { message: 'Next weekend, Oct 24–25' } } } },
      { id: 'bl', component: 'Text', text: 'Next weekend </a2ui>' },
    ],
    data: {},
  };

  it('keeps the checked widget as an <a2ui> block after the words; "</" can\'t close it early', () => {
    const body = triageReplyBody('Which weekend do you mean?', parseTriageWidget(ask));
    expect(body.startsWith('Which weekend do you mean?\n\n<a2ui>{')).toBe(true);
    expect(body.endsWith('}</a2ui>')).toBe(true);
    expect(body.match(/<\/a2ui>/g)).toHaveLength(1);
    expect(triageReplyBody('Just words.')).toBe('Just words.');
  });

  it('draws it in place with live buttons, then spent once you answer', () => {
    const now = new Date().toISOString();
    const message = { id: 'm3', priority: 'medium', source: 'manual', title: 'Pumpkins', body: 'pumpkin things next weekend', status: 'awaiting_user', tags: [], createdAt: now, updatedAt: now } as unknown as InboxMessage;
    const reply = { id: 't1', messageId: 'm3', role: 'triage', body: triageReplyBody('Which weekend do you mean?', parseTriageWidget(ask)), createdAt: now } as unknown as InboxResponse;
    const live = String(renderInboxDetailFragment({ message, responses: [reply] } as never));
    expect(live).toContain('Which weekend do you mean?');
    expect(live).toContain('data-surface-id="reply-t1-w0"');
    expect(live).not.toContain('&lt;a2ui&gt;');
    expect(live).not.toContain('is-answered');
    const said = { id: 'u1', messageId: 'm3', role: 'user', body: 'Next weekend, Oct 24–25', createdAt: now } as unknown as InboxResponse;
    const after = String(renderInboxDetailFragment({ message, responses: [reply, said] } as never));
    expect(after).toContain('reply-widget is-answered');
    expect(after).toContain('✓ Next weekend');
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

  it('once you answer, the earlier reply\'s buttons are spent and your pick is ticked', () => {
    const now = new Date().toISOString();
    const message = { id: 's2', priority: 'low', source: 'conversation', agentId: 'chat-helper', title: 'Pumpkins', body: '(empty)', status: 'awaiting_user', tags: [], createdAt: now, updatedAt: now } as unknown as InboxMessage;
    const W = '{"components":[{"id":"root","component":"Row","children":["a","b"]},{"id":"a","component":"Button","child":"al","action":{"event":{"name":"pick","context":{"message":"This weekend"}}}},{"id":"al","component":"Text","text":"This weekend"},{"id":"b","component":"Button","child":"bl","action":{"event":{"name":"pick","context":{"message":"Next weekend"}}}},{"id":"bl","component":"Text","text":"Next weekend"}],"data":{}}';
    const ask = { id: 'q1', messageId: 's2', role: 'agent', body: `Which weekend?\n<a2ui>${W}</a2ui>`, createdAt: now } as unknown as InboxResponse;
    const pick = { id: 'u1', messageId: 's2', role: 'user', body: 'Next weekend', createdAt: now } as unknown as InboxResponse;
    const again = { id: 'q2', messageId: 's2', role: 'agent', body: `Anything else?\n<a2ui>${W}</a2ui>`, createdAt: now } as unknown as InboxResponse;
    const out = String(renderInboxDetailFragment({ message, responses: [ask, pick, again] } as never));
    expect(out.match(/reply-widget is-answered/g)).toHaveLength(1); // the first one only; the latest is live
    expect(out).toContain('✓ Next weekend');
  });
});
