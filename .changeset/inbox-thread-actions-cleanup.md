---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Clean up the inbox thread-actions UI (fork / retarget).

Replaced the two free-text "agent id" boxes with a single labeled "Move to"
dropdown listing installed agents by name, shared by the Fork and Retarget
buttons (Retarget uses the submit button's formaction so one select drives both
routes). The inbox AJAX form handler now honors a submitter's formaction. Clearer,
no more typing exact agent ids.
