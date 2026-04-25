# claude-code

Run a Claude or Codex prompt. Backcompat tool for v0.15 `type: claude-code` nodes with inline `prompt:`.

## Inputs

| Name | Type | Required | Description |
|---|---|---|---|
| `prompt` | string | yes | The prompt text |
| `model` | string | no | Override the agent-level model default |
| `maxTurns` | number | no | Max conversation turns (default 10) |
| `allowedTools` | array\<string\> | no | Whitelist of tool names Claude may invoke |

## Outputs

| Name | Type | Description |
|---|---|---|
| `result` | string | Final assistant text |
| `turns` | number | Number of completed turns |
| `exit_code` | number | 0 on success |

## Example

```yaml
- id: summarize
  tool: claude-code
  dependsOn: [fetch]
  toolInputs:
    prompt: |
      Summarise the following headlines into 3 bullet points:
      {{upstream.fetch.result}}
    maxTurns: 3
    allowedTools: []         # no tool use — pure text generation
```

Inline form on a node:

```yaml
- id: summarize
  type: claude-code
  prompt: "Summarise: {{upstream.fetch.result}}"
  maxTurns: 3
```

## Provider selection

The agent-level or node-level `provider:` field picks between Claude and Codex. Claude uses `--output-format stream-json` for turn tracking; Codex uses `codex exec -s read-only` (no structured progress).

```yaml
provider: codex              # agent-level

nodes:
  - id: refactor
    type: claude-code
    provider: claude         # override per-node
    prompt: ...
```

See [ADR-0016](../adr/0016-llm-spawner-abstraction.md) for the abstraction details.

## Notes

- **Stream-json progress** for Claude — turn starts, tool use, completion events all render in real time on `/runs/:id`.
- **Secrets** — listed via the agent's `secrets:` field; Claude sees them as env vars in the tool's shell environment.
- **Cost** — LLM calls cost tokens. The run detail page shows token counts when the provider reports them.
