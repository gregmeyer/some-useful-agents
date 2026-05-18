---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Migrate example agents, docs, and the `/agents/new` form to the canonical `type: llm-prompt` spelling.

All eleven `agents/examples/*.yaml` (and `agents/local/claude-hello.yaml`) now use `type: llm-prompt` instead of the legacy `type: claude-code`. The dashboard "New Agent" form, its POST handler, and the related copy emit `llm-prompt` for newly-created agents. `build-planner.yaml`'s prompt template and `agent-builder.yaml` / `agent-analyzer.yaml`'s in-prompt guidance text were updated so generated/reviewed agents also use the new spelling.

Existing agents on disk that say `type: claude-code` continue to load byte-identically (alias preserved from PR 2). ADR-0023 records the decision and consequences. `docs/agents.md` carries the one-paragraph alias note.

No runtime behavior changes.
