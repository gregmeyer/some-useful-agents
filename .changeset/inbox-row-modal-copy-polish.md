---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Inbox UX polish pack: row signal column, resizable modal, copy
button on conversation turns, dismiss-aware empty state, and
read-only archive view.

**Right-side row signal.** Raw snake_case status badges
(`awaiting_user`, `open`, `triaged`) replaced with human labels
("Your turn", "Open", "Triaged", etc.). "Your turn" gets the warn
(amber) badge variant plus a subtle left-edge accent on the row —
the only state that demands a click stays loud, the rest fade. Age
and status now live in one signal cell on the right so the eye
scans them together. Modal status badge picks up the same
vocabulary.

**Resizable modal.** Drag the bottom-right gripper to grow the whole
modal. The composer stays pinned at the bottom; the conversation
timeline gets the extra room. Replaces the prior `resize: vertical`
on the textarea (which expanded just that one cell — not what
operators reached for).

**Copy button on conversation turns.** Each user/triage/system entry
gets a "Copy" affordance in its meta row, invisible until the row
is hovered. Clicking copies the message body via
`navigator.clipboard.writeText` (with a textarea-select fallback for
older browsers). The label briefly switches to "Copied" / "Copy
failed" and the button picks up an ok/err color for 1.5s.

**Dismiss audit trail + dismiss-aware empty state.** Dismissing via
the modal now hard-reloads the inbox page so the suggestion banner
counts, priority group headers, and favorited rail all stay in
sync. An "Inbox cleared" empty-state copy replaces the generic
"Nothing in your inbox" when there's terminal-state history,
acknowledging the cleanup work and offering the archive link. A
quiet "View N dismissed / resolved →" footer link sits below the
active list whenever the archive isn't empty.

**Read-only archive view.** `?status=dismissed` and `?status=resolved`
on `/inbox` show the terminal-state rows under a muted header with
a "← Active inbox" back link, so operators can review or confirm
what they just cleared.
