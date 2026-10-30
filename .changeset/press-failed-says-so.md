---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

A button press that doesn't go through says so, and the dashboard log says why.

Pressing a card's button (Apply, Run it, Not now) or a list row's button used to fail silently: the button came back on and nothing changed, so the press looked like it did nothing. Now a message shows under the buttons: signed out, gone, an error number, or sua not reachable. The dashboard also logs every press it refuses or fails, with the path, the status, and whether a session cookie came with it, so a press that didn't work can be traced.
