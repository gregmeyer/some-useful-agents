---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

`sua agent audit` now falls back to the project DB when no on-disk YAML matches.

Agents created via the dashboard's Build-from-Goal flow live in the project SQLite store, not in `agents/local/*.yaml`. Previously running `sua agent audit <id>` against them printed "not found". This release adds a DB lookup as the second-pass resolver: if `loadAgents()` doesn't find the id on disk, the CLI opens the project DB read-only, fetches the agent, and prints its canonical YAML via `exportAgent()` with a banner noting the storage location.

Side effect: v2-only on-disk YAMLs (which `loadAgents` didn't surface because that loader is v1-shaped) now audit successfully too via the same path. The on-disk v1 audit path is unchanged for v1 agents.
