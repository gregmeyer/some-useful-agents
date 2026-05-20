---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Two fixes after the build-planner split:

- **agent-drafter prompt**: tell it explicitly that `field-toggle` / `view-switch` controls aren't allowed on `ai-template` widgets — the HTML template owns layout. Without this rule the drafter was producing YAML that failed schema validation on every draft when it picked `ai-template`.
- **Improve-layout proposed-layout copy**: when the plan has both `toAdd` (installed agents) and `needsNew` (to-draft specs), the "Will add N" panel headline now says "Will add N installed + M new" so the user understands Apply layout only would land just the N installed; Draft + apply lands all N+M.
