---
name: writing-skills
description: How to write a skill sua's agents share — short rules with their reasons, one kind of work, under 6 KB, never a template or a manual.
---

A skill is know-how several agents share: how one kind of work is done.
Its text is quoted into every run of every agent that lists it, before the
agent's own prompt. Write it for a capable reader who has never seen this
work done here.

What goes in:
- One kind of work per skill ("evaluate software", "cite filings", "write a
  how-to"). Two kinds are two skills; an agent can list both.
- Rules, each with its reason in a clause ("…, because a vendor's own page
  overstates fit"). A rule without a reason gets followed where it doesn't
  fit.
- The order to work in, when order matters, as a short numbered list.
- What never to do, said plainly: never invent a figure, never claim a test
  ran, never count an unknown as zero.
- Definitions the agent would otherwise guess at: a scale ("0 unsuitable …
  4 exceeds the need"), what counts as evidence, when something is done.

What stays out:
- The task. A skill says how a kind of work is done; the agent's prompt says
  what to do this time. No "you are…", no inputs, no output format of one
  agent.
- Templates. Double-brace placeholders are never filled in a skill (and are refused); name the thing instead.
- Tools and access. A skill can't grant either; say which tool to prefer
  only when the agent already has it.
- A manual. Past a page, agents skim. Cut examples to one; cut history,
  credits and links unless the agent needs to open them.

Shape:
- name: lowercase words joined by hyphens, what the work is
  (`evaluate-software`, not `software-helper-v2`).
- description: one line saying when to use it. It's what lists show and how
  an agent builder picks it.
- Text: Markdown, at most 6 KB. An agent's skills together are at most
  16 KB, so a skill that will sit beside others stays well under 6.
- Plain headings or a bold lead word per part; short lines; no tables wider
  than the reader needs.

Changing a skill: every agent that lists it gets the new text on its next
run. Keep what agents already rely on unless the change is the point; say
what changed in one line.

Too big for one skill: split by kind of work (the workflow in one, the
scoring rubric in another), each standing on its own, and list both.
