# json-parse

Parse a JSON string into structured fields downstream nodes can reference.

## Inputs

| Name | Type | Required | Description |
|---|---|---|---|
| `input` | string | yes | JSON text to parse |

## Outputs

Every top-level key in the parsed JSON is exposed as an output field. Additionally:

| Name | Type | Description |
|---|---|---|
| `result` | string | Pretty-printed re-serialization (for debugging) |

## Example

```yaml
- id: parse
  tool: json-parse
  dependsOn: [fetch]
  toolInputs:
    input: "{{upstream.fetch.result}}"

- id: use
  type: shell
  dependsOn: [parse]
  command: echo "Status $UPSTREAM_PARSE_STATUS — $UPSTREAM_PARSE_COUNT items"
```

If `fetch` emitted `{"status": "ok", "count": 42}`, the shell node sees `UPSTREAM_PARSE_STATUS=ok` and `UPSTREAM_PARSE_COUNT=42`.

## Notes

- **Non-object roots** — if the JSON parses to an array or scalar, the whole value is exposed as `result` only (no per-key extraction).
- **Malformed JSON** fails the node with a parse error.
- For deep extraction, chain into [`json-path`](json-path.md).
