# Changelog

## 2026-04-17

### Variables scoping (PRs #87-#92)
- Global variables store (`.sua/variables.json`) with `sua vars` CLI
- Executor wiring: `$NAME` in shell, `{{vars.NAME}}` in prompts
- Template palette autocomplete includes global variables with group separators
- `/settings/variables` dashboard tab with full CRUD
- Agent-detail Variables section: inline type editing, defaults, add-new-row
- Type/value validation on save (number/boolean defaults checked)
- YAML editor: GET/POST `/agents/:name/yaml` with Zod validation
- Secrets save modal: copy-before-save warning, value never shown again
- 3-layer secret redaction in run logs: declared secrets, sensitive name patterns, credential value patterns
- Edit links on variables in node edit form (agent inputs, global vars, secrets)

### Suggest improvements (PRs #93-#94, #101)
- "Suggest improvements" button on agent detail opens inline modal
- Agent-analyzer example: self-correcting 3-node pipeline (analyze, validate, fix)
- Modal shows real progress from `progressJson` while analyzing
- Side-by-side colored diff (red for removed, green for added)
- "Review + apply" opens YAML editor pre-filled with suggestions
- YAML validation with error display before apply

### DAG executor refactor (PRs #95-#99)
- Split 1482-line `dag-executor.ts` into 6 focused modules
- `LlmSpawner` interface with claude (stream-json) and codex implementations
- `progressJson` column on `node_executions` for real-time turn tracking
- Dashboard shows turn indicators on running nodes
- `provider` field on claude-code nodes: select claude or codex per node

### Dashboard UX (PRs #92, #93, #98)
- Run-now modal with input fields for agents that declare inputs
- Non-blocking run execution: immediate redirect to polling page
- Replay modal with pre-flight validation (upstream outputs + node config)
- Resolved variables panel on run detail with live filter
- Markdown rendering in analysis output
- CSS overflow fix for long variable values
- Spinner CSS component

### Example agents (PR #100)
- `llm-tells-a-joke`: configurable topic input, clean prompt rules

### Bug fixes
- Fixed `{{inputs.X}}` template resolution for claude-code node prompts
- Fixed inline onclick handlers breaking JS template literal parsing
- Fixed form disconnection on run-now submit (setTimeout defer)
- Fixed prefillYaml handler for Review + apply flow
