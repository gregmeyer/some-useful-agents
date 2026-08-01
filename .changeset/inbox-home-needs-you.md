---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

feat(inbox): Home leads with the inbox — needs-you strip + auto-resolved loop ticker

The Mission Control home now opens with the inbox instead of keeping it in the
top-bar toast only. An amber "Needs you" strip surfaces the threads awaiting a
reply, and a teal "loop ticker" shows the threads sua resolved on its own
("sua closed these") — the trust-building counterpart that shows the system
closing loops, not just asking. Both strips stay live via the global inbox SSE
stream and open the thread modal in place (falling back to the thread page
without JS).

A new `auto_resolved` column records whether a thread was resolved
autonomously (verify-on-resolve / triage) vs by the operator, so the ticker
only ever shows sua's own wins; a reopen + operator-resolve correctly clears
the flag. New store query `listRecentlyResolved`.
