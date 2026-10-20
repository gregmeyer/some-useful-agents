# ADR-0054: Skills are shared know-how, quoted into the preamble

- Status: accepted
- Date: 2026-10-20
- Deciders: Greg Meyer

## Context

The rules for building a good agent lived inside the prompts of the agents that build and fix agents.
The same rule ("research a list through research-fanout") was pasted into agent-builder and, in other
words, agent-analyzer; the web-search rule was only in the builder. Each fix had to find every copy,
and missed ones. Shell helpers had the same problem, but that's code, not know-how (a separate change).

## Decision

1. **A skill is a file:** `agents/examples/skills/<name>/SKILL.md`, frontmatter `name` + `description`,
   then Markdown. It ships with the examples (the repo copy first, then the bundled one), so it's
   reviewed like code and present on an npm install.
2. **Agents opt in by name** with `skills: [...]`. The text is quoted into the run preamble beside
   behaviors and memory, after template substitution, with framing that it can't change the task or
   grant access.
3. **A missing skill fails the run** before any node, like a missing behavior.
4. **Preloaded, not fetched.** Every listed skill is in the prompt from the start. A `skill-read` tool
   that fetches on demand would cost a turn each time, and turn limits are what these agents run out
   of. Caps (6 KB a skill, 16 KB together) keep preloading cheap.
5. **Not Claude Code's skills.** codex is the main provider, and skills must work the same on claude,
   codex and the openai-kind providers, which only the preamble does.

## Consequences

- One edit to a skill reaches every agent that lists it, with no reimport of those agents.
- Skills don't fix timeouts. They spread the agent shapes that do.
- The builder and analyzer propose skills as `<skill name description>` blocks. A proposal rides on the
  agent's own card (like a helper on an `agent-compose` card, ADR-0051), so one approval saves both, and
  a fix can't land listing a skill that isn't there. Saved skills live in the run database
  (`skills` + `skill_versions`, like `agent_versions`) and win over a shipped skill of the same name:
  your copy, never an edit to the shipped file. Each proposal records the skill it replaces, so a skill
  changed in between refuses the card instead of being overwritten.
