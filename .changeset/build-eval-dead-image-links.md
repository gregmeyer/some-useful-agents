---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Build eval now catches dead image links the drafter LLM hand-writes into agents.

Drafter LLMs frequently bake literal asset URLs into generated agents (e.g. a
shell node with an array of Wikimedia portrait URLs) and hallucinate the path.
These pass the structural critic — the host *is* declared in
`permissions.imgSrc`, so the page CSP allows it — but the URL 404s and the
widget renders a broken image. Observed in the wild: ~1/3 of the Wikimedia URLs
in a drafted "Marvel hero of the day" agent were dead links.

The build evaluation now extracts every hardcoded `http(s)` image URL from each
generated agent and HEAD-checks it. Definitively-gone links (HTTP 404/410) are
fed back to the planner/drafter as critic-style feedback so the next attempt
fixes the source (or drops the image) instead of committing an agent that
renders broken. Inconclusive results — network errors, timeouts, 401/403
(hotlink), 429 (rate-limit), 5xx — are never flagged, so an offline or
rate-limited build host can't produce false failures. Template placeholders
(`{{outputs.image_url}}`) and data URIs are skipped (not statically verifiable
/ can't 404). The check runs in both the multi-agent `PlannerLoopRunner` eval
phase and the single-agent drafter critic-retry loop.

New `@some-useful-agents/core` exports: `extractImageUrls`, `findDeadImageUrls`,
`checkPlanImageUrls`, `defaultCheckImageUrl`, `formatDeadImageFeedback`,
`formatImageCheckFeedback`. `PlannerLoopRunnerDeps` gains an optional
`checkImageUrl` dependency; omitting it skips the check (keeps tests/offline
builds network-free).
