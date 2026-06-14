/**
 * Unit tests for localIsoNow — the local-offset ISO timestamp fed to triage as
 * NOW so it can resolve relative times ("before 4:30pm today") into an absolute
 * due date. Round-tripping is the real assertion: applying the offset must
 * preserve the absolute instant on any machine timezone.
 */
import { describe, it, expect } from 'vitest';
import { localIsoNow } from './inbox.js';

describe('localIsoNow', () => {
  it('emits ISO 8601 with a numeric UTC offset, not the Z/UTC form', () => {
    const out = localIsoNow(new Date('2026-06-14T21:50:00.000Z'));
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    expect(out).not.toMatch(/Z$/);
  });

  it('round-trips to the same absolute instant (offset applied correctly)', () => {
    // Whatever the test machine's timezone, parsing the local-offset string
    // back must equal the input instant (truncated to whole seconds).
    const d = new Date('2026-06-14T21:50:33.000Z');
    const parsedBack = new Date(localIsoNow(d)).getTime();
    expect(parsedBack).toBe(Math.floor(d.getTime() / 1000) * 1000);
  });

  it('defaults to the current time when no date is passed', () => {
    const before = Date.now();
    const parsed = new Date(localIsoNow()).getTime();
    const after = Date.now();
    // Allow a 2s window and second-truncation slop.
    expect(parsed).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000 - 1000);
    expect(parsed).toBeLessThanOrEqual(after + 1000);
  });
});
