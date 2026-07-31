/**
 * Autonomy-trail UI (B3): the provenance chip on action cards ("auto-ran" vs
 * "you approved"), the source chip on list rows, and the verify-verdict badge
 * on verification system notes. Render-level assertions on the view output.
 */
import { describe, it, expect } from 'vitest';
import { render } from './html.js';
import { renderInboxDetailFragment } from './inbox-detail.js';
import { renderInboxList } from './inbox-list.js';
import type { InboxActionMeta, InboxMessage, InboxResponse } from '@some-useful-agents/core';

const baseMessage = (over: Partial<InboxMessage> = {}): InboxMessage => ({
  id: 'm1', createdAt: Date.now(), priority: 'medium', source: 'manual',
  title: 't', body: 'b', status: 'awaiting_user', starred: false, paused: false, tags: [],
  ...over,
});

const action = (id: string, over: Partial<InboxActionMeta>): InboxResponse => ({
  id, messageId: 'm1', createdAt: Date.now(), role: 'action', body: 'Run agent-analyzer',
  metaJson: JSON.stringify({ kind: 'action', status: 'completed', agentId: 'agent-analyzer', inputs: {}, effect: 'read', ...over } satisfies InboxActionMeta),
});

const systemNote = (id: string, body: string, kind?: string): InboxResponse => ({
  id, messageId: 'm1', createdAt: Date.now(), role: 'system', body,
  metaJson: kind ? JSON.stringify({ kind }) : undefined,
});

function fragment(responses: InboxResponse[], message = baseMessage()): string {
  return render(renderInboxDetailFragment({ message, responses, inlineActionWidgets: {} }));
}

describe('action provenance chip (B3)', () => {
  it('shows "auto-ran" for a policy-approved action', () => {
    const out = fragment([action('r1', { status: 'completed', approvedBy: 'policy' })]);
    expect(out).toContain('auto-ran');
    expect(out).not.toContain('you approved');
  });

  it('shows "you approved" for an operator-approved action', () => {
    const out = fragment([action('r1', { status: 'completed', approvedBy: 'operator' })]);
    expect(out).toContain('you approved');
    expect(out).not.toContain('auto-ran');
  });

  it('shows no provenance for a still-proposed action', () => {
    const out = fragment([action('r1', { status: 'proposed' })]);
    expect(out).not.toContain('auto-ran');
    expect(out).not.toContain('you approved');
  });

  it('shows no provenance for a resolve/show-widget action even if approvedBy leaked in', () => {
    const out = fragment([action('r1', { status: 'completed', mode: 'resolve', agentId: '_resolve-thread', approvedBy: 'policy' })]);
    expect(out).not.toContain('auto-ran');
  });
});

describe('verify-verdict badge (B3)', () => {
  it('badges a verified note', () => {
    const out = fragment([systemNote('s1', 'Verified: latest run completed.', 'verified')]);
    expect(out).toContain('✓ Verified');
    expect(out).toContain('inbox-msg--verified');
  });

  it('badges a not-verified note', () => {
    const out = fragment([systemNote('s1', "Didn't resolve — couldn't verify the fix.", 'verify-failed')]);
    expect(out).toContain('Not verified');
    expect(out).toContain('inbox-msg--verify-failed');
  });

  it('leaves a plain system note unbadged', () => {
    const out = fragment([systemNote('s1', 'Just a normal note.')]);
    expect(out).not.toContain('inbox-msg--verify');
    expect(out).not.toContain('Not verified');
  });
});

describe('list-row source chip (B3)', () => {
  it('renders a source chip for a run-failure row', () => {
    const out = renderInboxList({ rows: [baseMessage({ source: 'run-failure', title: 'boom' })], sort: 'priority', dir: 'desc' });
    expect(out).toContain('inbox-row2__source--run-failure');
    expect(out).toContain('Run failure');
  });

  it('renders no source chip for a manual row', () => {
    const out = renderInboxList({ rows: [baseMessage({ source: 'manual', title: 'note' })], sort: 'priority', dir: 'desc' });
    expect(out).not.toContain('inbox-row2__source');
  });
});
