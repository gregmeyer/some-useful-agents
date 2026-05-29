---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Inbox modal: thinking indicator now shows after Post reply, timeline
no longer scrolls behind the composer, witty waiting labels rotate.

Three fixes bundled — both bugs surfaced live while building the
streaming UX (plan path B, PR 1 of 4):

1. **Thinking indicator never appeared after Post reply.** PR #397's
   `userIsInteracting()` skipped the DOM refresh whenever focus was
   inside the modal. Post-reply the textarea clears but focus stays
   in it, so the refresh would silently skip forever — the operator
   saw nothing happen and couldn't tell whether triage was running
   or had crashed. Refresh only worked on full page reload.
   `userIsInteracting()` now treats an empty focused textarea/input
   as NOT interacting (no caret position to wipe, no in-progress
   text). Selections and non-empty inputs still suppress refresh,
   so the original "don't wipe text selections" guarantee from
   PR #397 holds.

2. **Timeline avatars scrolled behind the composer.** The composer
   uses `position: sticky` but the timeline avatars carry
   `z-index: 1` so they punch through the rail line. Without an
   explicit stacking context, the avatars from the last messages
   bled through the sticky composer on long conversations.
   Composer now gets `z-index: 2` on top of its solid background.

3. **Witty waiting labels.** The thinking indicator now rotates
   through a curated phase-aware label set: triage thinking gets
   "Pondering…", "Distilling tokens…", "Marinating thoughts…",
   "Cogitating…", etc; action-running gets "Dispatching…",
   "Crunching…", "Tracing call graph…"; verifying gets
   "Double-checking…", "Sanity-checking…". 2s cadence with a 220ms
   cross-fade. `renderThinkingIndicator` gains a
   `data-thinking-phase` attribute so the right label set is used.
   The action-card running state picks up the same affordance.
