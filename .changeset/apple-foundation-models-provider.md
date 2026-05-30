---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

feat(core): apple-foundation-models LLM provider (on-device, system option)

Adds `apple-foundation-models` as a third LLM provider alongside
`claude` and `codex`. Runs entirely on-device via Apple's
`SystemLanguageModel` / `FoundationModels` framework — no API key, no
network. macOS 26+ with Xcode CLT (`xcrun`) required.

**How it works:** A tiny Swift runner ships embedded in
`packages/core/src/apple-foundationmodels-runner.ts`. On first use
(`ensureAppleRunner`) we write the source to `~/.sua/runners/`,
compile with `xcrun swiftc -parse-as-library`, and cache the binary +
a source-hash sidecar. Subsequent invocations hit the cache. On non-
macOS hosts or hosts without `xcrun`, the bootstrap returns
`unsupported` without raising and the LLM waterfall falls through to
the next provider.

**Spawner shape:** The runner reads `PROMPT` + `SYSTEM_PROMPT` from
its environment (not stdin or argv) and prints a single JSON line
`{ status, response_text, model_name, error_message }`. The new
`LlmSpawner` fields `resolveBinary`, `buildEnv`, `promptEnvVar`,
`classifyResult`, and `simulateStream` are all opt-in extensions that
keep the claude / codex spawners unchanged. `status: "unavailable" |
"unsupported"` map to `binary_missing` so the waterfall falls through
to the next provider when the host can't actually run the model.

**Simulated streaming.** Apple FM has no native token-delta stream,
but the dashboard's typewriter UX expects `output_chunk` events.
After a successful run the spawner chunks the response text into
~30-char pieces and emits synthetic `output_chunk` events at ~8 ms
intervals (capped at ~1.5 s total). Same code path as real streaming
on the client.

**System agent.** The existing `apple-foundationmodels-prompt` user
agent (which compiles Swift + runs the binary directly via shell
nodes) is now bundled in `agents/examples/` as a system agent so it
ships with sua. It demos the underlying mechanics; new agents can
just set `provider: apple-foundation-models` on any `llm-prompt`
node and skip the boilerplate.

**Dashboard:** Per-node provider select (`llm-options.ts`) and the
`/settings/llm` chain editor (`settings-llm.ts`) now list the new
provider. Probe results show "reachable" on macOS hosts that compile
the runner, "unavailable" elsewhere.
