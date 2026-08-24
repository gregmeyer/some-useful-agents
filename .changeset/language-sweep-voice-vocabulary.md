---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Say it in plain words: a language sweep across the dashboard, plus written voice guidance.

The dashboard described itself to newcomers in terms borrowed from its own source. The New agent
form opened with "Create a single-node v2 DAG agent"; Pulse called itself an "information
radiator"; Build from goal offered "Use system default (waterfall from /settings/llm)"; the Nodes
page led with "Every first-class node type sua's executor knows". The inbox referred to "the
triage agent" without ever saying what that was, and agents in the older file format were labelled
"legacy v1" with a CLI command as their only remedy. All of it now says what the thing does.

In-product help had also drifted away from what shipped. Four notes promised features "in v0.15"
at version 0.27 — two of those features had since shipped (replay from a node, secrets management in
Settings), so help was pointing away from working UI; the other two had not, and now say so
instead of naming a version. Help taught `sua workflow run` throughout and never mentioned
`sua agent run`, contradicting ADR-0032. The tutorial numbered two different steps "Step 5" and
had no Step 7, and its secrets step taught a terminal command on a page that promises no terminal
is required.

Agents, Pulse, Runs and Settings now introduce themselves. Each rendered a bare title, while Nodes,
Packs, Behaviors, Scheduled and Help all carried a one-line description — so the four most-visited
pages were the four that said least about what they were for. Pulse is the notable one: it had been
using a *dismissible* tip to explain what Pulse is, so the explanation vanished permanently the
first time anyone closed it. That line is now a permanent part of the header, and the dismissible
tip keeps only the how-to-arrange-it advice worth dismissing once learned.

DESIGN.md gains a **Voice and Vocabulary** section — a table of the word to use for each concept,
a list of terms that must never reach a user, and the rule that copy never promises a version
number. Colour, type and spacing were already governed; words were not, which is why jargon grew
back after previous sweeps.
