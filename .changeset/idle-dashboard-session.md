---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

The dashboard session no longer expires out from under you, and expiry is recoverable.

The session was an absolute 8 hours from sign-in with no renewal, so anyone using
the dashboard daily was signed out roughly once a day no matter how active they
were. Getting back in required the one-time `/auth#token=…` URL that
`sua dashboard start` prints only at boot — with the daemon still running, that
line never comes again, which left non-technical operators unable to sign in
without someone at a terminal.

- The window is now **idle** time, renewed on each page load, defaulting to 30
  days. Set `SUA_DASHBOARD_SESSION_HOURS=8` for the previous posture.
- An expired session now says it expired, instead of showing the same
  "find the URL your terminal printed" copy a first-time visitor gets.
- An already-open tab shows a "You have been signed out" banner instead of
  silently going dead — previously every in-page fetch and the inbox SSE stream
  just failed with an unhandled 401 and nothing on screen changed.
- New `sua dashboard signin-url` reprints a sign-in link for an already-running
  dashboard.

This relaxes a control listed in `docs/SECURITY.md`; the reasoning, and the
same-origin re-auth endpoint that was rejected, are recorded in ADR-0033.
