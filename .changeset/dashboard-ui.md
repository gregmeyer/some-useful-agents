---
"@some-useful-agents/cli": minor
"@some-useful-agents/core": minor
"@some-useful-agents/dashboard": minor
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
---

**feat: `sua dashboard start` — read-only web UI with run-now + runs filter/pagination.** Closes v0.12's scope: a monitoring + nudge surface that complements the CLI without duplicating it.

### What ships

- `sua dashboard start [--port 3000] [--host 127.0.0.1]` boots an Express app that shares the MCP bearer token at `~/.sua/mcp-token` for auth. Prints a one-time sign-in URL; cookie is the token itself, `HttpOnly` + `SameSite=Strict`, 8-hour expiry.
- **Routes:** `/` redirects to `/agents`; `/agents` lists everything loadable with type/source badges; `/agents/:name` shows resolved YAML, declared inputs, live secrets-status (green/red/"unknown (store locked)" when v2 passphrase-protected), recent runs, run-now button.
- **`/runs` — runs list with filters and pagination.** Agent dropdown + Triggered-by dropdown + multi-status checkboxes (OR within, AND across) + free-text `?q=` that prefix-matches on run id and substring-matches on agent name (case-insensitive). `?limit=` default 50, max 500. `?offset=` Prev/Next links preserve all filter state through the URL query string.
- **`/runs/:id` — run detail** with status badge, timing, output frame, error pane. In-progress runs inline a 2-second poll via vanilla JS that swaps the container fragment without a full page reload.
- **Run-now gate.** Local/examples agents submit directly. Community shell agents show a modal with the command and require an explicit audit checkbox before submit; the server double-checks `confirm_community_shell=yes` on the POST. Provider-level `UntrustedCommunityShellError` still applies — the modal is a UX, not a security, gate.
- **Defenses** match MCP: `127.0.0.1` bind by default, Host + Origin allowlists (identical to the MCP server's, now shared via `@some-useful-agents/core/http-auth`), cookie-based session, CSRF defense via Origin check.

### New types + API

- `Run.triggeredBy` adds `'dashboard'` to the union.
- New `DashboardContext` exported from `@some-useful-agents/dashboard` for test harnesses that want to drive `buildDashboardApp(ctx)` via supertest without spinning an HTTP listener.

### Dependencies

Adds `supertest` + `@types/supertest` (dev) to the dashboard package. Runtime deps unchanged — the UI is tagged template literals + inlined CSS/JS, no framework, no bundler, no CDN.

### Tests

`packages/dashboard/src/dashboard.test.ts` — 15 supertest cases covering auth flows (cookie round-trip, Host/Origin rejection, wrong-token 401), filter routing (agent / status OR / unknown-status defense / pagination link preservation), and the run-now gate (community modal refusal without confirm, provider gate still fires with confirm).

302 tests total across the repo (was 287; +15 new).

### Out of scope (deferred)

- Custom-input form for run-now (YAML defaults only, as in the plan)
- Editing YAML or setting secrets from the UI
- Mermaid topology view of agent chains (planned for v0.13 alongside LLM-discoverable docs)

### Manual verify

```bash
cd /tmp && mkdir sua-play && cd sua-play
sua init
sua agent run hello
sua dashboard start --port 3000
# Click the printed auth URL → cookie set → bookmark /
# Explore /agents, /runs, try the run-now button.
```
