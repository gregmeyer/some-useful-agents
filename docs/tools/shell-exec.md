# shell-exec

Run an arbitrary shell command. Backcompat tool for v0.15 `type: shell` nodes with inline `command:`.

## Inputs

| Name | Type | Required | Description |
|---|---|---|---|
| `command` | string | yes | Shell command to execute |

## Outputs

| Name | Type | Description |
|---|---|---|
| `stdout` | string | Full stdout |
| `stderr` | string | Full stderr |
| `exit_code` | number | Process exit code (0 = success) |
| `result` | string | Alias for stdout (v0.15 compat) |

## Example

```yaml
- id: report
  tool: shell-exec
  toolInputs:
    command: |
      echo "Runs today: $(sqlite3 data/runs.db 'SELECT COUNT(*) FROM runs')"
```

The more common pattern is to put the command directly on the node:

```yaml
- id: report
  type: shell
  command: echo "hi"
```

`shell-exec` is mostly useful when you want a **tool reference** (e.g. to share `config:` defaults) or when a user tool wraps shell.

## Notes

- **Community-shell gate** applies when the agent's source is `community` — the run refuses unless the agent id is on `--allow-untrusted-shell`.
- **Env allowlist** filters what the subprocess sees — the agent's `envAllowlist`, plus declared `secrets` and `inputs`, plus whatever global variables match.
- **Timeout** defaults to 300s. Override on the node (`timeout: 60`).
- **Max buffer** 10 MB per stream. Larger output truncates.
