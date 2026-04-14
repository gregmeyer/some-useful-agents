---
"@some-useful-agents/core": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/dashboard": patch
---

**fix: don't open the secrets store for agents that declare no secrets.**

v0.10.0 regression: `LocalProvider.submitRun` and `runAgentActivity` both called `secretsStore.getAll()` unconditionally for every run, which meant any agent — even one with no `secrets:` field — needed the store to be unlockable. On a v2 passphrase-protected store that turned every run into "set SUA_SECRETS_PASSPHRASE or nothing works", which was never the intent.

Now the store is only opened when the agent actually declares secrets. Regression test in `local-provider.test.ts` uses a store that throws on any read and asserts the provider never touches it for an agent with no `secrets:` field.
