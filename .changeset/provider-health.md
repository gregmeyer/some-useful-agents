---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

See how each model provider did over the last week: in Settings → LLM, in `sua doctor`, and when the dashboard starts.

When a provider fails, its nodes go to the next one in the list, so one that never works stays hidden: a local model that was never started failed 707 times in two weeks without anyone seeing it. Settings → LLM now shows, under each provider, how many nodes it answered and failed over the last 7 days and the main reason it failed. It also says how many nodes went to a later provider and what they cost. `sua doctor` gets a matching check that fails for a provider that has never answered, and the dashboard logs a warning at start for a provider that never answers or mostly fails.
