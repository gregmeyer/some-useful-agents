---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Add a build stamp so you can tell which code a running daemon is serving. `npm run build` now writes `dist/build-info.json` with the git short SHA (suffixed `-dirty` for an unclean tree) and an ISO build timestamp. The dashboard footer shows the commit next to the version (`sua v0.x · 260589e`, build time on hover), and `/health` returns `commit` + `builtAt`. Verify with `curl -s localhost:3000/health | jq '{commit, builtAt}'` against `git rev-parse --short HEAD`. Falls back to `dev` when the stamp is absent (running straight from tsc without the post-build step, or in tests).
