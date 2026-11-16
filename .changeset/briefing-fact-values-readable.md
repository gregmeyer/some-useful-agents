---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Briefing facts read cleanly: no mid-word cuts, compact money, sizes that say what they count.

A fact about someone or a company (and its summary) was cut at exactly 300 characters, so a briefing's Recent news could end "…AI Video Call. Secu" and its summary "…showed daily a". It now keeps the whole sentences that fit, or cuts at a word and adds "…". In a money fact (revenue, funding, valuation…), a bare large number the researcher returned is written compactly, so "1040000000 (FY2025)" reads "1.04B (FY2025)". A size that is only a number or a range says what it counts ("900 employees"). Facts already kept change the next time the profile step looks again; a value that only changed in how it's written isn't flagged as new.
