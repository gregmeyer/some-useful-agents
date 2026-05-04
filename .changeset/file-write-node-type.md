---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

`file-write` first-class node type.

A real schema gap surfaced by the dogfood: agent-builder kept reaching for `type: file-write` (a node type that didn't exist) instead of the longer `type: shell` + `tool: file-write` + `toolInputs: { path, content }` form. Promoting it to a first-class node type makes the LLM's intuition correct and keeps YAML readable.

```yaml
- id: save
  type: file-write
  dependsOn: [build-summary]
  path: "output/digest-{{inputs.DATE}}.md"
  content: "{{upstream.build-summary.result}}"
  append: false  # optional; default false
```

Top-level `path:` and `content:` desugar to `tool: 'file-write'` + `toolInputs: { path, content, append }` at dispatch time — no executor branch added, just a small `resolveToolId`/`resolveToolInputs` extension. The existing `file-write` tool gained an `append:` mode (writes with `flag: 'a'`).

Templating: built-in tool dispatch now resolves `{{upstream.X.field}}`, `{{vars.X}}`, and `{{inputs.X}}` in string-typed tool inputs, so `path:` and `content:` (and any other built-in tool's string fields) can reference upstream outputs and inputs. Previously only MCP tools had this.

Schema enforces `path` + `content` are required when `type: file-write`, and validates that any `{{upstream.X.result}}` reference in `path` or `content` declares `X` in `dependsOn` (same rule as for shell/claude-code).

Capabilities derivation (PR A.6) updated to recognize `type: file-write` as the `file-write` tool, so `tools_used` and `side_effects: ['writes_files']` populate correctly.

Node catalog (PR A.7) gets a new entry with description, inputs, outputs, use-when guidance, and example. The forcing-function test ensures the new `NodeType` enum value has a catalog entry.
