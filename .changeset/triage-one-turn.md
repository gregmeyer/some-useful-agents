---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

sua answers in fewer turns.

An action that says what it did in a line (changing a notebook's page, adding to a notebook, adjusting Home or a board, a schedule, a setting, a dashboard) is now sua's reply when it finishes, instead of being followed by another model turn 15 to 30 seconds later that repeated it. A failed one still gets a turn. sua's proposed actions are also checked before its reply is posted: when every one is refused and sua will try again, the reply that described the refused action isn't posted, so the conversation no longer shows "Done: I changed…" followed by a refusal.
