/**
 * Regression: on the archive view (?status=dismissed / resolved), the column
 * sort headers must preserve `status` — otherwise clicking a header drops the
 * filter and bounces the operator back to the active inbox.
 */
import { describe, it, expect } from 'vitest';
import type { InboxMessage } from '@some-useful-agents/core';
import { renderInboxList } from './inbox-list.js';

function row(over: Partial<InboxMessage> = {}): InboxMessage {
  return {
    id: 'm1', title: 'A dismissed thread', body: 'x', priority: 'medium',
    status: 'dismissed', source: 'manual', createdAt: 1, lastActivityAt: 1,
    tags: [], starred: false,
    ...over,
  } as InboxMessage;
}

describe('renderInboxList — archive view sort headers', () => {
  it('keeps status=dismissed on every column sort link', () => {
    const html = renderInboxList({
      rows: [row()], sort: 'priority', dir: 'desc', archiveView: 'dismissed',
    });
    // Grab the header sort links and confirm each carries status=dismissed.
    const sortLinks = [...html.matchAll(/href="\/inbox\?([^"]*sort=[^"]*)"/g)].map((m) => m[1]);
    expect(sortLinks.length).toBeGreaterThan(0);
    for (const q of sortLinks) {
      expect(q).toContain('status=dismissed');
    }
  });

  it('keeps status=resolved on the resolved archive view', () => {
    const html = renderInboxList({
      rows: [row({ status: 'resolved' })], sort: 'age', dir: 'desc', archiveView: 'resolved',
    });
    const sortLinks = [...html.matchAll(/href="\/inbox\?([^"]*sort=[^"]*)"/g)].map((m) => m[1]);
    expect(sortLinks.length).toBeGreaterThan(0);
    for (const q of sortLinks) expect(q).toContain('status=resolved');
  });

  it('does NOT add a status param on the active inbox view', () => {
    const html = renderInboxList({ rows: [row({ status: 'open' })], sort: 'priority', dir: 'desc' });
    const sortLinks = [...html.matchAll(/href="\/inbox\?([^"]*sort=[^"]*)"/g)].map((m) => m[1]);
    expect(sortLinks.length).toBeGreaterThan(0);
    for (const q of sortLinks) expect(q).not.toContain('status=');
  });
});
