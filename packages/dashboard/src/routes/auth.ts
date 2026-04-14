import { Router, type Request, type Response } from 'express';
import { checkHost, checkOrigin } from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { SESSION_COOKIE } from '../auth-middleware.js';
import { layout } from '../views/layout.js';
import { html, render } from '../views/html.js';

const COOKIE_MAX_AGE_SECONDS = 8 * 60 * 60; // 8 hours

export const authRouter: Router = Router();

authRouter.get('/auth', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);

  // Host/Origin still checked on /auth — the token is the only thing the
  // path cares about, but we don't want a DNS-rebind attacker to set a
  // cookie we'd accept on subsequent requests.
  const hostCheck = checkHost(req.headers.host, ctx.allowlist);
  if (!hostCheck.ok) {
    res.status(hostCheck.status).json({ error: hostCheck.error });
    return;
  }
  const origin = Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin;
  const originCheck = checkOrigin(origin, ctx.allowlist);
  if (!originCheck.ok) {
    res.status(originCheck.status).json({ error: originCheck.error });
    return;
  }

  const token = typeof req.query.token === 'string' ? req.query.token : undefined;

  if (!token) {
    // No token: show a static "paste the URL" hint page.
    res.status(200).type('html').send(render(layout(
      { title: 'Sign in' },
      html`
        <h1>Sign in required</h1>
        <p>The dashboard is locked until you visit the one-time URL that
        <code>sua dashboard start</code> printed to your terminal.</p>
        <p>Look for a line starting with:</p>
        <pre>Dashboard ready at http://127.0.0.1:${ctx.port}/auth?token=&lt;...&gt;</pre>
        <p>Click it once to set a session cookie; after that, bookmark
        <a href="/">http://127.0.0.1:${ctx.port}/</a>.</p>
      `,
    )));
    return;
  }

  // Constant-time compare via the same helper the cookie middleware uses,
  // even though here we have the token as a query string.
  if (token.length !== ctx.token.length || !timingSafeEqualStrings(token, ctx.token)) {
    res.status(401).type('html').send(render(layout(
      { title: 'Invalid token', flash: { kind: 'error', message: 'Invalid token. Copy the URL from your terminal again, or run `sua mcp rotate-token` and restart the dashboard.' } },
      html`<p><a href="/auth">Back</a></p>`,
    )));
    return;
  }

  // Token matches: set cookie, redirect to /.
  // HttpOnly — JS can't read the token via document.cookie
  // SameSite=Strict — no cross-site sends, our CSRF defense pairs with Origin
  // Max-Age — 8 hours, re-auth by revisiting the printed URL
  // Not Secure — dashboard binds 127.0.0.1 so HTTPS isn't in play
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE_SECONDS}; Path=/`,
  );
  res.redirect(302, '/');
});

function timingSafeEqualStrings(a: string, b: string): boolean {
  // Length already checked before calling; do a constant-time scan anyway.
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
