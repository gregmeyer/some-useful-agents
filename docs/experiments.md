# Experiments

An experiment answers a question about an agent: **what changes what it produces, and by how much?** It gives one agent the same ask under different versions of it, runs the whole agent a few times under each, reads what each run produced, and counts how much the versions' results have in common. The numbers are counted from the runs; no model writes them. ([ADR-0078](adr/0078-experiments.md))

"Does the new version of my job search agent find different jobs?" "Does the model change what the digest picks?" "Does the build matter more than the preferences I give it?" Each is an experiment.

## What is held the same, what changes, what is compared

| | |
|---|---|
| **Held the same** | The ask: the agent's inputs, the same for every run. |
| **Changed** | One to three things, each with two to four versions: which version of the agent runs, the model it runs on, or the value of one of its inputs. |
| **Run** | The whole agent, start to finish, for every combination of versions, a few times each. It searches, reads and uses its tools as it would for anyone. |
| **Compared** | What each run produced: the items its output lists. |

Every combination of versions is run; the first version of each change is the **baseline** the others are compared with. Two changes with two versions each is four combinations.

## Setting one up

**New experiment** is six short steps. Nothing is made until the last one, and nothing runs until you press Run after that.

1. **The question.** What you want to find out, in your own words.
2. **The agent.** Your agents, the most run first, each with how many times it has run, how many versions it has, and how many items its last run listed. Type to search. sua's own agents aren't listed. An agent whose last run had no list sua could read says so: an experiment compares the lists runs produce.
3. **What you ask it.** A value for each of the agent's inputs, starting from what it was given on its last run. This is the same for every run.
4. **What changes.** One change at a time. First the kind:
   - **Which version of the agent runs.** The page says which versions the agent has and offers them.
   - **The model it runs on.** A provider and a model.
   - **Something you ask it.** One of its inputs, with a different value in each version.

   Then what to call it and its versions, A and B (up to four). **Change something else too** adds another, up to three. You can go on with none: the experiment then runs the agent as it is and shows how steady it is.
