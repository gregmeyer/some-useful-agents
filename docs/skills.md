# Skills

A skill is know-how that several agents share: how a kind of work is done
(research a list, search the web), kept in one file so every agent that needs
it reads the same text. Before skills, each agent carried its own copy in its
prompt, and the copies drifted apart: the builder knew to search through
`web-search-links`, while the analyzer, fixing the same kind of agent, didn't.

Skills don't make an agent faster or stop timeouts. Those are about the
agent's shape (see [research-fanout](agents.md)). A skill is how the agents
that build and fix other agents learn that shape, and keep learning it the
same way.

## Using a skill

List it on the agent:

```yaml
id: agent-builder
skills: [research-shape, web-search]
```

Before the run's first model call, each listed skill's text goes into the
preamble of every llm-prompt node, after the agent's
[behaviors](behaviors.md) and before its memory. It's put in after template
substitution, so `{{…}}` in a skill stays as written. The block tells the
model that the text is quoted know-how: it doesn't change the task, and it
can't give the agent tools or access it wasn't given.

A listed skill that doesn't exist **fails the run before any node runs**. The
agent was written expecting that know-how, and output without it looks fine
and isn't. The agent's page shows its skills under **Uses skills** and marks
a missing one.

## Writing a skill

`agents/examples/skills/<name>/SKILL.md`:

```markdown
---
name: research-shape
description: How an agent researches a list without timing out.
---

When a step researches a list (companies, options, people), use …
```

- `name` is lowercase words joined by hyphens, and matches the folder.
- `description` says what it's for, in one line. It's what lists show.
- The text is at most 6 KB, and an agent's skills together at most 16 KB.
  Write rules and the reasons for them, not a manual.

Skills ship with the examples, so an npm install has them too.

## Skills sua proposes

When sua builds an agent (agent-builder) or fixes one (agent-analyzer) and the
work needs know-how other agents would use too, it can propose a skill with
it: a new one, or a change to one the agent already lists. The builder and
analyzer see every skill by name (and the full text of the ones the agent
being fixed lists), and are told to use a skill rather than paste know-how
into a prompt.

The skill rides on the same card as the agent ("Install draft", "Apply fix"),
under **New skill** with its text, or **Changes skill** with what changes.
Nothing is saved until you approve the card. Then:

- the skill is saved as a new version in the run database, which you can
  roll back. Changing a shipped skill saves **your copy**, which wins over
  the shipped file for every agent here; the file itself stays as it is;
- the agent is saved after it. If the agent can't be saved, the skill is
  taken back;
- if the skill changed since it was proposed, or the agent lists a skill
  that doesn't exist, the card is refused and nothing is saved.

A proposed skill has the same limits as a written one, and can't contain a
`{{…}}` template: skills are quoted as written. A card carries at most two.

This covers fixes and builds that happen in a conversation. The agent page's
**Suggest improvements** and **Build from goal** list skills for the agent to
use, but don't propose new ones yet.

## Commands

```bash
sua skill list           # every skill, with what it's for
sua skill show <name>    # its full text, as agents get it
```

## Shipped skills

| Skill | Used by | What it says |
|---|---|---|
| `research-shape` | agent-builder, agent-analyzer | Research a list through research-fanout; never one node over all of it or gather-N copies. |
| `web-search` | agent-builder, agent-analyzer | Search results come from web-search-links; a model that searches and reads uses the web-search tool; never scrape a search engine. |

## Skills, behaviors and memory

| | Says | Written by | Shared |
|---|---|---|---|
| [Behaviors](behaviors.md) | how to act (conduct) | the project, `.agents/behaviors/` | across agents that list it |
| Skills | how a kind of work is done | the project, `agents/examples/skills/` | across agents that list it |
| [Memory](memory.md) | what this agent learned | the agent, at run time | never; per agent |

A saved skill (one sua proposed, or your copy of a shipped one) is stored
with its versions in the run database; `sua skill list` shows both kinds.

See [ADR-0054](adr/0054-skills.md).
