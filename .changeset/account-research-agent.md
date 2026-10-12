---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

An account-research agent that fills an accounts notebook from public job posts.

`account-research` turns an ideal customer profile into stack, problem and hiring signals, finds companies on the Ashby, Greenhouse and Lever job boards, scores each 0–100 on a fixed four-tier rubric and backs the score with a word-for-word quote from the company's own post. A code step checks every quote; a score whose quote isn't in the post can't rank above tier 3. It files straight into the notebook. Notebook pipelines now pass a `FIELDS` input (the notebook's field keys and roles) to agents that declare one.
