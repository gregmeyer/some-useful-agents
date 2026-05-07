---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

ARG_MAX defense-in-depth — three follow-ups to the claude-stdin fix (#220).

1. **Fat upstream tempfile fallback** for shell nodes. When an `UPSTREAM_<ID>_RESULT` env value exceeds 32KB, it gets truncated inline (with a `...(truncated; full value at $UPSTREAM_<ID>_RESULT_FILE)` marker) and the full payload is written to `$STATE_DIR/_upstream/<runId>/<nodeId>.txt`. A new `UPSTREAM_<ID>_RESULT_FILE` env var holds the path. Shell agents that need the full payload do `cat $UPSTREAM_<ID>_RESULT_FILE`. Small upstreams behave exactly as today.

2. **Argv+env soft-cap guardrail** at `spawnProcess`. Refuses spawn with a structured `setup`-category error when the rendered argv+env exceeds 200KB (well below kernel ARG_MAX ~256KB so we leave headroom for under-sandbox stricter limits). Error message names the heaviest env var and suggests `$<NAME>_FILE` as a fix. Catches any future regression that re-introduces fat-arg/env paths instead of surfacing as raw `spawn E2BIG`.

3. **Codex spawner now pipes prompt via stdin** (mirrors #220's claude fix). The `codex exec` invocation reads its prompt from stdin natively. Was untouched in #220 because the CLI's stdin behaviour wasn't verified; codex-using agents now share the same E2BIG immunity as claude-code.

Verified live on `ashby-search-discovered`: fat upstream payloads (1.6MB JSON, 180KB HTML) are now correctly written to `_upstream/<runId>/<nodeId>.txt` instead of being stuffed into env vars.
