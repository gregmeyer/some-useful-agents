import { timingSafeEqual } from 'node:crypto';

/**
 * Shared HTTP loopback defenses used by both the MCP server and the web
 * dashboard. Extracted from `packages/mcp-server/src/auth.ts` so the
 * dashboard doesn't have to import from a sibling package to get the same
 * three checks (bearer / Host / Origin) the MCP server already uses.
 *
 * Three concrete attacks this module mitigates:
 *
 *  1. LAN attacker reaching the bound port directly. Mitigated by binding
 *     to 127.0.0.1 in the http server itself; this module assumes the bind
 *     happened. The Host check is belt-and-suspenders for the case where
 *     the operator opted into a non-loopback bind via --host.
 *
 *  2. DNS rebinding from a browser. The browser sends a real Origin header
 *     when issuing CORS requests; we reject any present Origin that isn't
 *     loopback. (Non-browser clients send no Origin and pass through.)
 *
 *  3. Unauthorized local processes. A bearer token in a 0o600 file under
 *     ~/.sua/ separates "any process on this machine" from "a process the
 *     user has shared the token with."
 */

export type AuthCheckResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ba = Buffer.from(a, 'utf-8');
  const bb = Buffer.from(b, 'utf-8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Verify the Authorization header carries a matching bearer token. */
export function checkAuthorization(
  header: string | undefined,
  expectedToken: string,
): AuthCheckResult {
  if (!header) {
    return { ok: false, status: 401, error: 'Missing Authorization header' };
  }
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) {
    return { ok: false, status: 401, error: 'Authorization must be "Bearer <token>"' };
  }
  if (!safeEqual(match[1], expectedToken)) {
    return { ok: false, status: 401, error: 'Invalid bearer token' };
  }
  return { ok: true };
}

/** Constant-time compare for a cookie value against the expected token. */
export function checkCookieToken(
  cookieValue: string | undefined,
  expectedToken: string,
): AuthCheckResult {
  if (!cookieValue) {
    return { ok: false, status: 401, error: 'Missing session cookie' };
  }
  if (!safeEqual(cookieValue, expectedToken)) {
    return { ok: false, status: 401, error: 'Invalid session cookie' };
  }
  return { ok: true };
}

/**
 * Build the allowlist of hostnames we accept on the Host and Origin headers
 * for a given listen port. Only loopback names; remote names are never OK.
 */
export function buildLoopbackAllowlist(port: number): Set<string> {
  return new Set([
    `localhost:${port}`,
    `127.0.0.1:${port}`,
    `[::1]:${port}`,
    'localhost',
    '127.0.0.1',
    '[::1]',
  ]);
}

/** Reject Host header values that aren't loopback. */
export function checkHost(
  host: string | undefined,
  allowlist: Set<string>,
): AuthCheckResult {
  if (!host) {
    return { ok: false, status: 400, error: 'Missing Host header' };
  }
  if (!allowlist.has(host.toLowerCase())) {
    return {
      ok: false,
      status: 403,
      error: `Host header "${host}" is not allowed. Only loopback hosts are accepted.`,
    };
  }
  return { ok: true };
}

/**
 * Reject Origin headers that look like they came from a remote browser. A
 * missing Origin is allowed (non-browser clients don't send one); a present
 * Origin must point at a loopback host on our port.
 */
export function checkOrigin(
  origin: string | undefined,
  allowlist: Set<string>,
): AuthCheckResult {
  if (!origin) return { ok: true };
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return { ok: false, status: 403, error: `Malformed Origin header "${origin}"` };
  }
  const hostWithPort = url.host.toLowerCase();
  const hostOnly = url.hostname.toLowerCase();
  if (!allowlist.has(hostWithPort) && !allowlist.has(hostOnly)) {
    return {
      ok: false,
      status: 403,
      error: `Origin "${origin}" is not allowed. Only loopback origins are accepted.`,
    };
  }
  return { ok: true };
}
