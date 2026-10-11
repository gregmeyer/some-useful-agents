---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/dashboard": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
---

A notebook's source step can name the facts it looks up, and counts them one by one.

A source step can carry `facts` (the notebook's fact keys or labels): only those count toward its goal, and its agent is asked only for those. Before, a step whose agent finds revenue, employees and founding year could never reach its goal in a notebook that also tracks "why people buy it". Source progress is now counted fact by fact ("93 of 120 facts sourced"), so each fact found shows, not only companies with every fact. Stopping a step's run now stops the step instead of starting another try (a stopped shell step used to read as a timeout).
