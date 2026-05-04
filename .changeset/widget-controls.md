---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Output widgets gain interactive controls.

Agents can now declare a `controls:` array on `outputWidget` with three control types: `replay` (re-run inline, optionally with tweakable inputs), `field-toggle` (hide/show optional fields), and `view-switch` (tab-style switch between named field subsets — e.g. metric ↔ imperial). State lives in URL query params (`?wv=`, `?wh=`) so refresh resets to defaults and links can be shared. Renders on agent detail and run detail pages; Pulse tiles continue to render statically. The agent-builder prompt and discovery catalog teach the planner when to reach for each control type.
