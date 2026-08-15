---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Add a first-run "Connect a model" screen.

A fresh install had no in-product way to connect an LLM. Worse, it looked
configured when it wasn't: the settings store reports `providers: ['claude']`
even with no settings file, and the runtime falls back to the literal `claude`
when the chain is empty, so a machine without the CLI failed only at spawn time
with `binary_missing`.

The dashboard now probes real provider readiness (`detectLlms()` plus any
configured custom endpoints, cached off the request path). When nothing
resolves, `GET /` redirects to `/connect-model`, which offers a hosted API key
and a local endpoint side by side, probes the endpoint before saving, and
promotes the result to the front of the waterfall so the next run actually uses
it. "Skip for now" dismisses the gate.

Also fixes a provider-probe bug: `apple-foundation-models` was probed by
spawning `claude`, so an Apple-FM-only host got the wrong answer. Probes now use
each provider's own binary and version argv.
