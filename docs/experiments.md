# Experiments

An experiment answers a question about an agent, not about the world: **what changes its answer, and by how much?** It holds a set of items fixed, runs one agent over that same set under each combination you name, repeats each, and counts how far the results move. The numbers are counted from the runs; no model writes them. ([ADR-0078](adr/0078-experiments.md))

A [notebook](notebooks.md) finds things, checks them against sources and helps you decide. It can supply the set an experiment holds fixed, but it can't run one: its options change as searches run, and nothing in it means "run this several ways and compare".

## What one is made of

- **The set to hold fixed.** Copied once from a notebook's options (the ones still in the running, in name order so the notebook's own ranking doesn't lean the runs), or pasted as a list, one item a line: `Title | Label: value | Label: value`. After that it never changes, even if the notebook does. 2 to 60 items.
- **The agent it runs.** By default **Experiment ranker**, which ranks the items for a person's preferences following the instructions it is given. Any installed agent can be used if it takes the items as `ITEMS` and answers with every item's id, best first, in a `<ranking>` block.
- **What to vary.** Up to two things on the page (three in the store), each with two to four levels. A level says what it changes for a run:
  - **Instructions to the agent** (how this build decides what fits),
  - **The person's preferences**,
  - **Provider and model**,
  - **Agent version** (an earlier version of the same agent).

  Every combination is a **condition**; the first level of each thing is the **baseline**. Two things with two levels each is four conditions.
- **Runs of each condition** (1 to 5, 3 by default). Repeats show how much the answer moves by itself. With one run of each, nothing is concluded.

A pass makes at most 60 runs (sets × conditions × repeats); a larger setup is refused, saying what to cut.

## Running it

Setting one up runs nothing. Its page shows how many runs a pass makes and, when the agent has run before, roughly what that will cost. **Run it** starts a pass: two runs go at a time and the page fills in by itself.

- **Stop** ends the runs under way and starts no more. What has run is kept.
- **Go on** runs what is left. A restart of sua mid-pass stops it the same way.
- **Try the unusable again** reruns the ones whose answer couldn't be used.
- **Run it again** starts a fresh pass. When the agent has changed since the last one, the page says so.

An answer is used only when it ranks every item once and names nothing else. An answer that leaves an item out or invents one gets one more try, told why; after that the run is marked unusable and is not counted. When a level names a provider, the run may use no other; one that still ran elsewhere is unusable.

Experiment runs are kept apart from the agent's own: they are filed under `experiment--<agent>`, so they never become the agent's latest result, never count toward its daily spend limit, and leave nothing in its state or memory. Each is still an ordinary run you can open from **Every run**.

## What the page tells you

- **What it found**, in a sentence, with what it rests on: "Build changed the result; preferences did not, beyond run-to-run variation. 1 set, 4 conditions, 3 runs of each. It holds for this set only."
- **How far the result moved** for each thing you varied, next to how far it moves between two runs of the same thing. Two measures are used:
  - **Top K kept**: of the top K under one condition, how many are still in the top K under the other (K is 5, or fewer for a small set).
  - **Places moved**: how many places an item moves on average.
- **Each condition against the baseline.**
- **Each change by itself**: the same change made with everything else held at one setting. When these differ a lot, the thing you varied matters under some settings and not others (preferences that reorder everything under one set of instructions and nothing under another).
- **Where each item landed** under every condition, the ones that moved furthest first.
- **How it is set up**, and **every run** with its result and a link to the run.

**When a difference counts.** Something you varied is said to have changed the result only when its effect is larger than the largest difference seen between two repeats of the same condition. That rule is strict on purpose: with a handful of repeats there is too little for a finer test, and it can be checked by eye against the table. A difference no larger than that is reported as "no more than a repeat".

**What it does not tell you.** The finding holds for the set you froze and the levels you wrote. A different set of items, or differently worded instructions, can give a different answer. Something that changes the set itself (which sources a search uses) can't be tested this way.

## Limits

| | |
|---|---|
| Things varied | 3 (2 on the page) |
| Levels each | 2 to 4 |
| Conditions | 16 |
| Repeats | 1 to 5 |
| Sets | 5 |
| Items a set | 2 to 60 |
| Runs a pass | 60 |
| Runs at a time | 2 |
| Time allowed a run | 5 minutes |
