---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Ask sua about your skills, and have it write, change or add one from a conversation.

sua now sees your skills (what each is for, where it's from, which agents use it) and reads one in full when you name it. "Make a skill from this" or "add a rule to research-shape" hands the job to a new skill-drafter agent, which itself uses a new shipped `writing-skills` skill; drafting changes nothing and ends in a Save the skill card with the text or what changes. "Use web-search in my news agent" gives an Add the skill card. Approving saves the skill and each agent as new versions, all or nothing, and is refused if the skill changed since or an agent's skills would go over 16 KB.
