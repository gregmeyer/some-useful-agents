---
"@some-useful-agents/cli": minor
"@some-useful-agents/dashboard": minor
---

**feat: tool CLI + /tools dashboard + tool visibility on agent detail (PR 3 of 6 for v0.16).**

Surfaces the tool abstraction from PRs 1–2 so users can browse, inspect, and validate tools from both the CLI and the dashboard.

### What ships

- **`sua tool list`** — tabular listing of all built-in + user-defined tools with id, source, implementation type, description.
- **`sua tool show <id>`** — detailed view of a tool's inputs (name, type, required, default, description) + outputs + implementation.
- **`sua tool validate <file>`** — schema-check a tool YAML without storing it. Reports each Zod issue with path + message.
- **`/tools`** dashboard page — card grid of all tools, split into "Built-in tools" and "User tools" sections. Reuses the agent-card component.
- **`/tools/:id`** detail page — inputs table, outputs table, implementation card, back-link to /tools.
- **Tool visibility on agent detail sidebar** — new "Tools" section between Secrets and action buttons. Lists the unique tool ids this agent's nodes reference, each as a clickable badge linking to `/tools/:id`. v0.15 nodes show their implicit tool (`shell-exec` / `claude-code`).
- **"Tools" nav link** in the topbar — sits between Agents and Runs.

### Tests

521 total (517 → 521; +4 new):
- `/tools` lists built-in tools
- `/tools/http-get` renders detail with inputs/outputs
- `/tools/nonexistent` redirects to /tools
- Agent detail sidebar shows tool badge for implicit shell-exec
