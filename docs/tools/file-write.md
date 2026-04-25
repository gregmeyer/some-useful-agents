# file-write

Write content to a file. Path is resolved relative to the project root; directories are created as needed within it.

## Inputs

| Name | Type | Required | Description |
|---|---|---|---|
| `path` | string | yes | Relative path to write to |
| `content` | string | yes | Content to write (UTF-8) |
| `append` | boolean | no | Append instead of overwrite (default false) |

## Outputs

| Name | Type | Description |
|---|---|---|
| `bytes` | number | Bytes written |
| `path` | string | Absolute path of the written file |
| `result` | string | Human-readable summary |

## Example

```yaml
- id: save
  tool: file-write
  dependsOn: [generate]
  toolInputs:
    path: "out/report-{{inputs.DATE}}.md"
    content: "{{upstream.generate.result}}"
```

## Notes

- **Path traversal protection** identical to [`file-read`](file-read.md).
- **Parent directories** are created with `mkdir -p` semantics.
- **Overwrite by default** — pass `append: true` to tail onto an existing file.
- Files written here are served by the `/output-file` dashboard route so `preview` output widgets can render them inline. See [Output widgets](../output-widgets.md).
