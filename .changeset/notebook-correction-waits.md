---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

A notebook correction applied while a step runs waits for the step, then applies itself; and sua can say why an action failed.

Pressing Apply on a correction card while the notebook was running a step used to fail it for good ("The notebook is running a step"), with no way to try again. Now the card says it waits for that step and applies when the step is done; **Don't apply** takes it back, and a reply in the conversation doesn't drop it. Triage also sees a failed action's reason, so "what failed?" gets a real answer instead of "no error message".
