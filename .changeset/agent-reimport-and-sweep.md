---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

New `sua agent reimport <path>` verb + sweep of example agents to enable pulse-tile interactivity.

Editing `agents/examples/*.yaml` previously required a one-off node script to land — once an agent is in the run DB, the on-disk YAML is no longer authoritative. The new verb takes a YAML file or a directory, calls `agentStore.upsertAgent` for each, and prints a per-file `created` / `updated` (with version bump) / `unchanged` (DAG identical, metadata refreshed) / `failed` summary. Idempotent.

Sweeps eight example agents that declare runtime `inputs:` (api-monitor, ashby-discover, ashby-jobs-multi, ashby-search-discovered, cat-video-finder, vimeo-staff-picks, weather-dashboard, weather-forecast) and adds `outputWidget.interactive: true` so their pulse tiles render with the inline inputs form + run button. Run `sua agent reimport agents/examples` after pulling to land them in your local DB.
