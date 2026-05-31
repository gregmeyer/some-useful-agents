---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

fix(core): apple-foundation-models spawner uses ESM import, not CJS require

`appleFoundationModelsSpawner.resolveBinary` called `require()` to
lazily load the runner module. The core package is ESM — `require`
isn't defined at runtime — so every invocation of the Apple FM
provider threw `ReferenceError: require is not defined` before
reaching the runner. Replaced with a static top-of-file
`import { ensureAppleRunner } from './apple-foundationmodels-runner.js'`.

The "lazy load to keep the cold-path light on non-macOS hosts"
justification didn't hold up — the runner module imports only
Node built-ins (child_process, crypto, fs, os, path) that core
already loads transitively. Eager-loading costs nothing.
