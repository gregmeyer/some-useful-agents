---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A notebook works through its steps one at a time, and pauses after each.

While a notebook has steps left, Run works on the current step. Its agent gets the step's job first in its inputs (and in a `STEP` input when it declares one), and runs again with what's still missing, up to 3 times. It stops early when a run gets no closer. A step that meets its goal waits for **Continue**; one that falls short is marked stuck and sua lists what's missing, with **Try again**. sua posts both in the notebook's conversation as cards. Agents are never edited for a step.
