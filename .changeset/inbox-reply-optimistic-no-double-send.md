---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Inbox modal: optimistic reply UI + double-submit guard.

Operators were double-clicking Post reply during the network +
LLM-kickoff window and getting duplicate "You" messages in the
conversation. The disable-on-submit only fired in the current event
loop and didn't survive `refresh()` re-rendering the form, so the
second submit slipped through to the route.

Two fixes:

1. **In-flight guard.** `data-inflight="1"` on the form is checked at
   the very top of the submit handler — a duplicate submit (rapid
   double-click, Enter-then-click) is dropped before fetch fires.
   The flag clears on success and failure so legitimate retries
   after a failed POST still work.

2. **Optimistic reply.** For the Post-reply path, the modal JS
   echoes the operator's message into the timeline immediately:
   a `<li>` matching renderConversationEntry's structure with a
   `data-pending="1"` marker, italic + 0.55 opacity styling, "You ·
   Sending…" meta. The textarea clears, the viewport scrolls to
   the new entry. On success, refresh() replaces the placeholder
   with the canonical server-rendered entry; on failure, the
   placeholder is removed and the textarea text restored so the
   operator can edit and retry without losing their input.
