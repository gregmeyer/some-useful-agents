---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Triage stops chasing fixes that don't work, and verifies before it resolves.

Two ways the autonomous loop could fool itself are now closed:

- **Convergence guard.** When triage keeps applying `agent-editor` fixes to the same agent that never actually starts working, it used to loop forever — analyze → fix → still broken → analyze → fix — and every operator "please fix it" reset the turn cap straight back into it. Triage now counts the fixes applied to each target across the whole thread; after 3 that didn't stick, it stops proposing more and escalates to the operator with what it tried, instead of looping.

- **Verify-on-resolve.** When triage tries to resolve a thread that actually mutated something (a `write` action completed) and flagged what to check, the thread now moves through the previously-dead `verifying` status and confirms the fix against real evidence — the focus agent's latest run — before resolving. A run that still failed bounces the thread back to "your turn" rather than being declared done while broken.

Also fixes the commitment chip: a triage turn that promised pending work but landed no runnable action no longer records a false commitment (the enforcement the code always claimed but never had).
