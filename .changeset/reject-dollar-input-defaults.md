---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Reject `$NAME` input defaults; make secret referencing discoverable.

An input `default: $API_KEY` is a literal string that never resolves — it gets injected verbatim (a bogus credential) and out-ranks a real secret/variable of the same name, silently breaking agents. Schema validation now rejects any input default matching `^$NAME$` (and `${NAME}`) with a message spelling out the fix: declare `secrets: [NAME]` and reference `$NAME` / `{{secrets.NAME}}`, or use a global variable. The `/settings/secrets` page gains a "Referencing a secret in an agent" helper card that shows the two-step pattern anchored on a real stored secret.
