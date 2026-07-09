/**
 * The inbox thread header renders one navigable chip per agent the
 * conversation references — the message's target agent plus every action's
 * target across responses — excluding triage scaffolding (agent-editor,
 * dashboard-editor, the resolve sentinel, …) and deduping.
 */
import { describe, it, expect } from 'vitest';
import { render } from './html.js';
import { renderInboxDetailFragment } from './inbox-detail.js';
import type { InboxActionMeta, InboxMessage, InboxResponse } from '@some-useful-agents/core';

const baseMessage = (over: Partial<InboxMessage> = {}): InboxMessage => ({
  id: 'm1', createdAt: Date.now(), priority: 'medium', source: 'manual',
  title: 't', body: 'b', status: 'awaiting_user', starred: false, tags: [],
  ...over,
});

const actionResponse = (id: string, agentId: string, status: InboxActionMeta['status'] = 'completed'): InboxResponse => ({
  id, messageId: 'm1', createdAt: Date.now(), role: 'action', body: '',
  metaJson: JSON.stringify({ kind: 'action', status, agentId, inputs: {}, effect: 'read' } satisfies InboxActionMeta),
});

function chipIds(html: string): string[] {
  return [...html.matchAll(/class="inbox-agent-chip"[^>]*>([^<]+)</g)].map((m) => m[1].trim());
}

describe('inbox thread agent chips', () => {
  it('renders a chip for the message target agent', () => {
    const out = render(renderInboxDetailFragment({
      message: baseMessage({ agentId: 'weather-forecast' }), responses: [], inlineActionWidgets: {},
    }));
    expect(out).toContain('/agents/weather-forecast');
    expect(chipIds(out)).toEqual(['weather-forecast']);
  });

  it('adds a chip for each distinct agent referenced by actions, target first', () => {
    const out = render(renderInboxDetailFragment({
      message: baseMessage({ agentId: 'weather-forecast' }),
      responses: [
        actionResponse('r1', 'mlb-scoreboard'),
        actionResponse('r2', 'cocktail-of-the-day'),
        actionResponse('r3', 'mlb-scoreboard'), // dup → collapsed
      ],
      inlineActionWidgets: {},
    }));
    expect(chipIds(out)).toEqual(['weather-forecast', 'mlb-scoreboard', 'cocktail-of-the-day']);
  });

  it('excludes triage scaffolding + the resolve sentinel', () => {
    const out = render(renderInboxDetailFragment({
      message: baseMessage({ agentId: 'weather-forecast' }),
      responses: [
        actionResponse('r1', 'agent-editor'),
        actionResponse('r2', 'dashboard-editor'),
        actionResponse('r3', '_resolve-thread'),
        actionResponse('r4', 'reddit-daily-curiosity'),
      ],
      inlineActionWidgets: {},
    }));
    expect(chipIds(out)).toEqual(['weather-forecast', 'reddit-daily-curiosity']);
    expect(out).not.toContain('/agents/agent-editor');
    expect(out).not.toContain('/agents/dashboard-editor');
  });

  it('renders no chips when nothing is referenced (manual thread, no target)', () => {
    const out = render(renderInboxDetailFragment({
      message: baseMessage(), responses: [], inlineActionWidgets: {},
    }));
    expect(chipIds(out)).toEqual([]);
  });
});
