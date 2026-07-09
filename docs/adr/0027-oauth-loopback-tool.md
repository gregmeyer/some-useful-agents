# ADR-0027: `oauth-loopback` built-in tool — a listener-binding, secret-writing tool

## Status

Accepted (shipped alongside the `oauth-loopback` built-in tool)

## Context

Several useful APIs (Spotify, Google, GitHub, Reddit, …) gate access behind an OAuth2
**authorization-code** flow: a human must consent in a browser, the provider redirects to a
pre-registered `redirect_uri` with a short-lived `code`, and that code is exchanged for a
long-lived **refresh token**. Once the refresh token exists, unattended agents mint access
tokens from it with a simple refresh-grant `curl` (as the `spotify-playlist-builder` agent's
`get-token` node already does).

The runtime had no way to *obtain* that refresh token:

- No authorization-code flow exists anywhere in the codebase.
- The `http-get`/`http-post` built-ins **block loopback/private IPs** (SSRF guard), so a
  loopback callback listener can't be built from them.
- Built-in tools receive only `{ workingDirectory, env, timeout }` — they can *read* secrets
  (injected into `env` from a node's `secrets:`) but have **no channel to write** one. The
  only secret-writer was the `sua secrets set` CLI.

So provisioning a refresh token was a manual, out-of-band chore (run a throwaway script,
copy the token into Settings → Secrets). We want a first-class, reusable tool that does the
whole loopback flow and persists the result.

## Decision

Ship an **`oauth-loopback` built-in tool** and give built-in tools an **optional secrets-store
handle** so this tool (and only tools that opt in) can persist a token.

1. **Thread the store into `BuiltinToolContext`.** Add `secretsStore?: SecretsStore` to the
   context. The DAG executor already holds `deps.secretsStore` at built-in dispatch (it
   passes it to generated integration tools); it now also puts it on the context. Backward
   compatible — every existing built-in ignores it.

2. **The tool binds a one-shot loopback server.** `http.createServer` on `127.0.0.1:<port>`,
   waits for the redirect, validates `state`, captures the `code`, exchanges it at
   `token_url`, and closes the server. `authorize_url`/`token_url` still pass the SSRF check
   (public hosts); the loopback is a server we own, not a URL we fetch, so it is exempt.

3. **Tokens go only to the vault, never to `runs.db`.** The tool refuses to run without a
   `save_refresh_token_to` (or `save_access_token_to`) target and returns only secret names
   plus non-secret metadata (`saved_to`, `has_refresh_token`, `expires_in`, `scope`,
   `token_type`). Structured tool output is persisted to the plaintext runs database, so
   emitting a raw refresh token there would be a worse leak than the encrypted vault it's
   meant to populate.

4. **Provider-agnostic via env-var indirection.** The client id/secret are read from the
   node's declared `secrets:` through the `client_id_env` / `client_secret_env` input names,
   so the same tool serves Spotify (`SPOTIFY_CLIENT_ID`) and any other provider without
   hard-coded names. PKCE (S256) is supported opt-in for public clients.

## Consequences

**Positive**
- First-run authorization becomes a normal agent node. The Spotify fix is a tiny companion
  `spotify-authorize` agent (single `oauth-loopback` node) run once; the main playlist DAG is
  untouched.
- Reusable for any OAuth2 provider; PKCE-ready.
- The secret never touches the runs database.

**Negative / trade-offs**
- **Two new trust surfaces in one tool:** binding a local listener and writing to the secrets
  vault. Mitigations: loopback-only bind, short-lived server, validated `state`, SSRF check on
  the remote URLs, write gated to the explicitly node-configured secret name, and the existing
  `evaluatePolicy` tool gate still applies. A future tool-policy rule could deny `oauth-loopback`
  or restrict which secret names any tool may write.
- **Interactive + blocking.** The node blocks up to `timeout` seconds waiting for a human to
  consent, so it fits a manual "run once" step, not a scheduled agent. It surfaces the
  authorize URL via auto-open + the worker log.
- `BuiltinToolContext` now carries a capability (`secretsStore`) most tools don't need. Kept
  optional and documented so future built-ins don't reach for it casually.

## Alternatives considered

- **Keep it CLI-only** (`sua oauth authorize …`). Rejected: the user asked for a first-class
  tool usable *from an agent*, and a tool composes with the DAG, policy, and dashboard.
- **Return the token as output, copy it in manually.** Rejected: puts a long-lived refresh
  token in `runs.db` and reintroduces the manual copy step the tool exists to remove.
- **A dedicated secret-write built-in + a shell loopback node.** Rejected: more moving parts,
  and a generic "write any secret" tool is a broader trust surface than a focused OAuth tool.
