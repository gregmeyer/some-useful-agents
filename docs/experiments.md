# Experiments

An experiment answers a question about an agent, not about the world: **what changes its answer, and by how much?** It holds a set of items fixed, runs one agent over that same set under each combination you name, repeats each, and counts how far the results move. The numbers are counted from the runs; no model writes them. ([ADR-0078](adr/0078-experiments.md))

A [notebook](notebooks.md) finds things, checks them against sources and helps you decide. It can supply the set an experiment holds fixed, and it can [show an experiment's results](#showing-it-in-a-notebook), but it doesn't run one: its options change as searches run, and nothing in it means "run this several ways and compare".

## What one is made of

- **The set to hold fixed.** Copied once from a notebook's options (the ones still in the running, in name order so the notebook's own ranking doesn't lean the runs), or pasted as a list, one item a line: `Title | Label: value | Label: value`. After that it never changes, even if the notebook does. 2 to 60 items.
- **The agent it runs.** By default **Experiment ranker**, which ranks the items for a person's preferences following the instructions it is given. Any installed agent can be used if it takes the items as `ITEMS` and answers with every item's id, best first, in a `<ranking>` block.
- **What to change.** Up to three changes. For each you say what it is called ("Build") and what kind of change it is; each of its **versions** (two to four, lettered A to D) is then a name and one box:
  - **the instructions it is given**: how that version tells the agent to decide what fits. Left empty, it is the agent as it is.
  - **what the person asks for**: their preferences, in their words.
  - **the model it runs on**: a provider and a model.
  - **the version of the agent**: an earlier version number of the same agent.

  Every combination is a **condition**; version A of each change is the **baseline**. Two changes with two versions each is four conditions. A change with only one version filled in is left out.
- **Runs of each condition** (1 to 5, 3 by default). Repeats show how much the answer moves by itself. With one run of each, nothing is concluded.

- **How to score each result** (optional, up to three). Without a score, results are only compared with each other: you learn which conditions differ, not which is better. A score says how good each result is by a standard you set.
  - **Items that should be near the top**: part of an item's title, one a line. Counted in code: the share of those items that land in the top K. A line that matches no item is refused, not dropped.
  - **A judge** (up to two): a rubric in plain words ("the top three match what the person asked for"). A model reads each result against it and gives 0 to 100% with a reason. You can choose which model judges.

A pass makes at most 60 runs (sets × conditions × repeats, and once more for each judge, which reads every result); a larger setup is refused, saying what to cut.

## Setting one up

**New experiment** is one short page: the question (a short name is optional; sua uses your question), the set to hold fixed, the agent and how many times to run each condition, then your changes. **+ another version**, **+ change something else** and **Score each result** open more only when you want them. A line at the foot counts what it comes to as you type ("2 × 2 = 4 conditions × 3 runs = 12 runs, about $0.40") and says when that is more than a pass may make, or when one run of each would leave nothing to conclude.

A link can fill the page in: any field by its name in the address (`/experiments/new?question=…&from=<notebook id>&c1_name=Build&c1_kind=instructions&c1_v1_name=…&c1_v1_text=…`).

Tick **Also make a notebook that shows its results** to get its [notebook](#showing-it-in-a-notebook) made with it.

**From a conversation.** Ask sua to test, prove or compare what changes an agent's answer ("does the model matter more than the instructions?") and it offers **Set up the experiment**: a link to this page with your question and its draft of the changes filled in, for you to check and edit. sua never invents the set (it names one of your notebooks, or leaves it for you to choose), never starts a notebook or builds an agent for such an ask, and never answers the question from reasoning. Nothing runs until you press Run. Ask sua later what an experiment found and it repeats the finding from the runs, with what it rests on.

## Running it

Setting one up runs nothing. Its page shows how many runs a pass makes and, when the agent has run before, roughly what that will cost. **Run it** starts a pass: two runs go at a time and the page fills in by itself.

- **Stop** ends the runs under way and starts no more. What has run is kept.
- **Go on** runs what is left. A restart of sua mid-pass stops it the same way.
- **Try the unusable again** reruns the ones whose answer couldn't be used.
- **Run it again** starts a fresh pass. When the agent has changed since the last one, the page says so.

An answer is used only when it ranks every item once and names nothing else. An answer that leaves an item out or invents one gets one more try, told why; after that the run is marked unusable and is not counted. When a level names a provider, the run may use no other; one that still ran elsewhere is unusable.

Experiment runs are kept apart from the agent's own: they are filed under `experiment--<agent>`, so they never become the agent's latest result, never count toward its daily spend limit, and leave nothing in its state or memory. Each is still an ordinary run you can open from **Every run**.

## Showing it in a notebook

**Show it in a notebook** (on the experiment's page) makes a notebook for the experiment, of its own type: its page leads with what the experiment found, then the figures, each condition against the baseline with a column for every score, each change by itself, and where each item landed. The notebook is where you talk to sua about the results; sua is given the finding, the conditions and the item table, counted from the runs.

- **It reads the experiment every time.** Nothing is copied into the notebook, so it never goes stale: run the experiment again and the notebook shows the new pass. An open page redraws as runs come back.
- **One notebook an experiment.** Asking again opens the one it has; an archived one is restored.
- **It has no steps and nothing to decide.** Its main button is **Open the experiment**, which is where it is run, stopped and set up. Archiving the notebook leaves the experiment, and the other way round.
- The experiment's page shows **Open its notebook** once it has one.

## Judges

- **A judge never sees the build.** It is given the rubric, the items, the person's preferences and the ranking. It is not told which instructions, model or version produced the result, so it can't favour one.
- **Its answer is checked before it counts.** The score must be a number from 0 to 1, with a reason, and it must name the items the reason rests on; each must be an item of the set. An answer that fails gets one more try, told why. After that the result stands with no score from that judge, and the page says so.
- **A judge is one more model, and can be wrong.** Its scores are shown as an average for each condition with the lowest and highest seen, and every run lists its score and reason with a link to the judge's own run. To see whether judges agree, add two judges with the same rubric and different models: their columns sit side by side.
- **Counted scores first.** When what you care about can be counted ("these roles should be near the top"), use that: it gives the same number every time.

## What the page tells you

- **What it found**, in a sentence, with what it rests on: "Build changed the result; preferences did not, beyond run-to-run variation. 1 set, 4 conditions, 3 runs of each. It holds for this set only."
- **How far the result moved** for each thing you varied, next to how far it moves between two runs of the same thing. Two measures are used:
  - **Top K kept**: of the top K under one condition, how many are still in the top K under the other (K is 5, or fewer for a small set).
  - **Places moved**: how many places an item moves on average.
- **Each condition against the baseline**, and each score averaged for every condition (the baseline too: a score is about one result, not a comparison).
- **Each change by itself**: the same change made with everything else held at one setting. When these differ a lot, the thing you varied matters under some settings and not others (preferences that reorder everything under one set of instructions and nothing under another).
- **Where each item landed** under every condition, the ones that moved furthest first.
- **How it is set up**, and **every run** with its result and a link to the run.

**When a difference counts.** Something you varied is said to have changed the result only when its effect is larger than the largest difference seen between two repeats of the same condition. That rule is strict on purpose: with a handful of repeats there is too little for a finer test, and it can be checked by eye against the table. A difference no larger than that is reported as "no more than a repeat".

**What it does not tell you.** The finding holds for the set you froze and the levels you wrote. A different set of items, or differently worded instructions, can give a different answer. Something that changes the set itself (which sources a search uses) can't be tested this way.

## Limits

| | |
|---|---|
| Changes | 3 |
| Versions of each | 2 to 4 |
| Conditions | 16 |
| Repeats | 1 to 5 |
| Sets | 5 |
| Items a set | 2 to 60 |
| Scorers | 3 (2 judges on the page) |
| Runs a pass | 60, judges' included |
| Runs at a time | 2 |
| Time allowed a run | 5 minutes |
