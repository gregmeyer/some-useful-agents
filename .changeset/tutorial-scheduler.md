---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Onboarding walkthrough and local cron scheduler.

- `sua tutorial`: 5-stage interactive walkthrough that ends with a real scheduled dad-joke agent. Type `explain` at any stage for a Claude or Codex deep-dive.
- `sua init`: now scaffolds `agents/local/hello.yaml` so `sua agent list` is never empty on first run.
- `sua schedule start|list|validate`: cron-based scheduler via `node-cron`. Agents with a `schedule` field now actually fire.
- `sua doctor`: new checks for scheduler readiness, installed LLM CLIs, and scheduled agent validity.
- New core modules: `LocalScheduler` and `invokeLlm` / `detectLlms` utilities.
- `dad-joke` example agent in `agents/examples/`.
- Public `ROADMAP.md` at the repo root.
