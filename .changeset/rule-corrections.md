---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Correct a notebook's limits, checks and done-whens in its conversation.

Say "a 4 qt bowl is fine", "the budget is $600 now" or "we don't need it by Friday", and sua's correction card shows what that changes. Applying it changes or removes the rule where it is.

- **A changed check:** its results are forgotten, and the options sua ruled out on it come back. Then every option in the running is checked on the new check. A check taken out brings back what it ruled out.
- **A changed limit:** the options it ruled out come back and are checked again, and the next search uses the new limit.
- **Rules that change together:** when another rule has to change with it, such as a limit and the check that applies it, the card changes both.
- **Your own rule-outs** stay as they are.
- **The card** lists the first few options, then how many more, and finds the rule by its words.

With this, corrections cover every part of a notebook.
