---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

fix(core,dashboard): apple-foundation-models reaches the schema + every UI dropdown

Follow-up to #416. The provider was added to the LlmProvider union and
spawner registry, but five other sites still hardcoded only
`['claude', 'codex']`:

- **agent-v2-schema.ts** — Zod `z.enum(['claude', 'codex'])` on the
  agent-level and node-level `provider` fields. Any agent YAML with
  `provider: apple-foundation-models` would fail schema validation
  before reaching the executor. Now driven by `PROVIDER_IDS` so new
  providers register through one place.
- **dashboard/routes/versions.ts** — `VALID_PROVIDERS` set + the
  agent-llm save handler's `'claude' | 'codex'` cast both refused the
  new provider. Now sourced from `LLM_PROVIDERS`; error message
  enumerates the full set.
- **dashboard/views/agent-detail/config.ts** — the per-agent LLM
  defaults card's provider select listed only claude + codex. Apple
  FM was reachable via per-node pin (llm-options.ts) but the
  agent-default UI couldn't pick it.
- **core/node-catalog.ts** — `llm-prompt` / `claude-code` node docs
  said `'claude' | 'codex'` in the type string and "Run an LLM
  (Claude or Codex)" in the description.
- **dashboard/views/settings-llm.ts** — intro paragraph still claimed
  "Rate limits, auth failures, and other errors stay on the same
  provider" after PR #415 expanded `shouldFallback` to include both.
  Now reflects the post-#415 policy.

No new tests — existing 1785-test suite covers the schema + route
paths via the bundled apple-foundationmodels-prompt agent and the
node-spawner tests added in #416.
