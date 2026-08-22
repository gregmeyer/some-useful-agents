/**
 * The session window policy.
 *
 * The old window was an ABSOLUTE 8 hours from sign-in with no renewal, which
 * logged a daily operator out roughly once a day. `requireAuth` now slides the
 * window on navigation (covered in dashboard.test.ts), so what matters here is
 * that the default length actually clears an ordinary overnight gap, and that
 * an operator who wants the stricter posture can still get it.
 */

import { describe, it, expect } from 'vitest';
import { sessionMaxAgeSeconds, buildSessionCookie, buildSeenCookie, SESSION_COOKIE, SEEN_COOKIE } from './session.js';

const noEnv = {} as NodeJS.ProcessEnv;
const withHours = (v: string) => ({ SUA_DASHBOARD_SESSION_HOURS: v }) as NodeJS.ProcessEnv;

describe('session window', () => {
  it('defaults long enough to survive an overnight gap', () => {
    // An 8h window still signs a daily user out every morning — clearing a
    // night is the entire reason the default moved.
    expect(sessionMaxAgeSeconds(noEnv)).toBeGreaterThan(24 * 3600);
  });

  it('lets an operator ask for the old 8-hour posture back', () => {
    expect(sessionMaxAgeSeconds(withHours('8'))).toBe(8 * 3600);
  });

  it('falls back to the default rather than trusting a junk value', () => {
    // A bad parse must never yield 0 (locked out instantly) or NaN (a cookie
    // with a broken Max-Age, whose behavior is browser-dependent).
    const def = sessionMaxAgeSeconds(noEnv);
    for (const junk of ['forever', '0', '-5', 'NaN', '1e9', '']) {
      expect(sessionMaxAgeSeconds(withHours(junk))).toBe(def);
    }
  });

  it('accepts a fractional window', () => {
    expect(sessionMaxAgeSeconds(withHours('1.5'))).toBe(5400);
  });
});

describe('session cookies', () => {
  it('keeps the token cookie unreadable to page scripts and same-site only', () => {
    const c = buildSessionCookie('tok', withHours('8'));
    expect(c).toContain(`${SESSION_COOKIE}=tok`);
    expect(c).toContain('HttpOnly');
    expect(c).toContain('SameSite=Strict');
    expect(c).toContain('Max-Age=28800');
  });

  it('carries no secret in the seen marker', () => {
    // This cookie exists only to distinguish "expired" from "never signed in".
    // If a token ever leaked into it we would have widened the credential's
    // exposure to get better error copy, which is not a trade worth making.
    const c = buildSeenCookie();
    expect(c).toContain(`${SEEN_COOKIE}=1`);
    expect(c).toContain('HttpOnly');
    expect(c).not.toMatch(/[0-9a-f]{32}/);
  });

  it('outlives the session it is meant to explain', () => {
    const seenAge = Number(/Max-Age=(\d+)/.exec(buildSeenCookie())?.[1]);
    const sessionAge = sessionMaxAgeSeconds(noEnv);
    expect(seenAge).toBeGreaterThan(sessionAge);
  });
});
