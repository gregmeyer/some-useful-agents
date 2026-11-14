# ADR-0079: An experiment compares what whole runs produce, not the order of a frozen list

- Status: accepted
- Date: 2026-11-13
- Deciders: Greg Meyer
- Supersedes in part: ADR-0078 (the frozen set, ranking measures, golden set and set advisor)

## Context

ADR-0078 made experiments a first-class object. Its first shape held a list of items fixed (copied from a notebook's options), ran a ranker over that same list under each condition, and compared the rankings. Seven changes built on that: scorers, a notebook type, sua's guidance, a setup wizard, a suggested "golden set", an advisor that read the question, and a read tool.

The person it was built for then asked for a way to search agents and runs when setting one up, and on being offered runs as another source for the frozen list said: "notebooks are also a changeable output, I'm not understanding the direction here."

The frozen-list design had the direction backwards for the question that started it ("does the build of an agent change its recommendations more than what the user asks for?"). What an agent recommends is mostly a matter of what it *finds*. Re-ordering a list that was already found can't see that: it never re-runs the search. A notebook, or a run, was being treated as the input when it is the output.

How it went wrong: the idea of holding results fixed came from sua's own first reply in the conversation that prompted the work, and from reading "like Braintrust" as "a dataset of cases". It was never put to the person as a plain statement of what stays the same and what is compared.

## Decision

**An experiment gives one agent the same ask under named versions of it, runs the whole agent under each, and compares what the runs produced.**

- **Held the same**: the ask, as the agent's inputs (`Experiment.inputs`).
- **Changed**: up to three factors of two to four levels. A level is an agent version, a provider and model, or values for the agent's inputs. Instructions are no longer a kind of their own: an agent's instructions are part of its version, and anything it is told per run is an input.
- **Run**: the whole agent, as an unsaved copy under `experiment--<agent>` (unchanged from ADR-0078), with its tools and a state folder of that id. Runs are costly, so the limits drop: 12 combinations, 36 runs a pass, 2 repeats by default, 15 minutes a run, no automatic retry of an agent run.
- **Compared**: the items each run's output lists, read in code (`core/src/experiment-output.ts`): the largest list of objects in any JSON in the output, else a bulleted list. An empty list is a result; no list is an unusable run. Items match across runs by link (host and path) when both have one, else by the title's words with who it's from.
- **Measured** (`core/src/experiment-measures.ts`): for two outputs, how many items are in both of how many there are between them. Repeats of one version give the run-to-run variation. A factor's effect is the average over pairs of versions that differ in that factor alone, and counts only when it is below the least any two repeats shared. The per-item table says in how many of each version's runs an item turned up, and about where.
- **Scored**, optionally: `found` (named things the output lists, or with `avoid` leaves out, counted) and `judge` (the `experiment-judge` agent, given the ask and the items, never the version).

**Removed**: the `ranking` kind and everything only it needed: frozen cases, `cleanRanking`, top-K measures, the `experiment-ranker` and `experiment-set-advisor` agents, the golden set and answer key, the set step and its suggestions, and the link from a source notebook to experiments made from it. Tables keep the old columns unread; rows of the old kind are not listed. No experiments existed on the one live install when this was done.

**Kept from ADR-0078**: experiments as their own object; passes kept cell by cell (stop, resume, restart); measures counted in code and worded by code; the conservative rule for "beyond noise"; runs filed apart from the agent's own; the notebook that shows an experiment; sua offering one by link and repeating its finding; `experiment-read`.

## Alternatives

- **Keep both kinds.** Offered, and declined: one clear model is worth more than a second kind that answers a narrower question, and the frozen-list kind had not been used.
- **Compare notebooks first.** A notebook is the output people look at, but rerunning one (find, check, write) per version is many runs and several agents. Agents first; notebooks follow on the same measures.
- **Have a model decide whether two items are the same.** It would catch the same job under two titles, but then the count behind the verdict would rest on a model. Matching stays in code; near-misses show as two rows.

## Consequences

- Experiments are slower and cost what the agent costs, times the runs. The page says how many times the agent will run before it starts.
- An agent's side effects happen on every run. This is said plainly in the docs; nothing sandboxes it.
- An agent whose output has no list can't be compared. The setup page says so for an agent whose last run had none.
- The lesson for the next comparison feature is in the Context: state what is held the same, what is run, and what is compared, and get a yes, before building.
