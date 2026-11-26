import { describe, it, expect } from 'vitest';
import { render } from './html.js';
import { renderInboxDetailFragment } from './inbox-detail.js';

// The conversation's header (the inbox cleanup): what it is, the title without
// "Answer: ", ★ and ⋯; one meta line with no pills; one Details fold for the rest.
const message = (over: Record<string, unknown> = {}) => ({
  id: 't1', title: 'Answer: Headphones for flights', body: '(empty)', source: 'manual', status: 'awaiting_user', priority: 'medium',
  agentId: 'notebook-finder', runId: 'abcdef1234567890', tags: ['travel'], starred: false, createdAt: Date.now() - 3600_000,
  contextJson: JSON.stringify({ page: { kind: 'notebook', id: 'h' }, extra: 1 }), ...over,
}) as never;

describe("the conversation's header", () => {
  it('says what it is, shows the title without the prefix, and keeps ★ and ⋯ beside it', () => {
    const html = render(renderInboxDetailFragment({ message: message(), responses: [] }));
    expect(html).toContain('<p class="thread-eyebrow">ANSWER</p>');
    expect(html).toContain('<h3 id="inbox-modal-title" class="inbox-modal__title">Headphones for flights</h3>');
    expect(html).toMatch(/inbox-modal__title-actions">\s*<form method="POST" action="\/inbox\/t1\/star"/);
    expect(html).toContain('data-inbox-menu');
  });

  it('one meta line: its state (warn while waiting on you), who it is with, its run, its age, its tags; no pills', () => {
    const html = render(renderInboxDetailFragment({ message: message(), responses: [] }));
    const meta = html.slice(html.indexOf('<p class="inbox-modal__meta thread-meta">'), html.indexOf('</p>', html.indexOf('thread-meta">')));
    expect(meta).toContain('thread-meta__status is-needs');
    expect(meta).toContain('<a href="/agents/notebook-finder" class="thread-meta__agent"');
    expect(meta).toContain('run abcdef12');
    expect(meta).toContain('#travel');
    // Outside the ⋯ menu's tag editor, no pill or chip markup.
    const outsideMenu = html.replace(/<details class="inbox-modal__menu"[\s\S]*?<\/details>/, '');
    expect(outsideMenu).not.toMatch(/class="(thread-status|inbox-pill|inbox-agent-chip)[ "]/);
  });

  it('the context and summary are one Details fold; none when there is nothing for it', () => {
    const html = render(renderInboxDetailFragment({ message: message(), responses: [], threadSummary: { currentGoal: 'g', currentStatus: 's' } as never }));
    expect(html).toContain('<summary class="thread-details__summary">Details (2)</summary>');
    expect((html.match(/<details class="thread-details">/g) ?? []).length).toBe(1);
    const plain = render(renderInboxDetailFragment({ message: message({ contextJson: JSON.stringify({ page: { kind: 'notebook' } }) }), responses: [] }));
    expect(plain).not.toContain('thread-details');
  });
});
