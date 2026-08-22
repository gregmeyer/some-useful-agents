import { Router, type Request, type Response } from 'express';
import { checkHost, checkOrigin } from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { buildSessionCookie, buildSeenCookie, sessionMaxAgeSeconds } from '../session.js';
import { layout } from '../views/layout.js';
import { html, render } from '../views/html.js';

export const authRouter: Router = Router();

/** "30 days" / "8 hours" — for copy that has to state the actual window. */
function describeSessionWindow(): string {
  const hours = Math.round(sessionMaxAgeSeconds() / 3600);
  if (hours % 24 === 0 && hours >= 24) {
    const days = hours / 24;
    return days === 1 ? '1 day' : `${days} days`;
  }
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

authRouter.get('/auth', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);

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

  // `?expired=1` is set by requireAuth when the browser carries the non-secret
  // `seen` marker — i.e. it signed in successfully before and the session has
  // since lapsed. The two cases need different copy: telling someone whose
  // session just expired to "find the URL your terminal printed" sends them
  // hunting for a line the still-running daemon will never print again.
  const expired = req.query.expired === '1';

  // Serve a page that reads the token from the URL fragment (never sent to
  // the server in HTTP requests, never logged, never leaked via Referrer)
  // and POSTs it. Falls back to the hint page when no fragment is present.
  res.status(200).type('html').send(render(layout(
    { title: expired ? 'Session expired' : 'Sign in' },
    html`
      <div id="auth-hint" style="display:none">
        ${expired
          ? html`
            <h1>Your session expired</h1>
            <p>You were signed out after ${describeSessionWindow()} of inactivity.
            Nothing is wrong with the dashboard, and none of your agents, runs, or
            settings are affected — this browser just needs to sign in again.</p>
            <p>Ask whoever set sua up for you, or run this in a terminal on
            <strong>this machine</strong> to print a fresh sign-in link:</p>
            <pre>sua dashboard signin-url</pre>
            <p>Then open the link it prints. To be signed out less often, raise the
            window with <code>SUA_DASHBOARD_SESSION_HOURS</code>.</p>`
          : html`
            <h1>Sign in required</h1>
            <p>The dashboard is locked until you visit the one-time URL that
            <code>sua dashboard start</code> printed to your terminal.</p>
            <p>Look for a line starting with:</p>
            <pre>Dashboard ready at http://127.0.0.1:${ctx.port}/auth#token=&lt;...&gt;</pre>
            <p>Click it once to set a session cookie; after that, bookmark
            <a href="/">http://127.0.0.1:${ctx.port}/</a>.</p>
            <p>No terminal handy? Run <code>sua dashboard signin-url</code> on this
            machine to reprint the link at any time.</p>`}
      </div>
      <p id="auth-status">Authenticating...</p>
      <script>
        (function() {
          var h = location.hash;
          var m = h && h.match(/^#token=(.+)$/);
          if (!m) {
            document.getElementById('auth-hint').style.display = '';
            document.getElementById('auth-status').style.display = 'none';
            return;
          }
          // Clear the fragment so it doesn't linger in browser history
          history.replaceState(null, '', location.pathname);
          fetch('/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: decodeURIComponent(m[1]) }),
          }).then(function(res) {
            if (res.redirected) { location.href = res.url; return; }
            if (res.ok) { location.href = '/'; return; }
            return res.text().then(function(t) {
              document.getElementById('auth-status').textContent = 'Authentication failed. Copy the URL from your terminal again.';
            });
          }).catch(function() {
            document.getElementById('auth-status').textContent = 'Network error. Please try again.';
          });
        })();
      </script>
    `,
  )));
});

authRouter.post('/auth', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);

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

  const token = typeof req.body?.token === 'string' ? req.body.token : undefined;

  if (!token || token.length !== ctx.token.length || !timingSafeEqualStrings(token, ctx.token)) {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }

  // Token matches. Set both cookies: the session credential, and the
  // long-lived non-secret marker that lets a later expiry be reported as an
  // expiry rather than as a first visit. Cookie flags are documented in
  // session.ts alongside the window policy.
  res.setHeader('Set-Cookie', [buildSessionCookie(token), buildSeenCookie()]);
  res.redirect(302, '/');
});

function timingSafeEqualStrings(a: string, b: string): boolean {
  // Length already checked before calling; do a constant-time scan anyway.
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
