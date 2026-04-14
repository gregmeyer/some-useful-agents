import type { Request, Response, NextFunction } from 'express';
import { checkCookieToken, checkHost, checkOrigin } from '@some-useful-agents/core';
import { getContext } from './context.js';

export const SESSION_COOKIE = 'sua_dashboard_session';

/**
 * Parse a single cookie value out of the Cookie header. We keep this inline
 * instead of pulling cookie-parser — we only care about our one cookie, and
 * the parser package is another surface with upstream CVEs in its history.
 */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) {
      // Values beyond our control are trimmed; we don't need URL-decoding
      // because our cookie is the token string itself, which is hex only.
      return part.slice(eq + 1).trim();
    }
  }
  return undefined;
}

/**
 * Gate every non-public route through:
 *   1. Host header allowlist (belt-and-suspenders if operator set --host 0.0.0.0)
 *   2. Origin header allowlist (the real DNS-rebinding defense)
 *   3. Session cookie token constant-time compare against the file token
 *
 * Public routes (/health, /auth) bypass the middleware via the router wiring.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const ctx = getContext(req.app.locals);

  // Host check: reject non-loopback Hosts unless the operator explicitly
  // opted in (which flows through the allowlist at startup).
  const hostCheck = checkHost(req.headers.host, ctx.allowlist);
  if (!hostCheck.ok) {
    res.status(hostCheck.status).json({ error: hostCheck.error });
    return;
  }

  // Origin check: browsers send this; non-browser clients don't. Reject
  // any present Origin that isn't loopback (blocks DNS rebinding).
  const originCheck = checkOrigin(pickFirst(req.headers.origin), ctx.allowlist);
  if (!originCheck.ok) {
    res.status(originCheck.status).json({ error: originCheck.error });
    return;
  }

  // Cookie check: the cookie value is the bearer token itself, hashed-
  // equivalent to the token file. If the file token rotates, existing
  // cookies stop working naturally.
  const cookie = readCookie(pickFirst(req.headers.cookie), SESSION_COOKIE);
  const cookieCheck = checkCookieToken(cookie, ctx.token);
  if (!cookieCheck.ok) {
    // For HTML routes, redirect to the auth hint page instead of JSON.
    // Programmatic callers (if any) get the JSON fallback via Accept.
    if ((req.headers.accept ?? '').includes('text/html')) {
      res.redirect(302, '/auth');
      return;
    }
    res.status(cookieCheck.status).json({ error: cookieCheck.error });
    return;
  }

  next();
}

function pickFirst(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}
