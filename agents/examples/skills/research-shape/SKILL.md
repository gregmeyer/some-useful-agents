---
name: research-shape
description: How an agent researches a list (companies, options, people, angles of a question) without timing out — through research-fanout, never one long node or copies of one.
---

When a step researches a list (companies, options, people, sub-questions),
or one question from several angles, use `type: agent-invoke` with
`agentInvokeConfig.agentId: research-fanout`:

- inputMapping `ITEMS`: the list, one per line or JSON `[{subject, hint}]`
  (a hint tells same-named things apart: "the planning software at runway.com");
- `ASK`: what to find for each, as JSON `[{key, label, hint}]`;
- `CONTEXT`: the goal and limits every item gets;
- or `GOAL` alone, to split one question into 3–5 angles.

The next node reads its JSON `results`
(`[{subject, status, found: {key: {value, source, quote}}, not_found, summary}]`)
and `unfinished` (the items to give back as ITEMS to try again). It runs each
item as its own small run, three at a time, so one slow item can't sink the
rest.

Never:
- one llm-prompt node over the whole list: it times out or runs out of turns
  and returns nothing;
- copies of the same gather node (gather-1, gather-2, …): sibling nodes run
  one after another, so it's as slow and repeats the prompt.

Fixing an agent: a step that TIMED OUT or ran out of turns researching a list
is too much for one node. Replace it with one research-fanout call and keep the
agent's own checking and summing-up nodes after it, reading `results`. Say which
items didn't finish rather than hiding them.
