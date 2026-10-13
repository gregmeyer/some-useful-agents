---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Engine and builder fixes.

- One site failing no longer sinks a whole multi-site search, and sua builds multi-source agents as one step per source, plus a merge.
- `web-search` in a node's tools turns on the provider's own live search.
- An llm step gets the whole of a big upstream result. A claude step that runs out of turns is no longer reported as rate limited. A codex step that finished its answer isn't failed by a late exit code.
- Replay from a node reuses the original run's inputs.
- Agents can't be saved with a node reference the executor won't fill in. An agent rolled back to an older version can be changed again.
- The research starter still writes a brief when one research angle fails.
- Pictures are scaled to fit their frames instead of being cropped. Test data no longer uses real names, places or listings.
