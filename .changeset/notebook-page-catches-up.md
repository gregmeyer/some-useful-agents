---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

A notebook page catches up when its last step finishes.

The page reloads itself when its steps change, but it waited while any text box had focus, and the conversation panel's box keeps focus after you send. So a finished write-up never showed until you reloaded by hand, under a notice still saying it was being worked on. Now it waits only while you're typing (a box with something in it), and the reload drops the one-time notice.
