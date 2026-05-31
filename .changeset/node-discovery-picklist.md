---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

feat(dashboard): node-discovery picklist on the add-node form

Closes the "node discovery for flow building" item from
`memory/project_next_features.md`: previously the add-node form
showed 5 hardcoded quick-start patterns and a flat dropdown of
every built-in tool, user tool, and invocable agent mixed together.
Operators had to know what each entry did before they could pick.

A new "Discover nodes…" button next to the Quick start patterns
opens a search-driven picklist modal grouped by source:

- **Quick patterns** — the existing `NODE_PATTERNS` set with
  pre-filled defaults
- **Built-in tools** — `shell-exec`, `http-get`, `http-post`,
  `file-read`, `file-write`, `json-parse`, `json-path`,
  `template`, `csv-to-chart-json`, `llm-prompt`
- **User tools** — agent-defined tools from the `toolStore`
- **Invocable agents** — other installed agents (current agent
  excluded; active only)

Each card shows name + description + the source-group chip + the
toolId in mono. Search filters by name / description / id; group
headers hide when all their cards are filtered out. Click a card →
sets the existing `#node-tool-select` dropdown, dispatches change
so the dynamic toolInput section re-renders, and pre-fills any
declared defaults (for pattern cards). Click outside / press Esc /
hit the × closes.

Wiring:
- New `views/node-discovery-modal.ts` builds the entries +
  renders the modal scaffold + cards.
- New `views/node-discovery.js.ts` carries the open/filter/select
  client JS, added to the layout's bundled-scripts string.
- `views/agent-add-node.ts` mounts the button next to the existing
  pattern strip and the modal at the end of the page body.
- New CSS for the modal in `components.css` keyed off
  `.node-discovery__*`.
