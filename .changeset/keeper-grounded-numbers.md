---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

A notebook only keeps numbers that the search actually stated.

When the keeper files what a search found, each number it gives must appear in that run's output, or it's left out and the run's note says so.
- **How it's matched:** the ways people write numbers ("$4,023", "4.9k", "157k mi", "1.2M", "18 million", "125–175k", "two"), within 1% for rounding.
- **Why:** a bathroom cabinet was once filed at $4,023, a price its search never gave.
- **Exception:** blocks an agent files from its own code are trusted.

`numbersInText` and `groundFacts` are exported from core.
