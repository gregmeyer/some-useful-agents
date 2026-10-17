---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

A job's salary range no longer wipes its other facts.

An option's facts are checked against its own text. A salary range in the title ("$150k–$160k") was read as its first number and compared with the range's midpoint, which looked like a contradiction, so the option was cut down to `{salary: 150000}` and lost its company, location, level and posting link. That happened both when a job was filed and every time the notebook was opened. A span in the text is now read as a range, and a figure agrees with a range it falls in. Options cut down this way get their facts back from their filing the next time the notebook opens.
