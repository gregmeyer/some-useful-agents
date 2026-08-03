---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

feat(inbox): de-box the thread modal — flatten the nested action-card frames

The thread interior stopped reading as boxes-in-boxes. The action card is no
longer a bordered/rounded box inside the message inside the modal — it's a
single 2px status-colored left rule in the conversation flow (same language as
the home feed rows). The inline widget's own border/radius/shadow are stripped
inside a thread (the "Assessment" key-value block was quadruple-framed), the
YAML diff loses its box while keeping the green/red line tints, the thread
summary becomes a quiet hairline collapsible instead of a filled card, and the
action status is a mono-caps label instead of a pill. Pure CSS — every SSE,
form, and action hook is unchanged.
