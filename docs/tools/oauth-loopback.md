# oauth-loopback

One-time **OAuth2 authorization-code flow** over a local loopback redirect. It opens the
provider's consent screen, captures the redirect on a throwaway `127.0.0.1:<port>` server,
exchanges the authorization code for tokens, and **writes the refresh (and/or access) token
straight into the encrypted secrets vault**. Use it once to bootstrap a long-lived
`*_REFRESH_TOKEN` for an API that requires user consent (Spotify, Google, GitHub, …); after
that, your normal refresh-grant node runs unattended.

This is the first built-in tool that binds a network listener and that persists a secret.
See [Security](#security) and [ADR-0027](../adr/0027-oauth-loopback-tool.md).

## How it works

1. Reads the OAuth **client id** (and optional **client secret**) from the node's declared
   `secrets:` — via the env vars named by `client_id_env` / `client_secret_env`.
2. Builds the authorize URL (`response_type=code`, `redirect_uri=http://127.0.0.1:<port><redirect_path>`,
   `scope`, a random `state`, optional PKCE S256 challenge, plus any `extra_authorize_params`).
3. Binds a one-shot server on `127.0.0.1:<port>`, prints the URL (and opens the browser if
   `open_browser`), and waits for the redirect.
4. Validates `state` (CSRF), captures the `code`, and POSTs it to `token_url` for the tokens.
5. Writes `refresh_token` → `save_refresh_token_to` (and `access_token` → `save_access_token_to`
   if set) into the vault. **Tokens are never returned in the tool output** — the structured
   output that lands in `runs.db` contains only names and non-secret metadata.

## Inputs

| Name | Type | Required | Description |
|---|---|---|---|
| `authorize_url` | string | yes | Provider authorization endpoint (e.g. `https://accounts.spotify.com/authorize`) |
| `token_url` | string | yes | Provider token endpoint (e.g. `https://accounts.spotify.com/api/token`) |
| `client_id_env` | string | no | Name of the declared secret / env var holding the client id (default `CLIENT_ID`) |
| `client_secret_env` | string | no | Name of the secret holding the client secret (default `CLIENT_SECRET`); omit for PKCE-only public clients |
| `scopes` | string | no | Space-separated OAuth scopes |
| `port` | number | no | Loopback port to bind (default `8888`). `redirect_uri = http://127.0.0.1:<port><redirect_path>` |
| `redirect_path` | string | no | Redirect path (default `/callback`) |
| `save_refresh_token_to` | string | * | Secret name to persist the refresh token into. Required to capture a refresh token |
| `save_access_token_to` | string | * | Secret name to persist the access token into |
| `use_pkce` | boolean | no | Add a PKCE (S256) challenge/verifier (default `false`) |
| `open_browser` | boolean | no | Attempt to open the authorize URL in the default browser (default `true`) |
| `timeout` | number | no | Seconds to wait for the redirect (default `300`) |
| `extra_authorize_params` | object | no | Extra query params for the authorize URL (e.g. `{"show_dialog":"true"}`) |

\* At least one of `save_refresh_token_to` / `save_access_token_to` is required — the tool
never returns raw tokens, so a save target is the only way to capture one.

## Outputs

| Name | Type | Description |
|---|---|---|
| `saved_to` | array | Secret names written to the vault |
| `has_refresh_token` | boolean | Whether the provider returned a refresh token |
| `expires_in` | number | Access-token lifetime in seconds, if returned |
| `scope` | string | Granted scopes, if returned |
| `token_type` | string | Token type, if returned (e.g. `Bearer`) |
| `authorize_url_used` | string | The full authorize URL that was opened |
| `result` | string | Human-readable summary — contains no token values |

## Example

The `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` secrets are declared on the node, so they
arrive as env vars; the tool reads them via `client_id_env` / `client_secret_env`.

```yaml
- id: authorize
  type: shell           # placeholder — `tool` provides the implementation
  tool: oauth-loopback
  timeout: 300000
  secrets: [SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET]
  toolInputs:
    authorize_url: https://accounts.spotify.com/authorize
    token_url: https://accounts.spotify.com/api/token
    client_id_env: SPOTIFY_CLIENT_ID
    client_secret_env: SPOTIFY_CLIENT_SECRET
    scopes: playlist-modify-public playlist-modify-private
    port: 8888
    save_refresh_token_to: SPOTIFY_REFRESH_TOKEN
    extra_authorize_params: { show_dialog: "true" }
```

**Prerequisite:** register the exact `redirect_uri` (e.g. `http://127.0.0.1:8888/callback`)
in the provider's app settings, or the provider rejects the authorize request.

## Security

- The listener binds **`127.0.0.1` only**, on the configured `port`, and is **closed** as
  soon as the code arrives or `timeout` elapses.
- `state` is random per run and **validated** on the redirect (CSRF guard).
- `authorize_url` and `token_url` pass the same [SSRF](../SECURITY.md) check as `http-get`/
  `http-post` (public hosts only). The loopback server is one we bind, not a URL we fetch,
  so it isn't subject to that check.
- **Tokens never enter `runs.db`.** The tool refuses to run without a `save_*_to` target and
  returns only names + non-secret metadata; the token itself goes only to the encrypted
  vault via the executor's secrets store.
- Writing a secret at run time is otherwise unique to this tool — every other built-in only
  *reads* secrets (via `env`). See [ADR-0027](../adr/0027-oauth-loopback-tool.md).

## Notes

- Some providers issue a refresh token only on the **first** consent. If `has_refresh_token`
  is false, force re-consent with `extra_authorize_params` (`show_dialog=true` on Spotify,
  `prompt=consent&access_type=offline` on Google).
- For headless runs, keep `open_browser: true` and click the auto-opened URL, or read the
  URL from the worker log (`[oauth-loopback] Open this URL to authorize: …`) and open it
  manually within the `timeout` window.

## Related

- [Security model](../SECURITY.md) — SSRF, secrets vault
- [ADR-0027](../adr/0027-oauth-loopback-tool.md) — design + trust-surface rationale
- [Tools index](../tools.md)
