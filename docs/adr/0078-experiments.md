# ADR-0078: Experiments are their own object: a frozen set, conditions, repeats, and measures counted in code

- Status: accepted
- Date: 2026-11-13
- Deciders: Greg Meyer
- Builds on: ADR-0055 (notebook steps), ADR-0077 (nothing runs on a guess)

## Context

sua was asked to show whether an agent's build shapes its recommendations more than a later user's preferences do. It made a notebook with find, check and write steps. The notebook never ran the comparison: no condition was run, the "baseline rank" and "variant rank" columns stayed empty, the set meant to be held fixed was whatever a search found (two items), the experiment's design rules were filed as per-option checks no source could confirm, and the write-up correctly said nothing could be measured.

The fail mode: **a notebook has no way to say "run the same thing several ways and count the difference", so the request was bent into steps that find and check things in the world.** The subject of the question was an agent, not the world.

## Decision

**An experiment is a first-class object, separate from notebooks** (`core/src/experiments.ts`, `ExperimentStore`).

- **Cases are frozen.** A case is a set of items copied once (from a notebook's options, or pasted) and never changed after. A notebook can supply a set; it does not hold the experiment.
- **Factors, levels, conditions.** A factor is one thing varied; a level says what that means for a run (an agent version, instructions, a provider or model, inputs). Conditions are every combination of one level per factor; the first is the baseline. At most 3 factors, 4 levels each, 16 conditions, 5 repeats, 60 runs a pass.
- **A pass is kept cell by cell.** One cell per case, condition and repeat, with its run and the ranking it returned. Cells are claimed one at a time, so a pass can be stopped, resumed, and survives a restart. A rerun (after the agent changes) is a new pass of the same experiment.
- **A ranking must be whole.** A run's answer counts only when it ranks every item of the case once and names nothing else (`cleanRanking`). Anything else is an invalid cell, not a partial result.
- **The measures are counted in code** (`core/src/experiment-measures.ts`): how many of the top K two rankings share, and how many places an item moves. Repeats of one condition give the run-to-run variation. A factor's effect is the average over pairs of conditions that differ in that factor alone. An effect is reported as real only when it is larger than the largest difference seen between two repeats of the same condition; with no repeats, nothing is concluded. The sentence a page shows (`verdictWords`) is built from these numbers and always states the sample and that it holds for those sets only.
- **Experiment runs stay out of the agent's own life.** A condition runs an unsaved copy of the agent under the id `experiment--<agent>` (`core/src/experiment-conditions.ts`), with `triggeredBy: 'experiment'`. Every lookup keyed by the agent's id (its last result, its view history, its daily spend limit, its state folder) therefore never sees them.

## Alternatives

- **A new notebook step kind.** Cheaper, but a notebook's options change as searches run, its steps run once in a line and pause for the person, its checks are per option, and the result could not be rerun as the agent changed. It would also have touched about thirty places that switch on step kind.
- **An agent that runs the experiment and writes a file.** Tried in the conversation that prompted this: the agent was drafted, failed on its first run, and was set to rank made-up items. The measures would also have been the model's.
- **Let the model compare the rankings.** Rejected: the numbers a verdict rests on must be reproducible from the stored cells.
- **A statistical test for "beyond noise".** With two to five repeats there is too little to test honestly. The rule used (larger than the largest repeat-to-repeat difference) is conservative and can be explained in one sentence.

## Consequences

- A new area in the dashboard (list, new, detail), a runner, and a default ranking agent follow in later changes; this decision covers the store, the measures and how runs are isolated.
- Only ranking experiments exist at first. The store keeps a `kind`, and per-output scorers and judges are added beside the comparative measures, not in place of them.
- A factor that changes the set itself (which sources are searched) cannot be tested on a frozen set and is out of scope.
