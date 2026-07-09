---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Add the `oauth-loopback` built-in tool for one-time OAuth2 authorization.

A new built-in tool runs the OAuth2 authorization-code flow over a local
`127.0.0.1` redirect: it opens the provider consent screen, captures the
redirect on a throwaway loopback server, exchanges the code for tokens, and
writes the refresh (and/or access) token straight into the encrypted secrets
vault. It reads the client id/secret from the node's declared `secrets:` via the
`client_id_env` / `client_secret_env` inputs, supports PKCE, and never returns
raw tokens in its output (so nothing lands in the runs database).

This unblocks agents that need a user-consented refresh token — e.g. the Spotify
playlist builder can now be provisioned by a one-time `oauth-loopback` node.
Built-in tools can now optionally receive the secrets store via
`BuiltinToolContext.secretsStore`. See `docs/tools/oauth-loopback.md` and
ADR-0027.
