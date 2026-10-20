---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Skills: know-how several agents share, kept in one file.

An agent lists `skills: [research-shape, web-search]` and each skill's text (`agents/examples/skills/<name>/SKILL.md`) goes into its llm prompts, beside behaviors and memory. The builder and the analyzer now share the research and web-search rules instead of each keeping its own copy, so a fix to the rule reaches both. A missing skill fails the run before it starts; the agent page shows its skills under "Uses skills", and `sua skill list|show` lists them. See docs/skills.md.
