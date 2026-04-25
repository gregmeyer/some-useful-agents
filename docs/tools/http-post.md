# http-post

HTTP POST with SSRF protection. Same safety guarantees as `http-get`.

## Inputs

| Name | Type | Required | Description |
|---|---|---|---|
| `url` | string | yes | Full URL (http or https) |
| `body` | string | no | Request body as text |
| `headers` | object | no | Headers (default: `Content-Type: application/json` when body looks like JSON) |
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
- id: post
  tool: http-post
  toolInputs:
    url: "{{vars.SLACK_WEBHOOK}}"
    headers:
      Content-Type: "application/json"
    body: |
      {"text": "Agent finished: {{upstream.analyze.result}}"}
```

## Notes

- SSRF guardrails identical to [`http-get`](http-get.md).
- `body` is sent as-is — no JSON auto-encoding. Stringify upstream.
- For webhook signing, compute the signature in a preceding shell node and pass it via `headers.X-Signature`.
