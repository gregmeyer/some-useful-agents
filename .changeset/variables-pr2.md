---
"@some-useful-agents/core": minor
---

**feat: executor variables wiring + {{vars.NAME}} template resolver (Variables PR 2 of 6).**

Global variables from `.sua/variables.json` are now injected into every node at run time.

- **Shell nodes**: `$NAME` env var, injected after secrets but before inputs (inputs win on collision).
- **Claude-code prompts**: `{{vars.NAME}}` template substitution via `resolveVarsTemplate()`.
- **Precedence**: `--input` override > agent input default > global variable > secret.
- **`VariablesStore` on `DagExecutorDeps`**: optional; when absent, no variables injected.
