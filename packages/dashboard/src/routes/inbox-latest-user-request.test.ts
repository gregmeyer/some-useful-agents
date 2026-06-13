/**
 * Unit tests for latestUserRequest — the triage "current intent" selector.
 *
 * Regression for the "triage reverts to an earlier goal on a mid-thread
 * pivot" bug (thread 7537638c): triage was anchored to the frozen original
 * MESSAGE_BODY and re-proposed a stale (failed) action, ignoring the
 * operator's newer ask. The fix feeds triage the LATEST real user message
 * as the authoritative CURRENT_REQUEST. This helper is that selection, so
 * it gets focused, deterministic coverage here (no DB / no provider).
 */
import { describe, it, expect } from 'vitest';
import type { InboxResponse } from '@some-useful-agents/core';
import { latestUserRequest } from './inbox.js';

const r = (role: InboxResponse['role'], body: string, createdAt: number): InboxResponse =>
  ({ id: `${role}-${createdAt}`, messageId: 'm', role, body, createdAt });

describe('latestUserRequest — triage current-intent selection', () => {
  it('returns the most recent real user message, not the first', () => {
    const responses: InboxResponse[] = [
      r('user', 'make me a barbecue grocery list note', 1),
      r('triage', 'I can make that note', 2),
      r('action', 'create-note', 3),
      r('user', 'actually, run the hacker news summary and put it in a note', 4),
    ];
    expect(latestUserRequest(responses)).toBe('actually, run the hacker news summary and put it in a note');
  });

  it('skips the synthetic "Asked triage" marker and finds the real ask', () => {
    const responses: InboxResponse[] = [
      r('user', 'run the hacker news summary into a note', 1),
      r('triage', 'on it', 2),
      r('user', '(Asked triage to take another look.)', 3),
    ];
    expect(latestUserRequest(responses)).toBe('run the hacker news summary into a note');
  });

  it('skips trailing empty/whitespace user rows', () => {
    const responses: InboxResponse[] = [
      r('user', 'summarize the latest run', 1),
      r('user', '   ', 2),
    ];
    expect(latestUserRequest(responses)).toBe('summarize the latest run');
  });

  it('returns undefined when the operator has not replied (triage is first responder)', () => {
    const responses: InboxResponse[] = [
      r('triage', 'here is what I see', 1),
      r('action', 'do-thing', 2),
    ];
    expect(latestUserRequest(responses)).toBeUndefined();
  });
});
