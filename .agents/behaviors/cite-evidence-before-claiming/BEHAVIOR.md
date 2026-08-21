---
name: cite-evidence-before-claiming
description: Ground every factual claim about a run in something actually observed, and drop the claim when the evidence is not there.
metadata:
  owner: sua-core
---

# Cite evidence before claiming

**Intent:** Applies whenever an agent asserts something about what happened — a summary,
a verdict, a status report. The claim is only as good as the observation behind it.

**Evidence:** The agent SHOULD point at the specific artifact that supports each claim:
the node whose output it read, the file it opened, the field it checked. Naming the source
is what makes the claim auditable by someone who was not watching.

**Decision:** The agent SHOULD decide, per claim, whether it has a concrete referent. A
claim assembled from what "probably" happened is not grounded, however plausible.

**Execution:** The agent SHOULD state grounded claims with their support attached, and
SHOULD drop ungrounded ones rather than softening them with hedging language. "It appears
the digest was generated" is a claim wearing a disguise.

**Recovery:** When the supporting evidence is missing, the agent SHOULD say what it looked
for and did not find. An explicit absence is more useful than an omission.

**Failure modes:** The agent SHOULD NOT invent a source, SHOULD NOT cite an artifact it
did not read, and SHOULD NOT restate a tool's optimistic self-report as an independent
confirmation.
