# ADR-0078: Experiments are their own object: a frozen set, conditions, repeats, and measures counted in code

- Status: superseded in part by [ADR-0079](0079-experiments-compare-what-runs-produce.md): experiments now run the whole agent under each version and compare what the runs produced. The frozen set, the ranking measures, the golden set and the set advisor described below were removed. Experiments as their own object, passes, counted measures, run isolation, the notebook type, sua's guidance and the read tool stand.
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

**Scores sit beside the comparison, not in place of it** (added with scorers). Comparing rankings says which conditions differ; it cannot say which is better. An experiment may carry up to three scorers:

- `top`, counted in code: the share of named items in a result's top K.
- `judge`: the `experiment-judge` agent reads one result against a rubric and returns 0 to 1 with a reason and the items it rests on. It is given the rubric, items, preferences and ranking, **never the build's instructions**, so it is blind to the condition. `cleanJudgement` rejects an answer without a number in range, a reason, or at least one cited item that is in the set; one retry, then the result stands unscored by that judge.
- Judges' runs count toward a pass's 60. Scores are reported per condition as a mean with the range; no "beyond noise" claim is made for them.
- A judge as the thing under test (does the judge's own wording or model change its verdicts) is approached by putting two judges with the same rubric and different models side by side. An experiment whose task returns a score, not a ranking, would need a second `kind` and is not built.

**A notebook can show an experiment; the experiment still owns the runs** (added with the notebook type). `Notebook.experimentId` links a notebook to one experiment. Its page (`experimentLayout`, generated for that experiment's conditions and scorers) binds to `/notebook/experiment`, which `experimentPageData` builds from the experiment's latest pass on every render. Nothing is copied, so the notebook can't disagree with the experiment. The runner touches the notebook as cells finish so an open page redraws. Such a notebook has no steps and offers no Decide; its header opens the experiment. sua's view of the notebook carries the same counted finding and tables.

**sua offers an experiment; it does not make or run one** (added with the conversation guidance). The triage kernel routes an ask to test, prove or compare what changes an agent's output to a link that fills in the setup page, in place of a notebook or a new agent (the mistake that prompted this record). The set comes from one of the operator's notebooks or is left for them to choose; sua writes no items. sua is given each experiment's finding in the page's own words (`experimentsForTriage`) and is told to repeat it, not restate or extend it. A link was chosen over an action card because the operator must read and edit the drafted wording before anything exists, and the page already does that.

**The set is suggested, never chosen** (added with the golden set). Picking the set was the step people couldn't answer. `lib/experiment-set.ts` ranks the operator's notebooks for the question from counted properties (shared topic words, size, how well facts are filled, picks, reasoned rule-outs), proposes a trimmed set for a long list (picks, an even spread across the notebook's own order, two ruled out), and offers the notebook's picks as an answer key through the counted scorer, which gains `avoid` for items that should stay low. All of it is shown before anything is frozen and can be changed. A notebook's own fit score is excluded from frozen facts, since a ranker handed it would echo it. No model is used for this, so the suggestion is reproducible and explains itself.

**A reading of the question is laid over that, and checked** (added with the set advisor). The counted ranking can match words, but can't tell that a question about pay against remote preferences needs items that differ in pay and remote status. The `experiment-set-advisor` agent reads the question, what changes, and each set's facts with their fill counts, and returns the facts the rankings turn on, a pick, and what no set notes. Code keeps a named fact only when a set notes one of that label and a pick only when it is a listed set (`parseSetAdvice`), counts coverage itself (`applySetAdvice`), and moves the suggestion only to a pick with five or more options that notes those facts for most. It runs in the background on a POST when the step opens (never on a page view), is cached by what was asked, and the counted list stands while it runs or if it fails.

## Alternatives

- **A new notebook step kind.** Cheaper, but a notebook's options change as searches run, its steps run once in a line and pause for the person, its checks are per option, and the result could not be rerun as the agent changed. It would also have touched about thirty places that switch on step kind.
- **An agent that runs the experiment and writes a file.** Tried in the conversation that prompted this: the agent was drafted, failed on its first run, and was set to rank made-up items. The measures would also have been the model's.
- **Let the model compare the rankings.** Rejected: the numbers a verdict rests on must be reproducible from the stored cells.
- **A statistical test for "beyond noise".** With two to five repeats there is too little to test honestly. The rule used (larger than the largest repeat-to-repeat difference) is conservative and can be explained in one sentence.

## Consequences

- A new area in the dashboard (list, new, detail), a runner, and a default ranking agent follow in later changes; this decision covers the store, the measures and how runs are isolated.
- Only ranking experiments exist at first. The store keeps a `kind`, and per-output scorers and judges are added beside the comparative measures, not in place of them.
- A factor that changes the set itself (which sources are searched) cannot be tested on a frozen set and is out of scope.
