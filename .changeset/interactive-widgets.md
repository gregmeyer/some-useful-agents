---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Interactive widgets — turn pulse tiles into mini-apps.

Output widgets gain an opt-in `interactive: true` flag. When set, the pulse tile renders with an inline inputs form + Run button + state machine that polls `/runs/:id/widget-status` until the run completes — no navigating away. Each tile becomes a self-contained ask → think → answer → ask again loop with smooth CSS transitions between states.

Five visible states (`idle | asking | running | success | error`) cross-fade at ~220 ms with a `transform: translateY` so content doesn't pop. The tile gets a subtle pulsing border while running so it reads as "active" at a glance from the pulse page. `prefers-reduced-motion` disables the animations.

Schema additions on `outputWidget` (all optional):
- `interactive: boolean` — opts the tile into the new mode
- `runInputs: string[]` — subset of `agent.inputs` to expose in the form (defaults to all)
- `askLabel: string` — overrides the initial Run button text (default "Run")
- `replayLabel: string` — overrides the post-result button text (default "Run again")

Two new dashboard routes:
- `POST /agents/:name/widget-run` — accepts `input_*` form fields and returns `{ runId }` JSON. Reuses the existing DAG executor and auth.
- `GET /runs/:id/widget-status` — lightweight `{ status, result, error }` JSON polled every 500 ms.

Polling caps at 60 s (120 ticks) → tile transitions to a "still running, view details" state with a link to `/runs/:id`. Cancel button hooks the existing `/runs/:id/cancel` route.

The output widget editor on agent config gains an "Interactive mode" disclosure: a checkbox to enable, checkboxes per declared input to filter what the tile shows, and label overrides for both buttons.

Non-interactive widgets are completely unchanged. Existing widgets without the flag render in the same static mode they always have.

Plan: `~/.claude/plans/interactive-widgets.md`.

Out of scope (deferred):
- Widget cross-fade replaces the result with the raw text in a `<pre>` for now; live re-render of the actual widget HTML on completion is a follow-up (the next pulse refresh swaps in the proper widget).
- Streaming intermediate node outputs into the tile.
- Channel/file/secret pickers tied to specific input types beyond text/number/enum/boolean.
