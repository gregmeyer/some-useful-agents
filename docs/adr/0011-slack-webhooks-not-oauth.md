# ADR-0011: Slack via incoming webhooks, not OAuth

## Status
Proposed

## Context

A near-term roadmap item is notifications — when a scheduled agent runs,
post the result somewhere the user will see it (Slack, email, file
append, dashboard, etc.). For Slack specifically, two integration paths:

1. **Incoming webhooks** — the user creates an app in their Slack
   workspace, enables incoming webhooks, gets a URL like
   `https://hooks.slack.com/services/T.../B.../xxx`. POST JSON to that URL
   and it posts in the channel. One-time ~5-minute setup. No OAuth flow.

2. **OAuth** — user authorizes the sua app via Slack's OAuth flow. Gets a
   refresh-capable bot token that can post as an app, read channels,
   manage users, etc. Requires:
   - A registered Slack app (the sua maintainers must maintain one)
   - A redirect URL (the OAuth callback)
   - Token storage and refresh logic
   - A public HTTPS endpoint for the callback — **problematic for a CLI
     tool with no public web surface**

The OAuth route's redirect-URL requirement is the killer. sua runs
locally. There's no `https://sua.example.com/oauth/callback`. You'd need
to spin up a local server on a known port, direct the Slack OAuth to it,
handle the callback, and close the loop. Doable but adds meaningful
complexity for ~zero benefit over webhooks in the local-notifications
use case.

## Decision

Use Slack **incoming webhooks**. Users configure their webhook once in
their Slack workspace, then:

```bash
sua secrets set SLACK_WEBHOOK <url>
```

Agent YAML references it:

```yaml
name: daily-digest
secrets: [SLACK_WEBHOOK]
notify:
  slack: { webhook: SLACK_WEBHOOK }  # future notify schema
```

The notify handler reads `process.env.SLACK_WEBHOOK` (injected from the
encrypted secrets store via env-builder) and POSTs the run result.

OAuth is **explicitly rejected** for this use case. If a future user needs
OAuth (for, e.g., reading channel contents programmatically, acting as a
bot user), that's a separate integration and different ADR.

## Consequences

**Easier:**
- Zero auth infrastructure to maintain.
- User setup: 5 minutes in Slack UI, one `sua secrets set` command.
- Works today once notify handlers are built — secrets infra is already
  shipped (ADR-0007).

**Harder:**
- Limited to posting-only. Can't read channels, edit messages, DM users,
  or do anything richer.

**Trade-offs accepted:**
- The richer Slack integrations are out of scope for a local scheduled-
  agent tool. If the project ever evolves into a team collaboration
  platform, OAuth gets revisited.

## Status notes

Marked **Proposed** because notify handlers aren't shipped yet. Upgrade to
**Accepted** when the first notify handler lands.
