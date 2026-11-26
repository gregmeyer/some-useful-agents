# 0105. Comparison scores are worked out in code; unknown is null; templates come from skills

- Status: accepted
- Date: 2026-11-26

## Context

Choosing software (a CRM, a data warehouse, build or buy) needs more than a shortlist ranked by price: gates every option must pass, criteria weighted for the job, evidence behind each score, and an honest account of what isn't known yet. A skill that sets this out (evaluate-software: a job statement, gates, a 0–4 rubric with unknown never zero, bounds and coverage, a 2x2, a proof plan) was pasted in to be run by sua.

Three things could go wrong. A model asked to rank options will produce totals that look precise and aren't reproducible. A missing score counted as 0 punishes an option for what nobody looked up. And the skill's rubric is per job, so a template made once by hand from one notebook doesn't fit the next job.

## Decision

- **Scores are data; the arithmetic is code.** A scored criterion is a number field with a `weight`, five `anchors` (what 0–4 mean for this job) and an `axis` (suitability or feasibility). `notebook-scorecard.ts` works out each option's lower and upper bound, coverage, gate status (a failed check disqualifies; an unknown one or coverage under 80% leaves it provisional), the leader, and the weight changes that would put someone else first. No model adds anything up.
- **Unknown is null, never 0.** A missing key is unknown; 0 is a score. Every check in the code path compares against undefined, never falsiness, and the Scorecard shows "—" for unknown.
- **A score is kept only when code finds its quote on the page it cites.** The software scorer's last step fetches each cited page and looks for the quote word for word; a score whose page can't be read or whose words aren't there stays unknown, and the run says how many. A model's say-so is never a score.
- **Templates can be drafted from skills, without a notebook.** One generic `template-drafter` agent takes the skills to follow at run time (`skillsFromInput`) and a job, and writes a whole template setup. It's checked in code (`cleanTemplateSetup`: weights add to 100, each scored criterion has anchors and an axis, at most 6 steps and 4 asks, every step's agent installed) before it's shown on a card, and saved with `saveTemplateSetup`. Another kind of template needs only its skills (and a step agent if it scores).

## Consequences

- Coverage is often low at first: vendor pages that refuse automated readers leave scores unknown rather than guessed, so a comparison may stay provisional until someone adds evidence by hand.
- A skill can shape a template but can't add a check the code doesn't know; rules beyond the generic ones live in the skill's text and the drafter's judgement.
- The 2x2 is a picture of where options fall, not a decision: an axis with under half its weight known isn't placed.
