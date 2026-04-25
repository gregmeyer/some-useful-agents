# file-read

Read a file from disk. Path is resolved relative to the project root and must stay within it.

## Inputs

| Name | Type | Required | Description |
|---|---|---|---|
| `path` | string | yes | Relative path, e.g. `agents/examples/data/sample.json` |

## Outputs

| Name | Type | Description |
|---|---|---|
| `content` | string | File contents as UTF-8 |
| `size` | number | File size in bytes |
| `result` | string | Alias for content |

## Example

```yaml
- id: source
  tool: file-read
  toolInputs:
    path: "agents/examples/data/research-topics.json"
```

## Notes

- **Path traversal protection** — `..`-escapes out of the project root are rejected at validation time.
- **Binary files** decode as UTF-8; use a shell node + `base64` for raw bytes.
- **Max size** 10 MB. Larger files fail the call.
