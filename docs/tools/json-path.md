# json-path

Extract a value from a JSON value via a dot-path expression.

## Inputs

| Name | Type | Required | Description |
|---|---|---|---|
| `data` | json | yes | Object, array, or scalar to walk |
| `path` | string | yes | Dot-separated path — e.g. `items.0.title` (array indexes are bare numeric segments, no brackets) |

## Outputs

| Name | Type | Description |
|---|---|---|
| `value` | json | The extracted value, with its original type preserved |
| `result` | string | The extracted value as a string (JSON-stringified if not already a string; empty string if the path didn't resolve) |

## Example

```yaml
- id: fetch
  tool: http-get
  toolInputs: { url: "https://api.example.com/posts/1" }

- id: title
  tool: json-path
  dependsOn: [fetch]
  toolInputs:
    data: "{{upstream.fetch.body}}"
    path: "title"

- id: announce
  type: shell
  dependsOn: [title]
  command: echo "Got: {{upstream.title.result}}"
```

## Notes

- **Path syntax** is dots only. Use `items.0.title`, not `items[0].title`. No wildcards or filters.
- **Missing paths** resolve `value` to `undefined` and `result` to an empty string. The node still succeeds.
- `data` accepts a JSON value directly — pass `{{upstream.fetch.body}}` from `http-get`/`http-post`, or `{{upstream.parse.value}}` from [`json-parse`](json-parse.md). No need to re-stringify.
- For richer queries (filters, wildcards), shell out to `jq` in a shell node.
