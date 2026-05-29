---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Inbox queue: flat sortable list + right-side actions + activity-strip
preview.

PR 2 of 2 in the queue UX pass (PR 1 was #407: store-layer sort +
last-activity). Replaces the priority-segmented layout with one
flat list under a sticky sortable column header, reorders the row
so star + chevron sit on the right next to the metadata they
modify, and rebuilds the expanded preview as an activity strip
showing the actual conversation signal.

**Flat list.** Drops `renderGroup` and the priority-group cards.
The priority dot stays on each row — that's the urgency cue at a
glance. The (sorted) row order carries the rest.

**Sticky sortable header.** Five column links — Priority · Title ·
Agent · Status · Age — each render as a sort link that flips
direction on click. The active column shows a `↑` / `↓` arrow;
inactive columns are clickable but show no arrow. URL drives the
sort state (`?sort=X&dir=Y`); active filters (`q` / `starred` /
`tag`) are preserved through clicks. The chevron + star columns
get no label.

**Row layout reorder.** Operator feedback: "the grid row left side
doesn't make sense - think it should be right side." Star and
chevron move to the right. New grid template
(`12px 1fr auto auto auto 24px 24px`): priority dot + title (+
inline tags) on the left, agent · status · age · star · chevron
on the right. Drops the `—` placeholder for missing agents —
empty space reads as "no agent" without adding ink. The
left-edge amber accent for `awaiting_user` stays.

**Activity-strip preview** replaces the body-only excerpt:

  1. Latest non-action response (triage / user / system) with
     avatar + role + first ~160 chars (word-boundary truncation).
  2. Pending-actions summary chip when triage proposed actions:
     `▸ 1 proposed action: agent-catalog-search`.
  3. Context payload disclosure (only when present).
  4. Tag chips move from the title cell into the preview.
  5. Right-aligned footer: Open thread → · Source label.

Empty cases: manual conversation with no replies shows an italic
"No replies yet. Open the thread to start the conversation." with
the Open thread CTA. The `(empty)` body sentinel from the store's
NOT NULL workaround is suppressed (mirrors the modal's filter at
inbox-detail.ts:135). Rows with no responses but a real body fall
back to a body excerpt (~320 chars).

**Route preview payload.** `GET /inbox` computes per-row
`{latestResponse, proposedActions}` in one pass per row via
`listResponses(m.id)` — cheap at the default ≤200 row page size.
Walks responses from newest to oldest with an early exit once both
signals are captured. If pagination grows the row count
materially, fold into a bulk store helper that joins
`inbox_responses` once.

**Mobile fallback.** At <720px the priority + agent columns
collapse on both the row and the sticky header. The chevron and
star stay on the right so operators can still triage on phones.

1873 tests pass (no behavior tests added — pure markup +
ordering). Dogfooded live with `SUA_INBOX_DEMO=1`: flat list
rendered, sort links navigated to the right URL with the right
arrow indicator, activity-strip preview showed the system reply
+ proposed-action chip + Open thread footer.
