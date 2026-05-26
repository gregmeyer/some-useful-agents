# json-parse

Parse a JSON string into a structured value downstream nodes can reference.

## Inputs

| Name | Type | Required | Description |
|---|---|---|---|
| `text` | string | yes | JSON text to parse |

## Outputs

| Name | Type | Description |
|---|---|---|
| `value` | json | Parsed value (object, array, or scalar) |
| `result` | string | Re-serialized JSON (for debugging or text-only consumers) |

To pull a specific field out of `value`, chain into [`json-path`](json-path.md).

## Example

```yaml
- id: parse
  tool: json-parse
  dependsOn: [fetch]
  toolInputs:
    text: "{{upstream.fetch.result}}"

- id: status
  tool: json-path
  dependsOn: [parse]
  toolInputs:
    data: "{{upstream.parse.value}}"
    path: "status"
```

## Notes

- **Malformed JSON** fails the node with a parse error.
- `value` carries the parsed structure (any JSON type); `result` is its string form.
- Most agents can skip this tool entirely — [`http-get`](http-get.md) and [`http-post`](http-post.md) auto-parse JSON response bodies into `body`, so chain straight into `json-path` against `{{upstream.fetch.body}}`.
