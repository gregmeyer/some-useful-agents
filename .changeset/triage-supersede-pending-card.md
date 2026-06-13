---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Inbox: a reply over a pending proposed action now retires the card and re-plans.

Previously, replying while a triage-proposed Run/Skip card was still pending did
nothing — triage was suppressed until you manually skipped the card. Now a reply
auto-retires any pending *proposed* card (shown as "Superseded by your reply",
attributed to triage rather than the operator) and immediately fires a fresh
triage turn that plans against your latest message. Running actions are left
untouched — they can't be safely cancelled mid-flight. Manual skips are now
explicitly attributed to the operator.
