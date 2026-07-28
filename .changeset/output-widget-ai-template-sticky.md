---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Output-widget editor: selecting "AI template" no longer snaps back to key-value.

An `ai-template` widget can't be saved without a template (schema requirement),
so saving right after picking it was rejected — and the reload reverted the
editor to the agent's saved type, so it looked like the picker "defaulted to
key-value". The validation bounce now carries the picked type (`?widgetType=`)
and the editor honours it, keeping "AI template" selected with the template
block open and a "Generate or paste a template before saving" prompt.
