---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

A meeting brief saved as PDF no longer prints one part over another.

Printed, a drawn notebook's brief could put a heading on top of the part above it, squeeze a company card into a column a few words wide, and leave half a page blank. Its columns and stacks now print as flex and block (which split across pages cleanly), parts may continue on the next page while small items stay whole, and a card in a narrow column puts its picture above its words.
