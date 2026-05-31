---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

feat(dashboard): "Build from goal" honors an optional LLM provider pin

The Build-from-goal modal now exposes an "LLM provider" select that
defaults to "Use system default (waterfall from /settings/llm)" and
offers every registered provider (claude, codex, apple-foundation-
models). When the operator picks a provider, the chosen id pins the
head of the waterfall for every llm-prompt node in the surveyor /
drafter / designer chain. The global fallback chain still applies on
classified failures (binary missing, timeout, quota, auth, rate-
limit) — the pin says "try this first," not "use only this."

Threaded through:
- `build-from-goal-modal.ts` — new `<select id="build-provider">` with
  every `LLM_PROVIDERS` entry.
- `build-from-goal.js.ts` — appends `provider=…` to the POST body.
- `POST /agents/build` + `POST /agents/draft-one` — validate against
  `LLM_PROVIDERS`, pass through.
- `startBuildSession` + `startDraftOneSession` accept `provider`,
  persist as `session.providerPin`.
- `kickoffAgentRun` gains a `providerPin` arg; when set, clones the
  agent and stamps every `llm-prompt` (or legacy `claude-code`) node
  with the pin via a new `applyProviderPin` helper. Non-LLM nodes
  (shell, file-write, control flow) are unchanged.
- Drafter retries + designer kickoff read `session.providerPin` so
  the pin survives the full build flow.

Unset → existing behavior (each node inherits its declared provider,
the agent's default, or the global primary).
