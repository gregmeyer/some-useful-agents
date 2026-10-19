---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/dashboard": patch
"@some-useful-agents/temporal-provider": patch
---

starter-research researches its angles three at a time through research-fanout.

"Research a topic" used one long step for each side (main and skeptical), and on a broad topic each would run out of turns or time and lose that side entirely. It now splits the topic into 3 to 5 angles, one of them the case against, and research-fanout researches them three at a time, each as its own small run. The brief cites findings by number, and code attaches each finding's page, so a bullet can't cite a page nobody opened. An angle that doesn't finish is named under the brief. The brief keeps the same shape.
