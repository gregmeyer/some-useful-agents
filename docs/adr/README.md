# Architecture Decision Records

This directory captures the **why** behind architectural choices in
`some-useful-agents`. Code tells you what. ADRs tell you why.

## Index

| # | Title | Status |
|---|-------|--------|
| [0001](0001-monorepo-with-npm-workspaces.md) | Monorepo with npm workspaces | Accepted |
| [0002](0002-sqlite-via-node-builtin.md) | SQLite via `node:sqlite` built-in | Accepted |
| [0003](0003-mcp-http-sse-transport.md) | MCP via HTTP/SSE streamable transport | Accepted |
| [0004](0004-temporal-worker-on-host.md) | Temporal worker runs on host, not Docker | Accepted |
| [0005](0005-shell-sandbox-claude-on-host.md) | Shell agents sandboxed in Docker; claude-code agents on host | Accepted |
| [0006](0006-env-filtering-by-trust-level.md) | Env filtering by trust level | Accepted |
| [0007](0007-encrypted-file-secrets-store.md) | Encrypted file secrets store with machine-bound key | Accepted |
| [0008](0008-npm-trusted-publishing.md) | npm Trusted Publishing via OIDC | Accepted |
| [0009](0009-changesets-for-versioning.md) | Changesets for version management | Accepted |
| [0010](0010-environment-gated-release.md) | Environment-gated release workflow | Accepted |
| [0011](0011-slack-webhooks-not-oauth.md) | Slack via incoming webhooks, not OAuth | Proposed |
| [0012](0012-local-cron-scheduler-node-cron.md) | Local cron scheduler via node-cron | Accepted |
| [0013](0013-tutorial-and-dad-joke-example.md) | Onboarding tutorial + dad-joke example | Accepted |
| [0014](0014-passphrase-kek-secrets-store.md) | Passphrase KEK for secrets store | Accepted |
| [0015](0015-global-variables-store.md) | Global variables store (plain-text, non-sensitive) | Accepted |
| [0016](0016-llm-spawner-abstraction.md) | LlmSpawner abstraction for multi-provider CLI support | Accepted |
| [0017](0017-agent-analyzer-self-correcting.md) | Agent analyzer as a self-correcting agent pipeline | Accepted |
| [0018](0018-three-layer-secret-redaction.md) | Three-layer secret redaction in run logs | Accepted |
| [0019](0019-mcp-servers-first-class.md) | MCP servers as a first-class entity | Accepted |
| [0020](0020-ai-template-widget.md) | AI-generated template widget (`ai-template`) | Accepted |
| [0021](0021-html-allowlist-sanitizer.md) | HTML allowlist sanitizer (zero-deps) | Accepted |
| [0022](0022-output-widget-schema-v2.md) | Output widget schema extension for ai-template | Accepted |
| [0023](0023-llm-prompt-unification.md) | Unify `claude-code` and `llm-prompt` node types | Accepted |
| [0024](0024-build-planner-split-orchestrator.md) | Split the build-planner into orchestrated specialist agents | Accepted |
| [0025](0025-build-eval-image-link-verification.md) | Verify hardcoded image links during build evaluation | Accepted |
| [0026](0026-apple-runner-code-signing.md) | Code-sign the Apple runner for daemon + distributed TCC access | Accepted |
| [0027](0027-oauth-loopback-tool.md) | `oauth-loopback` built-in tool | Accepted |
| [0028](0028-hardware-design-team-on-sua.md) | Hardware Design Team as a sua multi-agent system | Accepted |
| [0029](0029-mcp-2026-07-28-sdk-v2.md) | MCP 2026-07-28 migration — stateless server + SDK v2 | Accepted |
| [0030](0030-outcome-detection.md) | Outcome detection as a post-run observer, not a node | Accepted |
| [0031](0031-agent-behavior-specs.md) | Adopt the Agent Behavior spec, with scope as the trust boundary | Accepted |
| [0032](0032-agent-is-the-user-facing-cli-verb.md) | `agent` is the user-facing CLI verb; `workflow` owns v2 internals | Accepted |
| [0033](0033-idle-dashboard-session.md) | The dashboard session is an idle window, and expiry is recoverable | Accepted |
| [0034](0034-tools-owns-what-agents-can-call.md) | Tools owns what agents can call; navigation is organised by direction and by kind | Accepted |
| [0035](0035-declared-tools-skip-providers-that-cannot-call-them.md) | A node's declared tools skip providers that can't call them | Superseded by ADR-0036 |
| [0036](0036-serve-sua-tools-to-claude-over-mcp.md) | Serve sua's tools to claude over a per-attempt MCP endpoint | Accepted |
| [0037](0037-goal-nodes.md) | Goal nodes run as framed llm-prompt nodes, finished by `<final>` | Accepted |
| [0038](0038-per-agent-memory.md) | Per-agent memory, recalled into the prompt and edited with tools | Accepted |
| [0039](0039-conversations-by-transcript.md) | Conversations replay a budgeted transcript; each turn is a run | Accepted |
| [0040](0040-record-llm-cost-at-list-price.md) | Record every LLM call's tokens and cost, in USD at list price | Accepted |
| [0041](0041-spend-limits.md) | Spend limits per run and per agent per day, enforced where the money is spent | Accepted |
| [0042](0042-ask-a-person-suspend-and-resume.md) | Ask a person by suspending the run, and resume it from the answer | Accepted |
| [0043](0043-inbound-webhooks.md) | Inbound webhooks on the dashboard server, per-agent secret, off by default | Accepted |
| [0044](0044-serve-sua-tools-to-codex-over-mcp.md) | Serve sua tools to codex over the same per-attempt MCP endpoint, as config flags | Accepted |
| [0045](0045-edit-the-tool-policy-from-the-dashboard.md) | Edit the tool policy from the dashboard, safely | Accepted |
| [0046](0046-chat-over-websocket.md) | Chat over a WebSocket, with streamed replies | Accepted |
| [0047](0047-a2ui-views.md) | Agent views are A2UI, validated by the A2UI processor itself | Accepted |
| [0048](0048-conversations-in-the-inbox-store.md) | Conversations live in the inbox store | Accepted |
| [0049](0049-goal-surfaces.md) | Goal surfaces: semantic objects, a surface model, then rendering | Accepted |
| [0050](0050-notebook-schedules-run-in-the-dashboard.md) | Notebook schedules run in the dashboard, not the scheduler daemon | Accepted |
| [0051](0051-build-and-wire-on-one-card.md) | A new helper agent and the call to it are approved on one card | Accepted |
| [0052](0052-out-of-turns-answers-from-what-it-read.md) | A node out of turns answers from what it read | Accepted |
| [0053](0053-notebook-templates.md) | Notebook templates are setup only, and sua asks before creating | Accepted |
| [0054](0054-skills.md) | Skills are shared know-how, quoted into the preamble | Accepted |
| [0055](0055-notebook-step-card-is-the-queue.md) | A notebook step's card is its one queue | Accepted |
| [0056](0056-notebook-layouts.md) | A notebook's layout is an A2UI document | Accepted |
| [0057](0057-template-subject.md) | A template can have a subject that changes each time | Accepted |
| [0058](0058-notebook-decides-its-page.md) | A notebook decides its own page | Accepted |
| [0059](0059-notebook-header-in-layout.md) | A notebook's header is part of its layout, drawn by the page | Accepted |
| [0060](0060-page-decided-again-after-first-step.md) | A notebook decides its page again after its first step | Accepted |
| [0061](0061-notebook-write-step.md) | A write step writes a meeting's talking points, grounded in the themes | Accepted |
| [0062](0062-who-they-are-now-conflicts.md) | When what was found disagrees with who they are, say so and let it be settled | Accepted |
| [0063](0063-notebook-corrections.md) | A correction is worked out by a model, and followed through the notebook by code | Accepted |
| [0064](0064-page-composed-from-what-was-written.md) | A written notebook's page is composed around what was written | Accepted |
| [0065](0065-representation-levers.md) | Representation levers, not more boxes | Accepted |
| [0066](0066-what-if-diagrams.md) | What-if controls on code-drawn diagrams | Accepted |
| [0067](0067-page-fills-in-place.md) | The page fills in place | Accepted |
| [0068](0068-picked-page-still-composes.md) | A ready-made page you picked is still sua's to compose | Accepted |
| [0069](0069-a-writeup-is-an-answer.md) | A shortlist's write-up is kept as its answer | Accepted |
| [0070](0070-a-boards-page-is-a-layout-composed-from-its-agents-outputs.md) | A board's page is a layout composed from its agents' outputs | Accepted |
| [0071](0071-notebooks-have-topic-tags.md) | Notebooks have topic tags, and who they're about is kept apart | Accepted |
| [0072](0072-a-tldr-redraw-is-a-chosen-spec.md) | A TL;DR redraw is a spec sua chooses, not a picture it draws | Accepted |
| [0073](0073-homes-next-up-code-picks-a-model-words-it.md) | Home's Next up: code picks the items, a model words them | Accepted |
| [0074](0074-pulse-opens-on-a-generated-edition.md) | Pulse opens on a generated edition; the grid is a tab | Accepted |
| [0075](0075-boards-have-goals-and-sua-reviews-them.md) | A board has a goal, and sua reviews it in rounds | Accepted |
| [0076](0076-the-edition-follows-preferences.md) | Today's edition is improved through preferences, not a saved page | Accepted |
| [0077](0077-a-notebook-waits-for-what-it-depends-on.md) | A notebook names what it depends on from you, and waits for it | Accepted |
| [0078](0078-experiments.md) | Experiments are their own object: a frozen set, conditions, repeats, and measures counted in code | Superseded in part by ADR-0079 |
| [0079](0079-experiments-compare-what-runs-produce.md) | An experiment compares what whole runs produce, not the order of a frozen list | Accepted |
| [0080](0080-a-briefing-on-a-subject.md) | A briefing on a subject | Accepted |
| [0081](0081-where-an-answers-sources-come-from.md) | Where an answer's sources come from | Accepted |
| [0082](0082-tracing-an-answers-sources.md) | Tracing an answer's sources | Accepted |
| [0083](0083-how-sure-an-answer-is.md) | How sure an answer is | Accepted |
| [0084](0084-a2ui-1-0.md) | A2UI 1.0 | Accepted |
| [0085](0085-the-sua-catalog-document.md) | The sua catalog as an A2UI 1.0 catalog document | Accepted |
| [0086](0086-surfaces-update-in-place.md) | Surfaces update in place | Accepted |
| [0087](0087-sua-a2ui-functions.md) | sua's A2UI functions | Accepted |
| [0088](0088-a2ui-agent-functions.md) | A2UI agent functions | Accepted |
| [0089](0089-vega-chart.md) | VegaChart | Accepted |
| [0090](0090-a2ui-over-mcp.md) | A notebook as an A2UI page over MCP | Accepted |
| [0091](0091-pages-on-paper.md) | A notebook's page on paper keeps up with its A2UI | Accepted |
| [0092](0092-charts-on-paper.md) | A chart on paper is the chart's picture | Accepted |
| [0093](0093-tldr-card-when-it-adds.md) | The TL;DR card shows when it adds something | Accepted |
| [0094](0094-runbook-reads-like-a-recipe.md) | A Runbook page reads like a recipe | Accepted |
| [0095](0095-a-how-to-starts-on-the-runbook-page.md) | A how-to starts on the Runbook page | Accepted |
| [0096](0096-tldr-card-composed-as-a2ui.md) | The TL;DR card can be composed as an A2UI view | Accepted |
| [0097](0097-a-runbook-reads-like-a-lesson.md) | A runbook reads like a lesson | Accepted |
| [0098](0098-a-tldr-redraw-is-composed-for-its-page.md) | A TL;DR redraw is always composed, shaped for its page | Accepted |
| [0099](0099-the-edition-says-how-fresh-it-is.md) | Today's edition says how fresh it is | Accepted |
| [0100](0100-pulses-today-tab-is-always-there.md) | Pulse's Today tab is always there | Accepted |
| [0101](0101-the-edition-offers-an-agent-for-a-gap.md) | The edition offers an agent for a gap | Accepted |
| [0102](0102-tools-you-add.md) | Tools you add: inputs as environment variables, gated as the shell they run | Accepted |

## Template

Use the [MADR-lite](https://adr.github.io/madr/) format. Keep each ADR to one
page. The goal is captured judgment, not exhaustive prose.

```markdown
# ADR-NNNN: Title

## Status
Accepted | Proposed | Superseded by ADR-XXXX

## Context
What's the problem? What forced this decision?

## Decision
What did we choose and why?

## Consequences
What trade-offs are we accepting? What becomes easier? What becomes harder?
```

## When to write an ADR

- Any decision that shapes the codebase for 6+ months
- Any decision you'd have to re-explain to a new contributor
- Any decision that rejects an obvious alternative (the "why not X" matters)

## When NOT to write an ADR

- Small refactors, bug fixes, dependency bumps
- Decisions that are fully captured in commit messages or PR bodies
- Style and formatting choices (those live in linter config)

## Changing a decision

Don't edit old ADRs. Write a new one that supersedes the old one, and mark
the old one's status as `Superseded by ADR-NNNN`. Decisions are historical
artifacts.
