---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Three improvements to the Improve-layout drafting flow:

- **YAML-parse retry**: the orchestrator's drafting phase now retries on a YAML parse failure (e.g. inline `python3 -c "…"` shell command without a `command: |` block scalar) the same way it retries on critic failures. The parse error is appended to FOCUS as critic-style feedback. Up to 3 attempts per drafter. Same retry path also covers the id-mismatch case (drafter drifts off SUGGESTED_NAME).
- **Wider wizard modal**: the Improve-layout modal grows from 640px to ~960px (capped at 95vw). The Cancel / Apply layout / Draft+apply action row had buttons too close together in the narrow modal; the wider modal makes mis-clicks between "Update plan" (refine block) and "Apply layout" (action row) far less likely.
- **Auto-run on landing**: `/agents/build/commit` now fires a single fire-and-forget run for each newly created agent immediately after `createAgent` succeeds. The user's first view of the dashboard shows real output instead of empty placeholders. Failed auto-runs surface as a normal failed-run row that the user can re-trigger with inputs.
