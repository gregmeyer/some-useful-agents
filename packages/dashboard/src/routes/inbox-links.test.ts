/**
 * Unit tests for the triage <plan> `links` validator. Kept in a standalone
 * file (no app/DB fixture) so the pure-function assertions don't interleave
 * with inbox.test.ts's stateful afterEach teardown.
 */
import { describe, it, expect } from 'vitest';
import { parseTriageLinks } from './inbox.js';

describe('parseTriageLinks', () => {
  it('keeps valid label + relative href entries', () => {
    expect(parseTriageLinks([{ label: 'Open agent', href: '/agents/foo' }])).toEqual([
      { label: 'Open agent', href: '/agents/foo' },
    ]);
  });

  it('keeps http(s) links', () => {
    expect(parseTriageLinks([{ label: 'Docs', href: 'https://example.com' }])).toHaveLength(1);
  });

  it('drops entries with unsafe hrefs', () => {
    expect(parseTriageLinks([{ label: 'x', href: 'javascript:alert(1)' }])).toEqual([]);
  });

  it('drops entries missing a label or href', () => {
    expect(parseTriageLinks([{ href: '/agents/foo' }, { label: 'no href' }])).toEqual([]);
  });

  it('caps at four links', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ label: `L${i}`, href: `/agents/a${i}` }));
    expect(parseTriageLinks(many)).toHaveLength(4);
  });

  it('returns empty for non-array input', () => {
    expect(parseTriageLinks(undefined)).toEqual([]);
    expect(parseTriageLinks('nope')).toEqual([]);
  });
});
