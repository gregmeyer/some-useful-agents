---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Three small polish fixes surfaced during v0.19 testing rounds:

**SSRF error copy is no longer caller-specific.** `assertSafeUrl` originally said `"http-get and http-post only allow requests to public addresses"` — accurate when it shipped, but `agent install` and the notify dispatcher now call it too. Generalized to `"SSRF protection: only public addresses are allowed."` so the message reads correctly from every caller.

**`secrets rm` and `secrets remove` work as aliases for `secrets delete`.** Both are common muscle-memory choices (`rm` from shell, `remove` from npm). The canonical command stays `delete`; the aliases are commander-level so help text shows `delete|rm <name>` and either token resolves.

**Deflaked the post-spawn settle test.** `waitForServiceSettle reports stale when the child dies during the settle window` was relying on a 20ms-vs-100ms timing window that lost on slow CI machines (occasional one-fail-out-of-many runs). Replaced the timer-based race with a deterministic `child.once('exit', ...)` await before the settle — verified 5× without a flake.
