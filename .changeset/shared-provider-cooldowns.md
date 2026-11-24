---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A provider that's out of quota or unreachable is skipped by every sua process, and Settings → LLM shows it with a Try it now button.

Cooldowns were kept per process, so the dashboard, the Temporal worker and the scheduler each had to fail on a provider before skipping it, and a restart forgot them all. They're now shared through `data/provider-cooldowns.json`: each process re-reads the file when it changes, a success anywhere clears it, and it survives a restart. Settings → LLM shows each provider being skipped, why and until when, with **Try it now** to clear it.
