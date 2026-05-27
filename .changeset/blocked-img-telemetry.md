---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Auto-detect CSP-blocked image hosts and offer one-click "Allow" on the
agent config page.

The dashboard's per-agent CSP `img-src` allowlist is empty by default,
so a freshly-installed widget that loads an external image (e.g.
`apod.nasa.gov`) renders broken until the user copies the offending
hostname from the console into the agent config form. This PR closes
that loop: a small client listener (`csp-img-report.js.ts`) catches
`securitypolicyviolation` events filtered to the `img-src` directive,
finds the owning `.pulse-tile[data-agent-id]`, and POSTs `{agentId,
host}` to `/api/img-block-report`. The new `BlockedImgHostsStore`
records the pair (with a count + last-seen timestamp). The agent's
**Config → Permissions** card now shows a **Recently blocked** panel
above the textarea with one-click pills — clicking `+ apod.nasa.gov`
hits the existing `/permissions/allow-host` endpoint and clears the
suggestion.

Best-effort throughout: missing store, malformed hosts, IP literals,
and offline POSTs are all silently dropped — the page-render path
never fails because telemetry is unavailable.
