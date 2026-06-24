---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Inbox: the per-thread action cap now resets on each operator reply.

The runaway-fan-out guard counted actions over the thread's whole lifetime, so a
long, actively-driven debugging thread (build → run → analyze → fix → run → …)
would eventually hit the 10-action cap and refuse to propose further steps even
though the operator was actively engaging. It now counts actions since the
operator's last message, so a fresh reply resets the budget — while an autonomous
refire chain still can't fan out unbounded between replies. The skip note now
explains that replying continues the thread.
