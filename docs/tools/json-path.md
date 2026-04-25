# json-path

Extract a value from a JSON string via a dot-path expression.

## Inputs

| Name | Type | Required | Description |
|---|---|---|---|
| `input` | string | yes | JSON text |
| `path` | string | yes | Dot-path with optional `[N]` indexes — e.g. `items[0].title` |

## Outputs

| Name | Type | Description |
|---|---|---|
| `value` | string | The extracted value (JSON-stringified if not a primitive) |
| `result` | string | Alias for value |
| `found` | boolean | `true` if the path resolved, `false` if any step was undefined |

## Example

```yaml
- id: fetch
  tool: http-get
  toolInputs: { url: "https://api.example.com/posts/1" }

- id: title
  tool: json-path
  dependsOn: [fetch]
  toolInputs:
    input: "{{upstream.fetch.body}}"
    path: "title"

- id: announce
  type: shell
  dependsOn: [title]
  command: echo "Got: $UPSTREAM_TITLE_VALUE"
```

## Notes

- Path syntax: `a.b[0].c` (dots + array indexes, no wildcards).
- Missing paths return `found: false` and empty `value`, rather than failing.
- For richer queries, shell out to `jq` in a shell node.
