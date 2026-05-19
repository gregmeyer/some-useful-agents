---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Move the `chmod +x packages/cli/dist/index.js` from the cli package's build script into the root `npm run build` script.

PR #299 added the chmod to `packages/cli/package.json`'s `build` script, intending to restore the execute bit on every CLI rebuild. But the root `npm run build` uses `tsc --build` (the TypeScript composite-project orchestrator), which compiles every workspace package but doesn't execute per-package npm scripts. So the chmod was bypassed on every full root rebuild — which is the workflow contributors actually use after a clean (per `CLAUDE.md` / `feedback_clean_build_before_push.md`).

Symptom: `sua --version` started printing `permission denied: sua` again after any `rm -rf packages/*/dist && npm run build` cycle. Now the chmod is in the root build script so it's guaranteed to run after every full build, regardless of which entry point was used.
