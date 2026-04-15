---
"@some-useful-agents/dashboard": minor
"@some-useful-agents/cli": patch
---

**feat: settings CRUD in the dashboard — secrets + MCP token rotation (PR 4 of 5 for v0.15).**

Moves the last CLI-only admin surfaces into the dashboard so operators can manage secrets and rotate the MCP bearer token without leaving the browser. Unblocks v0.16 AI-assist, whose Anthropic API key needs the `/settings/secrets` surface to have a home.

### What ships

- **`/settings/secrets`** — list declared secret names (values never rendered), set a new secret, delete an existing one. Agent-declared secrets that aren't yet set are called out in a "Declared by agents but not set" list so missing config is visible without running `sua doctor`.
- **Passphrase unlock flow** — when the store is `v2` passphrase-protected, the page renders a dedicated unlock form instead of the list. A correct passphrase is cached in dashboard-process memory for the rest of the session; never written to disk, cookies, or sessionStorage. A "Lock now" button clears it.
- **`/settings/general`** — MCP token fingerprint (first 8 chars), retention-policy display, path block showing the run DB, secrets file, and MCP token file so users know where sua is reading and writing.
- **MCP token rotation** — one-click rotate from `/settings/general`. The handler writes a fresh token to `~/.sua/mcp-token`, updates the in-process auth check, re-mints the dashboard session cookie so the operator stays signed in, and reveals the new value exactly once. Existing MCP clients (Claude Desktop) break until they're updated — the confirm dialog spells that out.
- **`/settings/integrations`** — placeholder unchanged in behaviour, with copy updated to reflect that integrations are a later-release feature.

### Design notes

- **Origin check is the CSRF defence.** Every POST under `/settings/*` flows through `requireAuth`, which already rejects non-loopback `Origin` headers. No second CSRF token layer needed.
- **Passphrase never persisted.** Cached in a closure on the `SecretsSession` instance, cleared on `lock()` and at process shutdown. Dashboards that crash or restart require re-unlock — intentional.
- **Declared-secrets discovery tolerates broken YAML.** A malformed agent file must not prevent the settings page from rendering; `collectDeclaredSecrets` swallows loader errors and falls back to what the v2 store knows.
- **Rotated token is shown inline, not via flash.** `?rotated=<token>` in the redirect URL renders once on `/settings/general`; we accept that a browser back/reload can re-display it because the dashboard is a local loopback and the user asked to see it.

### Files

- New: `packages/dashboard/src/secrets-session.ts` (SecretsSession interface + `EncryptedFileSecretsSession` + `MemorySecretsSession` for tests), `packages/dashboard/src/views/settings-secrets.ts`, `packages/dashboard/src/views/settings-general.ts`, `packages/dashboard/src/secrets-session.test.ts`
- Modified: `packages/dashboard/src/routes/settings.ts` (real CRUD + unlock/lock/rotate routes), `context.ts` (tokenPath, secretsPath, dbPath, retentionDays, rotateToken, secretsSession), `index.ts` (wire new context fields + construct the session), `views/js.ts` (add `[data-confirm]` submit handler), `assets/screens.css` (settings-form styles), `packages/cli/src/commands/dashboard.ts` (pass retentionDays)

### Tests

75 dashboard tests total (55 → 75; +20 new):
- Unlock form gates the list when passphrase-protected + locked
- Wrong passphrase is rejected; correct passphrase unlocks the session
- `POST /settings/secrets/set` validates the `^[A-Z_][A-Z0-9_]*$` name pattern, rejects writes while locked, and stores + redirects on success
- `POST /settings/secrets/delete` removes a stored secret
- `POST /settings/secrets/lock` clears the cached passphrase
- Cross-origin POST to `/settings/secrets/set` is refused (Origin check)
- `/settings/general` renders the token fingerprint + retention + paths and never leaks the full token
- `POST /settings/general/rotate-mcp-token` rotates, re-mints the session cookie, updates `ctx.token`, and reveals the new value once
- After rotation, the old cookie is rejected and the new one authenticates
- `/settings/integrations` renders placeholder copy
- `EncryptedFileSecretsSession` round-trips through a real file, enforces passphrase gating, and throws when writing while locked
- `MemorySecretsSession` simulates the passphrase-protected flow for dashboard tests

### Plan

Remaining v0.15 PR: **5 (replay UI + microcopy polish + changeset release for the v0.15-follow-on bundle)**. v0.16 structured-outputs work comes after v0.15 wraps.
