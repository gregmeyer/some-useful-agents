---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Replace the two stacked native browser prompts on dashboard tile removal with a single in-app confirm modal. Previously, deleting a tile in edit mode fired the `onsubmit` `confirm()` AND the edit-mode `beforeunload` "Leave site?" guard — two system dialogs for one action. Now: tile-delete forms use `data-confirm-modal`, intercepted by a styled in-app modal (reusing the existing `pulse-configure-modal` chrome); confirming sets an intentional-navigation flag so the `beforeunload` guard doesn't double-prompt. Any plain form submit in edit mode also clears the guard so deliberate server actions don't trigger the "Leave site?" dialog.
