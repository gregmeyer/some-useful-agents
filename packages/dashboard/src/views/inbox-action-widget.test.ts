/**
 * A finished action whose agent drew a widget stays open with the widget in
 * place (it's the answer); one without a widget still folds to a line. The ⋯
 * menu offers Copy link.
 */
import { describe, it, expect } from 'vitest';
import { render, unsafeHtml } from './html.js';
import { renderInboxDetailFragment } from './inbox-detail.js';
import type { InboxMessage, InboxResponse } from '@some-useful-agents/core';

const message: InboxMessage = {
  id: 'm1', createdAt: Date.now(), priority: 'medium', source: 'manual', title: 'Friday markets', body: '(empty)',
  status: 'awaiting_user', starred: false, paused: false, autoResolved: false, tags: [],
};
const done = (id: string): InboxResponse => ({
  id, messageId: 'm1', createdAt: Date.now(), role: 'action', body: 'ran',
  metaJson: JSON.stringify({ kind: 'action', status: 'completed', agentId: 'markets-today', inputs: {}, runId: `run-${id}`, approvedBy: 'operator' }),
});

describe('finished actions and their widgets', () => {
  it('keeps a finished run with a widget open, folds one without', () => {
    const out = render(renderInboxDetailFragment({
      message,
      responses: [done('a'), done('b')],
      inlineActionWidgets: { a: unsafeHtml('<div class="a2ui-host" data-a2ui-surface>NASDAQ +0.95%</div>') },
    }));
    const entries = out.split('<li class="inbox-timeline__entry">').slice(1);
    const a = entries.find((e) => e.includes('data-msg-id="a"'))!;
    const b = entries.find((e) => e.includes('data-msg-id="b"'))!;
    expect(a).not.toContain('inbox-action--collapsed');
    expect(a).toContain('NASDAQ +0.95%');
    expect(b).toContain('inbox-action--collapsed');
    expect(out).toContain('data-inbox-copy-link="/inbox/m1"');
  });
});

describe('thread summary', () => {
  it('reads as plain text: no Markdown markers, even when shortened', async () => {
    const { buildThreadSummary } = await import('../routes/inbox-widgets.js');
    const s = buildThreadSummary(message, [
      { id: 'u', messageId: 'm1', createdAt: 1, role: 'user', body: 'what about **friday**?' },
      { id: 't', messageId: 'm1', createdAt: 2, role: 'triage', body: 'Friday was **mixed**: **NASDAQ rose +0.95%** to **27,190.863**, while the **Dow Jones Industrial Average fell -0.65%** to **51,176.96**, captured after hours.' },
    ] as never);
    expect(s.latestResult).toContain('Friday was mixed');
    expect(s.latestResult).not.toContain('**');
    expect(s.currentGoal).not.toContain('**');
  });
});
