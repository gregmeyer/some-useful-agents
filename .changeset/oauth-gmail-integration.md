---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

OAuth infrastructure + Gmail integration kind (PR 3 of 4)

Third PR of the Settings → Integrations workstream. Adds a generic
OAuth flow (PKCE + S256 challenge, in-memory state map, single-use
state consumption, stable `/oauth/callback` redirect_uri on the
dashboard's existing port) and uses it to land the first OAuth-backed
integration kind: `gmail`.

How it works:
- User creates a Google Cloud OAuth client (type "Desktop app"),
  registers `http://127.0.0.1:3000/oauth/callback` as a redirect URI.
- User adds the client_id + client_secret in `/settings/secrets`.
- User creates a Gmail integration in `/settings/integrations` and
  clicks **Connect Google**. The dashboard generates state + PKCE
  verifier, redirects to Google consent, and on callback exchanges
  the code for tokens.
- Refresh token is stored in the encrypted secrets store as
  `<INTEGRATION_ID>__REFRESH_TOKEN`. The integration row gains
  `connected_account` (the user's email), `connected_at`, and
  `refresh_token_secret` so handlers know what to read.
- Notify handlers of type `gmail` reference the integration by id +
  the inline per-message fields (`to`, `subject`, `body`). The
  dispatcher refreshes the access token per send and calls Gmail's
  messages.send API. Disconnect deletes the refresh token + clears
  the connected state.

Tests: +18 (PKCE, state store, OAuth route flow, dispatcher Gmail
handler success + missing-connection failure). Total 1218 passing.
