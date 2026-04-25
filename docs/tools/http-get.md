# http-get

HTTP GET with SSRF protection. Resolves the hostname to an IP, rejects private/loopback/link-local/cloud-metadata addresses before sending.

## Inputs

| Name | Type | Required | Description |
|---|---|---|---|
| `url` | string | yes | Full URL (http or https) |
| `headers` | object | no | Key-value map sent as request headers |
| `timeout` | number | no | Request timeout in seconds (default 30) |

## Outputs

| Name | Type | Description |
|---|---|---|
| `status` | number | HTTP status code |
| `headers` | object | Response headers |
| `body` | string | Response body as text |
| `result` | string | Alias for body |

## Example

```yaml
- id: fetch
  tool: http-get
  toolInputs:
    url: "https://icanhazdadjoke.com/"
    headers:
      Accept: "application/json"
    timeout: 10
```

## SSRF guardrails

The IP validator (`assertSafeUrl` in core) rejects:

- `127.0.0.0/8` (loopback)
- `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` (RFC 1918 private)
- `169.254.0.0/16` (link-local, includes AWS `169.254.169.254` metadata)
- `100.64.0.0/10` (CGNAT)
- IPv6 equivalents (`::1`, `fc00::/7`, `fe80::/10`)
- `localhost` by name

Set `SUA_ALLOW_LOCAL_HTTP=1` to bypass (for tests against a local mock server). Not recommended in production.

See [ADR-0017](../adr/0017-agent-analyzer-self-correcting.md) for the SSRF context in v0.17.

## Notes

- **No auth helpers** — put your own `Authorization: Bearer …` header via `toolInputs.headers`, sourced from `{{secrets.NAME}}`.
- **Redirects** followed automatically (browser-standard rules). Final URL is re-validated against the SSRF guardrails.
- **Binary responses** — the body is returned as a UTF-8 string. Use `file-write` for binary output.
