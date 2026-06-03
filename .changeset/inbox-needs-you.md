---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Pin a "Needs you" section at the top of the inbox.

Threads awaiting your reply (status "Your turn") now float into a dedicated
"Needs you" section at the top of `/inbox`, ordered longest-waiting-first, so
what needs an operator reply is always first. They're removed from the main
list (no double-listing), and the now-redundant "Reply to triage" banner
suggestion is dropped; the suggested-actions banner points at the section
instead of showing misleading "all resolved" copy.
