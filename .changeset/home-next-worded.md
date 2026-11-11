---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

sua orders Home's Next up and writes each item's line of why.

New system agent `home-next`. Code still picks the items and builds their buttons; the agent is given the items and the facts behind each, and returns the order and one sentence per item. A sentence is used only when every number in it is in that item's facts. The wording is cached per list for half a day and never holds up the page: Home shows the plain version until the worded one is ready, and whenever the agent fails.
