---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Inbox typewriter: strip the `<plan>` envelope from the streamed
bubble so the operator sees only the recommendation text.

The triage agent's stream is the raw plan envelope
(`<plan>{"messageId":"…","recommendation":"…","actions":…}</plan>`).
The canonical persisted entry (post-`extractPlanJson`) shows only
the `recommendation` value, but the streaming bubble was showing
the raw envelope for the few seconds between `triage:token` arriving
and the canonical fragment refresh swapping in.

Fix: accumulate the full token buffer per turn, then on each
animation-frame tick try to extract just the `recommendation`
value (handles escaped chars including `\"`, `\\`, `\n`, `\t`,
`\uXXXX`). Returns whatever partial value has been streamed up to
the cursor, so the typewriter still paints incrementally. Falls
back to the raw streamed text when the recommendation key hasn't
arrived yet (envelope preamble) so non-plan responses still show
something useful. Buffer resets on each new `triage:started`.

Verified the parser correctness via five-case inline trace:
- Full plan → recommendation text only
- Mid-stream (no closing quote yet) → partial value as buffered
- Early stream (no recommendation key yet) → null → caller falls
  back to raw streamed text
- Escaped quote / newline → render as literal characters
