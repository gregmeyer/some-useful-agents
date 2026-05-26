# http-post

HTTP POST with SSRF protection. Same safety guarantees as `http-get`.

## Inputs

| Name | Type | Required | Description |
|---|---|---|---|
| `url` | string | yes | Full URL (http or https) |
| `body` | json | no | Request body. JSON-encoded automatically — pass a structured value, not a pre-stringified string |
| `headers` | object | no | Request headers. Merged on top of `Content-Type: application/json` (caller can override) |
| `timeout` | number | no | Request timeout in seconds (default 30) |

## Outputs

| Name | Type | Description |
|---|---|---|
| `status` | number | HTTP status code |
| `body` | json | Response body — auto-parsed to JSON when the response is valid JSON, otherwise the raw string |
| `headers` | object | Response headers |
| `duration_ms` | number | Request duration in milliseconds |

A `result` string alias is also emitted (the body stringified) for templates that expect text.

## Example

```yaml
- id: post
  tool: http-post
  toolInputs:
    url: "{{vars.SLACK_WEBHOOK}}"
    body:
      text: "Agent finished: {{upstream.analyze.result}}"
```

## Notes

- SSRF guardrails identical to [`http-get`](http-get.md).
- `body` is JSON-encoded by the tool. Pass an object/array/scalar directly — do not stringify upstream.
- When `body` is provided, `Content-Type: application/json` is set by default. Pass a different `Content-Type` in `headers` to override.
- For webhook signing, compute the signature in a preceding shell node and pass it via `headers.X-Signature`.
