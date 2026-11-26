---
name: software-rubric
description: How to score software against a job — 0–4 anchors, unknown never zero, default weights, evidence records with confidence, score bounds and coverage, and a 36-month cost view. Used with evaluate-software and by the scorer.
---

## Scores
Score each criterion 0–4:
- 0 demonstrably unsuitable;
- 1 major gaps;
- 2 partial fit;
- 3 meets the need;
- 4 exceeds the need in a materially useful way.

**Unknown is null, never zero.** Higher always means better (a low cost
scores high). Write anchors for this job before scoring: what 0, 1, 2, 3 and
4 mean for each criterion here, in words a reader could check.

## Default weights (sum 100)
Job fit 25, integration 15, cost 10, complexity 10, usability 10,
reliability 10, team knowledge 5, governance 5, adaptability 5,
reversibility 5. Adjust them to the job before scoring, never after. Avoid
double-counting correlated criteria (cost and complexity often move
together: say what each one covers). Job fit, usability, reliability,
governance and adaptability speak to **suitability**; integration, cost,
complexity, team knowledge and reversibility to **feasibility**.

## Each score
Record the candidate, criterion, weight, score or null, the evidence behind
it, a one-line rationale, and confidence (high, medium, low). A score needs
evidence: with none, it stays null. Confidence is high only for a direct
test or current primary documentation for the edition in question; medium
for independent corroboration; low for a vendor claim alone or dated
material.

## Evidence
Each record has a claim, its source URL or test reference, the date, the
source type (vendor, independent, test), the edition it applies to, its
limitations, and whether it was verified. Prefer direct tests and relevant
primary documentation; tell vendor claims apart from independent
corroboration. Quote the exact words that support a score. Do not fabricate
missing data, and never claim a test was run when it was not.

## Gates
Pass, fail or unknown, each with its evidence. A failed gate disqualifies
the option; an unknown gate keeps any recommendation conditional.

## Bounds and coverage
- Lower bound = sum of weight × known score / 4.
- Upper bound = lower bound + the sum of the weights still unknown.
- Coverage = the sum of the known weights.

Report the bounds out of 100, coverage and confidence separately. Don't rank
a candidate below the minimum coverage (80% by default) as a definitive
winner. Recalculate with plausible alternative weights and disclose any
ranking reversal.

## Economics
Estimate license, usage, implementation, migration, integration, training,
maintenance, human oversight and exit costs over a 36-month horizon by
default. Separate one-time from recurring costs; show ranges and
assumptions. Estimate time to first value and steady-state value. Avoid
unsupported ROI claims.
