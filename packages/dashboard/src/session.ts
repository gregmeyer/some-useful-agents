/**
 * Dashboard session cookies.
 *
 * Two cookies, with deliberately different jobs:
 *
 * - `sua_dashboard_session` holds the bearer token. It is the credential.
 * - `sua_dashboard_seen` holds no secret at all — just the marker `1`, with a
 *   much longer life. Its only job is to let the server tell "your session
 *   expired" apart from "you have never signed in."
 *
 * That second cookie exists because the session cookie IS the token: when it
 * expires the browser simply deletes it, so from the server's side an expired
 * operator and a first-time visitor look byte-for-byte identical. Before this,
 * both got the same copy — "visit the one-time URL that `sua dashboard start`
 * printed to your terminal" — which is unactionable after an expiry, because
 * the daemon is still running and will never print that line again.
 *
 * ## Why the window is idle-based, and long
 *
 * The session was previously an ABSOLUTE 8 hours with no renewal: the clock
 * started at sign-in and never extended, so a daily user was locked out roughly
 * once a day, on an invisible schedule. `requireAuth` now re-issues the cookie
 * on authenticated navigations, making the window IDLE time rather than total
 * time, and the default is 30 days so that an ordinary overnight gap does not
 * sign anyone out.
 *
 * This is a deliberate, documented relaxation of the control listed in
 * docs/SECURITY.md, taken because the surface is loopback-bound, the cookie is
 * HttpOnly + SameSite=Strict, and the Host/Origin checks (not the cookie
 * lifetime) are what actually defend against DNS rebinding. See ADR-0033.
 * Operators who want the old posture set `SUA_DASHBOARD_SESSION_HOURS=8`.
 */

/** Cookie holding the bearer token. Its presence and validity IS the session. */
export const SESSION_COOKIE = 'sua_dashboard_session';

/**
 * Non-secret marker proving this browser signed in successfully at some point.
 * Outlives the session cookie so an expiry is distinguishable from a first
 * visit. Never read for authorization — only to choose which copy to show.
 */
export const SEEN_COOKIE = 'sua_dashboard_seen';

const DEFAULT_SESSION_HOURS = 24 * 30; // 30 days of inactivity
const MIN_SESSION_HOURS = 1;
const MAX_SESSION_HOURS = 24 * 365;

/** How long the `seen` marker lives. Longer than any session window. */
const SEEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 400;

/**
 * Idle session window in seconds. Override with
 * `SUA_DASHBOARD_SESSION_HOURS`; a malformed or out-of-range value falls back
 * to the default rather than producing a session that never expires (or
 * expires instantly).
 */
export function sessionMaxAgeSeconds(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.SUA_DASHBOARD_SESSION_HOURS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_SESSION_HOURS * 3600;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < MIN_SESSION_HOURS || parsed > MAX_SESSION_HOURS) {
    return DEFAULT_SESSION_HOURS * 3600;
  }
  return Math.round(parsed * 3600);
}

/**
 * The session cookie.
 *
 * HttpOnly — JS cannot read the token via document.cookie.
 * SameSite=Strict — no cross-site sends; pairs with the Origin check for CSRF.
 * Not Secure — the dashboard binds 127.0.0.1, so HTTPS is not in play.
 */
export function buildSessionCookie(token: string, env?: NodeJS.ProcessEnv): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Max-Age=${sessionMaxAgeSeconds(env)}; Path=/`;
}

/** The non-secret "this browser has signed in before" marker. */
export function buildSeenCookie(): string {
  return `${SEEN_COOKIE}=1; HttpOnly; SameSite=Strict; Max-Age=${SEEN_MAX_AGE_SECONDS}; Path=/`;
}
