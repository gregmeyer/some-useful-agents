---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Two key shipped agents rewritten, plus a parser fix that was silently breaking both.

**Parser fix.** `parsedToAgent` and `NODE_KEY_ORDER` in `agent-yaml.ts` had drifted from the v0.16+ schema, silently stripping `tool`, `action`, `toolInputs`, `onlyIf`, `conditionalConfig`, `switchConfig`, `loopConfig`, `agentInvokeConfig`, and `endMessage` from every YAML round-trip. Same shape as the `outputWidget` drift fix in #167. Any agent using MCP-driven tools or control-flow nodes lost those fields on import — so `graphics-creator-mcp` arrived in the DB as a sequence of bare `claude-code` nodes with no prompts, and `agent-analyzer`'s `onlyIf` skip-on-valid optimisation never fired because the field was dropped. Two new round-trip tests lock down every node field the schema accepts so the next addition can't slip through silently.

**graphics-creator-mcp** — single-node rewrite. The previous 6-node theme → save → render → composite pipeline carried multiple latent bugs (missing prompts, broken upstream wiring, theme step that produced nothing reusable). New version is one `claude-code` node that calls the modern-graphics MCP server's `list_themes` + `generate_graphic` tools in one round-trip, returns structured JSON, and ships with an interactive output widget so the tile becomes a self-contained ask → render → preview loop on `/pulse`.

**agent-analyzer** — three improvements to the "Suggest improvements" agent:
- `fix` node now skips entirely when validate's `valid` field is true (saves a Claude round-trip on the happy path; this was already declared but didn't survive parsing — now does).
- `fix` timeout raised from 90s to 240s and `maxTurns` from 2 to 4.
- `fix` prompt rewritten to be tighter: leads with the validation error in an explicit fence, includes common fix recipes (shell-vs-template upstream refs, uppercase input names, missing enum values, control-flow configs), and emphasises "minimal change" so Claude doesn't try to redesign the agent on every fix attempt.

**Dashboard fix-attempt fallback** — the inline auto-fix used by the "Suggest improvements" modal had `timeout: 60s` / `maxWait: 65s` / `maxTurns: 1`, no slack for any non-trivial agent. Bumped to `timeout: 180s` / `maxWait: 200s` / `maxTurns: 3`. When the auto-fix still doesn't return in time, the new error message points users to "Edit manually" with the suggested rewrite as a starting point, rather than implying the dashboard is broken.
