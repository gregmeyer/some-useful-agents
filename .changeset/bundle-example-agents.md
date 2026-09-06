---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Ship the example agents in the published package.

`agents/examples/` lives at the repo root and was never part of any npm tarball, but six features read it off the process cwd to auto-import the agent they need. On an npm install every one of those reads failed: Build from goal returned "Goal surveyor agent not found" for every goal, the Pulse and dashboard layout planners silently declined to run, inbox triage fell back to an empty prompt, and all three built-in packs failed to register because their agent refs pointed out of the package. `sua examples install` offered six hand-maintained fallback agents rather than the 40+ the docs promise, and none of the missing ones were among them.

The examples are now copied into the core package at build time and resolved through a shared loader that prefers the repo copy and falls back to the bundled one, so a repo checkout behaves exactly as before. A fresh npm install now installs 43 example agents instead of 6, registers all three built-in packs, and can build an agent from a goal.
