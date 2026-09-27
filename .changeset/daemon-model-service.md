---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Run a local model server as a `sua daemon` service.

A new `model` service runs the command in `daemon.model` (`command`, `args`, optional `healthUrl`) as a detached daemon process, so a local provider such as llama-server behind a custom OpenAI-compatible endpoint starts, stops, restarts and logs alongside the scheduler and dashboard. Add `model` to `daemon.services` to start it with `sua daemon start`. `sua daemon status` probes `healthUrl` and reports healthy, loading model (llama-server's 503 while it loads or downloads), or not answering yet. A missing binary or missing config is reported instead of crashing the CLI.

Settings → LLM gets a Local model server card showing whether the server is running and ready, with Start / Stop buttons.
