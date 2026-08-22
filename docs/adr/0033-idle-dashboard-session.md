# ADR-0033: The dashboard session is an idle window, and expiry is recoverable

- Status: accepted
- Date: 2026-08-21
- Deciders: Greg Meyer

## Context

The dashboard session was an **absolute** 8-hour cookie. The clock started at
sign-in and was never extended — `requireAuth` validated the cookie but never
re-issued it. So the length of a session had nothing to do with how much someone
was using the dashboard: a person who had it open all day was signed out at hour
eight regardless.

Recovery required a terminal. The only way to sign in was the one-time
`/auth#token=<...>` URL that `sua dashboard start` prints, and it prints it
**once, at boot**. After an expiry the daemon is still running and will never
print that line again. The sign-in page nonetheless told the reader to go find
it:

> The dashboard is locked until you visit the one-time URL that
> `sua dashboard start` printed to your terminal.

It could not have said anything better, because it could not tell the two cases
apart: the session cookie *is* the bearer token, so when it expires the browser
deletes it and an expired operator looks byte-for-byte identical to a first-time
visitor.

And it was silent. In an already-open tab nothing reported the change at all.
Every page holds an SSE stream (`/inbox/events`) whose `Accept: text/event-stream`
misses the HTML redirect branch and gets a bare 401; `EventSource` then
reconnect-loops forever. There was **no 401 handling in any client script** — a
grep across `views/*.js.ts` for `401` or `res.ok` returned nothing. Buttons
stopped working, the feed stopped updating, and nothing said why.

This matters because of who the dashboard is for. sua is a developer tool, and
DESIGN.md says so — but the dashboard is also the surface a **non-technical
operator** is handed, and for that person "sign in again" required a developer.
A daily lockout with a developer-only recovery path is not a session policy; it
is an outage on a schedule.

## Decision

**1. The window is idle time, not total time.** `requireAuth` re-issues the
session cookie on authenticated HTML GETs. Someone who uses the dashboard keeps
their session.

Renewal is scoped to navigations, not every request. Renewing on assets, polls
and SSE would put a `Set-Cookie` on hundreds of responses, and — worse — the 30s
inbox badge poll alone would keep an abandoned open tab authenticated forever.

**2. The default window is 30 days, configurable via
`SUA_DASHBOARD_SESSION_HOURS`.** A sliding *8-hour* window would not have fixed
the reported problem: a daily user's overnight gap exceeds 8 hours, so they
would still be signed out every morning. The window has to clear a night with
room to spare. A malformed or out-of-range value falls back to the default,
never to zero (instant lockout) or infinity.

**3. A second cookie makes expiry legible.** `sua_dashboard_seen=1` carries no
secret and outlives the session. Its only job is to let `requireAuth` route an
expired browser to `/auth?expired=1` and a new one to `/auth`, so each gets copy
it can act on. It is never consulted for authorization.

**4. 401s are tagged and the client says so.** `requireAuth`'s JSON branch adds
`signedOut: true`, and a client guard wraps `window.fetch` once — covering every
existing and future in-page request without touching call sites — plus a 60s
heartbeat against `/session/ping` for pages that issue no other requests. A
non-modal banner tells the operator they were signed out.

**5. `sua dashboard signin-url` reprints the link on demand.** This is what makes
the expired-page copy true.

## Consequences

**Good.** A daily operator is never signed out. When a session does lapse, the
page says so instead of appearing broken, and the instructions describe something
that can actually be done. The `fetch` wrapper means future in-page requests get
sign-out handling for free.

**Cost — this weakens a documented control.** `docs/SECURITY.md` listed
"8-hour expiry" among the dashboard's defenses; the default is now 90× longer.
The judgement is that cookie lifetime was never the control doing the work: the
loopback bind, the Host and Origin allowlists (the actual DNS-rebinding defense),
`HttpOnly`, and `SameSite=Strict` are. A stolen cookie on a machine where an
attacker can already read `~/.sua/mcp-token` is not the marginal risk. Operators
who disagree set `SUA_DASHBOARD_SESSION_HOURS=8` and are exactly where they were.
`sua mcp rotate-token` still kills every session immediately.

**A new credential path.** `sua dashboard signin-url` prints a token-bearing URL
on demand. It requires local shell access — the same access that could read the
token file directly — so it grants no new capability, but it does make the
credential easier to copy into a chat window. Its help text says so.

**Not addressed.** There is still no way for the operator to re-authenticate
without *someone* having shell access. A no-token re-auth endpoint was rejected
(below), so the mitigation is to make expiry rare rather than self-serviceable.

## Alternatives considered

**A same-origin re-auth endpoint with no token** — the server already holds the
token in memory, so `/auth/refresh` could just mint a session for any loopback
caller that passes the Host and Origin checks. This is the only option that
would let an operator recover with zero terminal access, and it was tempting for
exactly that reason. **Rejected:** it would let *any* local process — a
malicious npm postinstall, a browser extension shelling out, another user on a
shared box — obtain a dashboard session by issuing one request. That converts
the bearer token from a credential into decoration, which is too much to trade
for better ergonomics on a once-a-month event.

**Keep 8 hours, just fix the copy.** Cheap and honest, and it fixes the
misdirection. **Rejected:** the operator would still be locked out daily and
still need a developer daily. Better wording on a recurring outage is not a fix.

**Sliding 8-hour window.** Renewal without lengthening. **Rejected:** an
overnight gap is longer than 8 hours, so a daily user is signed out every
morning — the exact reported symptom, unmoved.

**A refresh cookie holding the token with a long life.** Functionally identical
to a long session cookie, with a second copy of the credential on disk. Strictly
worse.
