---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Add `sua apple connect` to register the Apple integration from a granted Terminal.

The dashboard "Add Apple integration" flow introspects via the background daemon,
which usually lacks Reminders access (macOS ties the grant to the granting process
tree). `sua apple connect` runs the `lists` introspection in the user's own
Terminal — where `sua apple authorize` granted access — then upserts the `apple`
integration (default id `apple`) with the discovered lists/folders, so the
generated tools become available. Pairs with running agents via
`SUA_PROVIDER=local` from the same Terminal.
