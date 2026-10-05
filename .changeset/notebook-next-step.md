---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

A notebook's "Talk to sua" box suggests the next useful thing to say.

The hint and the ghost text in a notebook's talk box now follow where the notebook is, in this order: what it's for, then its limits, then candidates you've seen, then the next open "done when" criterion (naming your first option), then keeping the search going, then deciding. They update as sua fills the notebook in, without a reload.
