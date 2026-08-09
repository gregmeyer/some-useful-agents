---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Tighten the inbox reuse-hint threshold to avoid false reuse spotlights.

Dogfooding surfaced a two-keyword collision where the `STRONG_CANDIDATE` reuse
hint matched an unrelated agent ("track my crypto portfolio daily" spotlighted a
Claude-Code-usage tracker on "track" + "daily"). The strong-match bar rises from
6 to 9 (three distinct strong signals) and now also requires the leader to beat
the runner-up by a full signal (+3), so a single coincidental keyword can't push
triage toward the wrong agent. Genuine matches score well above this (12–15
observed), so real reuse suggestions are unaffected.
