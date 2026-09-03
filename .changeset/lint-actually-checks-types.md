---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

`npm run lint` now actually type-checks.

It was `tsc --noEmit`, which checked **nothing**. This is an npm-workspaces monorepo wired with
TypeScript project references, so the root `tsconfig.json` is `{ "files": [], "references": [...] }`
— and a non-build `tsc` run against that visits zero files. It exited 0 on a file containing both a
type error and an undefined identifier, in CI as well as locally, and had been doing so for as long
as the script existed.

Nothing actually slipped through, because CI runs `npm run build` first and `tsc --build` is a real
type-check. But `lint` was a green check that meant nothing, which is worse than not having one.

The fix is `tsc --build`. Checking without emitting is not available here: `tsc --build --noEmit` is
refused outright (`TS6310: Referenced project may not disable emit`), because composite references
have to emit declarations for downstream projects to check against. Per-package `--noEmit` runs
produce hundreds of phantom "cannot find module" errors on a tree that has not been built.

Since `lint` and `build` are now the same command, CI no longer runs both — a second invocation
could never fail on its own, which is the same "looks like a gate, isn't one" shape being removed.
CONTRIBUTING.md now states that `npm run build` is the type-check, and a test guards the reasoning
so the `--noEmit` form cannot quietly come back.
