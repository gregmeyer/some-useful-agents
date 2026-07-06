---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Disabling a provider in Settings → LLM now also overrides node `provider:` pins.

Previously the per-provider off switch only removed a provider from the default
waterfall — an agent/node that explicitly pinned that provider (e.g.
`provider: claude`) still ran it. Now a globally-disabled provider is off
everywhere: `buildProviderChain` neutralizes a pin that names a disabled
provider, so the node falls through to the first enabled provider instead. This
makes "turn Claude and Codex off and run local-only" actually apply to every
agent, including pinned ones. A pin to a provider that's simply not in the
waterfall (but not disabled) still seeds the chain as before.