5. **Which is better.** Optional. See [Scoring](#scoring).
6. **Check it.** The whole setup written out, each part with an Edit back to its step, and what it comes to: "2 × 2 = 4 versions × 2 runs = Job finder runs 8 times". The name is here (sua uses your question if you leave it empty), with how many times each version runs, and a box to make a notebook that shows the results.

Next checks only the step you're on, and Back never loses what you typed. A setup that is refused (no agent, an input the agent needs left empty, too many runs) comes back on the step the problem belongs to. Without scripts the six steps show one after another on one page.

A link can fill it in: any field by its name in the address (`/experiments/new?question=…&agent=<agent id>&c1_kind=version&c1_v1_version=6&c1_v2_version=7`). A link that names the agent and a change opens on **Check it**.

**From a conversation.** Ask sua to test, prove or compare what changes an agent's output and it offers **Set up the experiment**: a link to this page with your question and its draft filled in, for you to check. sua never invents what the agent is asked or which versions it has, never starts a notebook or builds an agent for such an ask, and never answers the question from reasoning. Nothing runs until you press Run.

## Running it

Its page shows how many times the agent will run and, when the agent has priced runs behind it, roughly what that will cost. **Run it** starts a pass: two runs go at a time. Each is the whole agent, so a pass can take a while; the page fills in by itself and you can leave and come back.

- **Stop** ends the runs under way and starts no more. What has run is kept.
- **Go on** runs what is left. A restart of sua mid-pass stops it the same way.
- **Try the unusable again** reruns the ones that couldn't be used.
- **Run it again** starts a fresh pass. When the agent has changed since the last one, the page says so.

A run is given up on after 15 minutes.

**The agent runs for real.** It uses its tools, reads what it reads, and does whatever it normally does. If it sends messages, files into a notebook or changes something outside itself, it does that on every run of the experiment. Experiment runs are kept apart from the agent's own life in these ways only: they are filed under `experiment--<agent>`, so they never become the agent's latest result, never count toward its daily spend limit, and use a memory and state folder of their own; and they raise nothing in your inbox. Each is still an ordinary run you can open from **Every run**.

## Reading what a run produced

To compare runs, sua reads each run's output into a list of items, in code:

- **JSON anywhere in the output** (the whole of it, a fenced block, a tagged block): the largest list of objects. An item's title is its title-like field (`title`, `name`, `role`, …); its link, when it has one; its other short fields are its facts.
- **Otherwise a bulleted or numbered list**: a line an item.

An output that lists nothing on purpose (`{"jobs": []}`) is a result: it found nothing. An output with no list at all can't be compared, and its run is marked **unusable** and not counted. Agents that end with a list of what they found, as JSON, compare best.

**When two items are the same.** When both have a link: the same host and path (anything after `?` is ignored). Otherwise: the same words in the title, with who it's from when that is stated. A job that comes back with a slightly different title and no link counts as two items; the table shows both, so you can see when that happened.

## What the page tells you

- **What it found**, in a sentence, with what it rests on: "Build changed what it produced; preferences did not, beyond run-to-run variation. 4 versions, 2 runs of each. It holds for this ask, when it was run."
- **How much was in both**, for each thing you changed, next to how much two runs of the same version shared. "25%: 1 of 4 items were in both" means that between two versions' results there were four different items, and one of them was in both.
- **Each version against the baseline**: how many items its runs listed, how much it shared with the baseline, and every score.
- **Each change by itself** (with two or more changes): the same change made with everything else held at one setting. When these differ a lot, the change matters under some settings and not others.
- **What each version found**: every item any run listed, with how many of each version's runs listed it and about where, the ones versions disagree on first. Items with a link are linked.
- **How it is set up**, and **every run** with what it listed and a link to the run.

**When a difference counts.** A change is said to have altered what was produced only when two versions share less than the least any two runs of the same version shared. That is strict on purpose: with a few runs there is too little for a finer test, and it can be checked by eye against the table. A difference no larger than that is reported as no more than run-to-run variation.

**What it does not tell you.** The finding holds for the ask you gave, at the time it was run. A search agent's results change from day to day whatever you do, which is what the repeats measure; another ask, or another week, can give a different answer.

## Scoring

Comparing results shows which versions differ. To say which is better you need a standard. An experiment can carry up to three scores:

- **Count it.** Things that should be in the results, and things that should not, one a line: words from an item's title, or part of its link. Counted in code: the share of them the output lists (or leaves out).
- **Have a model judge it** (up to two). A rubric in plain words. A model reads what each run produced against it and gives 0 to 100% with a reason. It is shown what the agent was asked and the items it listed; never which version produced them. Its answer counts only when it is a number in range with a reason that points at items in the list; otherwise it gets one more try, then the result stands unscored by that judge, and the page says so. Each judge reads every result, so it adds one model run for every agent run.

Scores show for each version as an average over its runs, with the lowest and highest when they differ.

## Showing it in a notebook

**Show it in a notebook** (or the box on the last setup step) makes a notebook for the experiment: its page leads with what it found, then the figures, each version against the baseline, each change by itself, and what each version found. The notebook is where you talk to sua about the results.

- **It reads the experiment every time.** Nothing is copied, so it never goes stale; an open page redraws as runs come back.
- **One notebook an experiment.** Asking again opens the one it has; an archived one is restored.
- **It has no steps and nothing to decide.** Its main button is **Open the experiment**, which is where it is run.

## Where else an experiment shows

- **On the agent it ran**: *Experiments on this agent* on the agent's page, with the finding and what it rests on.
- **In conversation**: sua is told your ten newest experiments and what each found, and reads one in full when the thread links it or you name it.
- **To other agents and apps**: the built-in [`experiment-read`](tools/experiment-read.md) tool, also over MCP. Your [tool policy](tool-policies.md) can keep one private.

Archived experiments are not mentioned on the agent's page or to sua.

## Limits

| | |
|---|---|
| Changes | 3 |
| Versions of each | 2 to 4 |
| Combinations | 12 |
| Runs of each | 1 to 5 (2 to begin with) |
| Scores | 3 (2 judges) |
| Runs a pass | 36, judges' included |
| Runs at a time | 2 |
| Time allowed a run | 15 minutes |
| Items read from a run | 100 |

## Not yet

- **Comparing notebooks.** Running a whole notebook (find, check, write) under each version and comparing the notebooks it makes. Agents come first; this follows.
- **Outputs that aren't lists.** An agent that writes prose, or one answer, has nothing to count in common. A judge can score it, but the comparison needs a list.
