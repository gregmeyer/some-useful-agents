---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

feat(inbox): auto-rename "New conversation" threads from first reply

When the operator posts the first reply on a manual-source thread that
still carries the default `"New conversation"` title, the route now
replaces the title with a single-line, ellipsized version of the body
(up to 60 chars). Threads created with an explicit title are
preserved; subsequent replies never re-rename; non-manual sources are
untouched.

fix(dashboard): Add tile click no longer triggers Chrome "Leave site?"
guard. The agent-card click handler in `add-tile-modal.js.ts` called
`form.submit()` directly, which bypasses the form's `submit` event —
so `widget-layout.js`'s edit-mode beforeunload guard never got a
chance to clear `intentionalNav` and Chrome's generic dialog stacked
on top of the legit POST. Switched to `form.requestSubmit()` (same
fix pattern as the inbox Cmd/Ctrl+Enter handler).
