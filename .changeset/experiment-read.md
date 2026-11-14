---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

`experiment-read`: an agent, another app or a conversation can read an experiment.

A new built-in tool, also offered over MCP, reads what an experiment found: its question, the finding and what it rests on, how it is set up, each condition against the baseline with any scores, each change by itself, where each item landed, and its runs. Every number is counted from the experiment's stored runs, and the readout says to repeat them as given and for that set only. It only reads; archived experiments too; a tool policy can keep one private. In a conversation, sua now reads an experiment in full when the thread links it or you name it, so it can answer what the headline doesn't.
